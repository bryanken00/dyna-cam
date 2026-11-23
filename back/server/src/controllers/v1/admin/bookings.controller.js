import express from "express";
import { catchAsync, validateBody, validateQuery } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal, getTodayDateLocal, moment } from "../../../utils/dateUtils.js";
import { checkPermission } from "../../../middlewares/checkPermission.middleware.js";
import { minutesToTime, quote } from "../../../utils/bookingPrice.js";
import { findConflict, loadVenueHours } from "../../../utils/courtTimeline.js";
import { bookingManageUrl } from "../../../utils/clips.js";
import {
  addMinutesTo,
  cancelBooking,
  conflictMessage,
  createBooking,
  expireHolds,
  markNoShow,
  moveBooking,
  recordBookingPayment,
  toStartLocal,
} from "../../../utils/bookings.js";
import {
  bookingPaymentSchema,
  cancelBookingSchema,
  createBookingSchema,
  dayQuerySchema,
  listBookingsQuerySchema,
  moveBookingSchema,
  quoteQuerySchema,
} from "../../../validators/bookings.validator.js";

/**
 * PLAN-003 Phase B — court bookings at the desk (Admin → Dyna Cam → Bookings).
 * Permission: bookings. Taking money (Paid now, Record payment) also needs
 * payments write, like every other payment.
 *
 * The writes live in utils/bookings.js (shared with the player's booking page
 * from Phase C); each runs in a transaction that locks the court row first.
 */
const router = express.Router();

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";

const BOOKING_COLUMNS = `b.bookingId, b.venueId, v.name AS venueName, b.courtId, c.name AS courtName,
  b.startAt, b.endAt, b.playerName, b.phone, b.email, b.price, b.paymentStatus, b.payMethod,
  b.source, b.bookingCode, b.holdExpiresAt, b.sessionId, b.rescheduledCount, b.cancelledAt,
  b.cancelledBy, b.cancelReason, b.confirmationSentAt, b.reminderSentAt, b.status, b.dateCreated,
  b.dateUpdated, CONCAT(u.firstName, ' ', u.lastName) AS createdBy`;

const BOOKING_FROM = `bookings b
  JOIN venues v ON v.venueId = b.venueId AND v.status != 'Deleted'
  JOIN courts c ON c.courtId = b.courtId
  LEFT JOIN users u ON u.accountId = b.createdByAccountId`;

const toBooking = (row) => ({
  ...row,
  price: Number(row.price),
  durationMinutes: moment
    .tz(row.endAt, FORMAT, TIMEZONE)
    .diff(moment.tz(row.startAt, FORMAT, TIMEZONE), "minutes"),
});

/** Only "Paid now (cash)" takes money — that also needs payments write. */
const paymentsWriteForCash = (req, res, next) =>
  req.body?.payment === "Cash" ? checkPermission("payments", null, "write")(req, res, next) : next();

/** Run one utils/bookings.js write in a transaction and answer with its result. */
const inTransaction = async (req, write) => {
  let conn;
  try {
    conn = await req.db.beginTransaction();
    const result = await write(conn);
    if (result.ok) await req.db.commit(conn);
    else await req.db.rollback(conn);
    return result;
  } catch (err) {
    await req.db.rollback(conn);
    throw err;
  }
};

/**
 * GET /options
 * Venues and their courts for the Bookings filters and the New booking drawer.
 */
router.get(
  "/options",
  checkPermission("bookings", null, "read"),
  catchAsync(async (req, res) => {
    const [venues, courts] = await Promise.all([
      req.db.query(
        `SELECT venueId, name, status FROM venues WHERE status != 'Deleted' ORDER BY name ASC`
      ),
      req.db.query(
        `SELECT c.courtId, c.venueId, c.name, c.status
         FROM courts c JOIN venues v ON v.venueId = c.venueId AND v.status != 'Deleted'
         WHERE c.status != 'Deleted'
         ORDER BY c.name ASC`
      ),
    ]);
    return res.sendSuccess("Booking options", { venues, courts });
  })
);

/**
 * GET /?venueId&courtId&status&dateFrom&dateTo&search
 * Bookings (soonest first by default) and the venue's numbers for today.
 */
router.get(
  "/",
  checkPermission("bookings", null, "read"),
  validateQuery(listBookingsQuerySchema),
  catchAsync(async (req, res) => {
    const { page, pageSize, search, venueId, courtId, status, dateFrom, dateTo, sortOrder } =
      req.query;
    await expireHolds(req.db, { venueId });
    const offset = (page - 1) * pageSize;
    const params = [];

    // No status filter → hide soft-deleted. Explicit ?status=Deleted → show them.
    let whereClause = status ? "WHERE b.status = ?" : "WHERE b.status != 'Deleted'";
    if (status) params.push(status);
    if (venueId) {
      whereClause += " AND b.venueId = ?";
      params.push(venueId);
    }
    if (courtId) {
      whereClause += " AND b.courtId = ?";
      params.push(courtId);
    }
    if (dateFrom) {
      whereClause += " AND b.startAt >= ?";
      params.push(`${dateFrom} 00:00:00`);
    }
    if (dateTo) {
      whereClause += " AND b.startAt <= ?";
      params.push(`${dateTo} 23:59:59`);
    }
    if (search) {
      whereClause +=
        " AND (b.playerName LIKE ? OR b.phone LIKE ? OR b.email LIKE ? OR b.bookingCode LIKE ?)";
      const like = `%${search}%`;
      params.push(like, like, like, like.replace(/\s+/g, "").toUpperCase());
    }
    const safeSortOrder = sortOrder === "DESC" ? "DESC" : "ASC";

    const today = getTodayDateLocal();
    const now = getCurrentTimestampLocal();
    const weekAgo = moment().tz(TIMEZONE).subtract(7, "days").format(FORMAT);
    const scope = venueId ? " AND venueId = ?" : "";
    const scopeParams = venueId ? [venueId] : [];

    const [countRows, bookings, stats, revenue] = await Promise.all([
      req.db.query(`SELECT COUNT(*) AS total FROM ${BOOKING_FROM} ${whereClause}`, params),
      req.db.query(
        `SELECT ${BOOKING_COLUMNS} FROM ${BOOKING_FROM}
         ${whereClause}
         ORDER BY b.startAt ${safeSortOrder}
         LIMIT ? OFFSET ?`,
        [...params, Number(pageSize), Number(offset)]
      ),
      req.db.query(
        `SELECT
           SUM(startAt >= ? AND startAt < ? AND status NOT IN ('Cancelled', 'Expired', 'Deleted'))
             AS today,
           SUM(status = 'Pending' AND holdExpiresAt > ?) AS unpaid,
           SUM(status = 'NoShow' AND startAt >= ?) AS noShowsThisWeek
         FROM bookings
         WHERE 1 = 1${scope}`,
        [
          `${today} 00:00:00`,
          moment.tz(today, "YYYY-MM-DD", TIMEZONE).add(1, "day").format(FORMAT),
          now,
          weekAgo,
          ...scopeParams,
        ]
      ),
      req.db.query(
        `SELECT COALESCE(SUM(amount), 0) AS revenueToday
         FROM payments
         WHERE bookingId IS NOT NULL AND status = 'Paid' AND paidAt >= ?${scope}`,
        [`${today} 00:00:00`, ...scopeParams]
      ),
    ]);

    const total = countRows[0]?.total || 0;
    return res.sendSuccess("Bookings retrieved successfully", {
      bookings: bookings.map(toBooking),
      stats: {
        today: Number(stats[0].today || 0),
        unpaid: Number(stats[0].unpaid || 0),
        noShowsThisWeek: Number(stats[0].noShowsThisWeek || 0),
        revenueToday: Number(revenue[0].revenueToday || 0),
      },
      pagination: {
        page: Number(page),
        pageSize: Number(pageSize),
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  })
);

/**
 * GET /day?venueId&date
 * One day at a venue for the courts × hours grid: its opening hours, courts,
 * bookings (not cancelled or expired), games and closures.
 */
router.get(
  "/day",
  checkPermission("bookings", null, "read"),
  validateQuery(dayQuerySchema),
  catchAsync(async (req, res) => {
    const { venueId, date } = req.query;
    const venues = await req.db.query(
      `SELECT venueId, name FROM venues WHERE venueId = ? AND status != 'Deleted' LIMIT 1`,
      [venueId]
    );
    if (venues.length === 0) {
      return res.sendError("Venue not found", 404);
    }
    await expireHolds(req.db, { venueId });

    const dayStart = `${date} 00:00:00`;
    const dayEnd = moment.tz(date, "YYYY-MM-DD", TIMEZONE).add(1, "day").format(FORMAT);
    const window = [dayEnd, dayStart];

    const [hours, courts, bookings, games, closures] = await Promise.all([
      loadVenueHours(req.db, venueId),
      req.db.query(
        `SELECT courtId, name, status FROM courts
         WHERE venueId = ? AND status != 'Deleted'
         ORDER BY name ASC`,
        [venueId]
      ),
      req.db.query(
        `SELECT ${BOOKING_COLUMNS} FROM ${BOOKING_FROM}
         WHERE b.venueId = ? AND b.status NOT IN ('Cancelled', 'Expired', 'Deleted')
           AND b.startAt < ? AND b.endAt > ?
         ORDER BY b.startAt ASC`,
        [venueId, ...window]
      ),
      req.db.query(
        `SELECT s.sessionId, s.courtId, s.bookingId, s.playerName, s.status, s.startAt, s.endAt,
                s.openEnded
         FROM recording_sessions s
         WHERE s.venueId = ? AND s.status NOT IN ('Cancelled', 'Failed')
           AND s.startAt < ? AND s.endAt > ?
         ORDER BY s.startAt ASC`,
        [venueId, ...window]
      ),
      req.db.query(
        `SELECT closureId, courtId, startAt, endAt, reason FROM court_closures
         WHERE venueId = ? AND status = 'Active' AND startAt < ? AND endAt > ?
         ORDER BY startAt ASC`,
        [venueId, ...window]
      ),
    ]);

    const day = hours.get(moment.tz(date, "YYYY-MM-DD", TIMEZONE).day());
    return res.sendSuccess("Day retrieved successfully", {
      date,
      venueName: venues[0].name,
      hours: day ? { opensAt: minutesToTime(day.opensAt), closesAt: minutesToTime(day.closesAt) } : null,
      courts,
      bookings: bookings.map(toBooking),
      games: games.map(({ openEnded, ...g }) => ({ ...g, openEnded: Number(openEnded) === 1 })),
      closures,
    });
  })
);

/**
 * GET /quote?courtId&date&startTime&durationMinutes&bookingId?
 * The price of a slot and whether it's free, for the New booking / Move drawers.
 */
router.get(
  "/quote",
  checkPermission("bookings", null, "read"),
  validateQuery(quoteQuerySchema),
  catchAsync(async (req, res) => {
    const { courtId, date, startTime, durationMinutes, bookingId } = req.query;
    const courts = await req.db.query(
      `SELECT c.courtId, c.venueId FROM courts c
       JOIN venues v ON v.venueId = c.venueId AND v.status != 'Deleted'
       WHERE c.courtId = ? AND c.status != 'Deleted' LIMIT 1`,
      [courtId]
    );
    if (courts.length === 0) {
      return res.sendError("Court not found", 404);
    }
    const startLocal = toStartLocal(date, startTime);
    const endLocal = addMinutesTo(startLocal, durationMinutes);
    const [q, conflict] = await Promise.all([
      quote(req.db, { venueId: courts[0].venueId, courtId, startLocal, durationMinutes }),
      findConflict(req.db, {
        courtId,
        startLocal,
        endLocal,
        ignoreBookingId: bookingId || null,
        checkHours: true,
      }),
    ]);
    return res.sendSuccess("Quote", {
      quote: {
        startAt: startLocal,
        endAt: endLocal,
        bookable: q.bookable,
        price: q.bookable ? q.price : null,
        noRateAt: q.bookable ? null : q.at || null,
        // Outside opening hours is allowed at the desk (ignoreHours); the rest isn't
        outsideHours: conflict?.type === "CLOSED",
        conflict: conflict && conflict.type !== "CLOSED" ? conflictMessage(conflict) : null,
        hasPassed: endLocal <= getCurrentTimestampLocal(),
      },
    });
  })
);

/**
 * GET /:bookingId
 * One booking with its payments and its game (once checked in).
 */
router.get(
  "/:bookingId",
  checkPermission("bookings", null, "read"),
  catchAsync(async (req, res) => {
    await expireHolds(req.db);
    const rows = await req.db.query(
      `SELECT ${BOOKING_COLUMNS} FROM ${BOOKING_FROM}
       WHERE b.bookingId = ? AND b.status != 'Deleted'
       LIMIT 1`,
      [req.params.bookingId]
    );
    if (rows.length === 0) {
      return res.sendError("Booking not found", 404);
    }
    const booking = rows[0];

    const [payments, games, tokens] = await Promise.all([
      req.db.query(
        `SELECT p.paymentId, p.amount, p.method, p.status, p.note, p.paidAt, p.refundedAt,
                p.refundError, CONCAT(u.firstName, ' ', u.lastName) AS receivedBy
         FROM payments p
         LEFT JOIN users u ON u.accountId = p.receivedByAccountId
         WHERE p.bookingId = ?
         ORDER BY p.paidAt ASC`,
        [booking.bookingId]
      ),
      booking.sessionId
        ? req.db.query(
            `SELECT sessionId, status, startAt, endAt FROM recording_sessions WHERE sessionId = ?`,
            [booking.sessionId]
          )
        : Promise.resolve([]),
      req.db.query(`SELECT manageToken FROM bookings WHERE bookingId = ?`, [booking.bookingId]),
    ]);

    return res.sendSuccess("Booking retrieved successfully", {
      booking: {
        ...toBooking(booking),
        // The player's own booking page, for the desk to share
        manageUrl: bookingManageUrl(tokens[0].manageToken),
        payments: payments.map((p) => ({ ...p, amount: Number(p.amount) })),
        game: games[0] || null,
      },
    });
  })
);

/**
 * POST /
 * A desk booking. payment: Cash (paid now — also needs payments write) ·
 * Hold (pay at the desk by startAt − the venue's deskHoldMinutes) · Free.
 */
router.post(
  "/",
  checkPermission("bookings", null, "write"),
  paymentsWriteForCash,
  validateBody(createBookingSchema),
  catchAsync(async (req, res) => {
    const { courtId, date, startTime, durationMinutes, playerName, phone, email, payment, note } =
      req.body;
    const result = await inTransaction(req, (conn) =>
      createBooking(conn, {
        courtId,
        startLocal: toStartLocal(date, startTime),
        durationMinutes,
        playerName,
        phone,
        email,
        payment,
        source: "Desk",
        ignoreHours: req.body.ignoreHours,
        accountId: req.user.accountId,
        note,
      })
    );
    if (!result.ok) {
      return res.sendError(result.message, result.status);
    }
    return res.sendSuccess(
      result.status === "Pending" ? "Booking held — waiting for payment at the desk" : "Booking confirmed",
      {
        bookingId: result.bookingId,
        bookingCode: result.bookingCode,
        status: result.status,
        price: result.price,
      },
      201
    );
  })
);

/**
 * PUT /:bookingId/move
 * Another time and/or court at the same venue, same length.
 */
router.put(
  "/:bookingId/move",
  checkPermission("bookings", null, "write"),
  validateBody(moveBookingSchema),
  catchAsync(async (req, res) => {
    const { courtId, date, startTime, reprice, ignoreHours } = req.body;
    const result = await inTransaction(req, (conn) =>
      moveBooking(conn, {
        bookingId: req.params.bookingId,
        courtId,
        startLocal: toStartLocal(date, startTime),
        reprice,
        ignoreHours,
      })
    );
    if (!result.ok) {
      return res.sendError(result.message, result.status);
    }
    return res.sendSuccess("Booking moved", {
      startAt: result.startAt,
      endAt: result.endAt,
      price: result.price,
    });
  })
);

/**
 * POST /:bookingId/cancel
 * Any time before it's played. refund (default on) refunds what was paid.
 */
router.post(
  "/:bookingId/cancel",
  checkPermission("bookings", null, "write"),
  validateBody(cancelBookingSchema),
  catchAsync(async (req, res) => {
    const { reason, refund } = req.body;
    const result = await inTransaction(req, (conn) =>
      cancelBooking(conn, {
        bookingId: req.params.bookingId,
        by: "Staff",
        reason,
        refund,
        accountId: req.user.accountId,
      })
    );
    if (!result.ok) {
      return res.sendError(result.message, result.status);
    }
    return res.sendSuccess(
      result.refunded > 0
        ? `Booking cancelled — refund ₱${result.refunded.toLocaleString("en-PH")} to the player`
        : "Booking cancelled",
      { refunded: result.refunded }
    );
  })
);

/**
 * POST /:bookingId/no-show
 */
router.post(
  "/:bookingId/no-show",
  checkPermission("bookings", null, "write"),
  catchAsync(async (req, res) => {
    const result = await inTransaction(req, (conn) =>
      markNoShow(conn, { bookingId: req.params.bookingId })
    );
    if (!result.ok) {
      return res.sendError(result.message, result.status);
    }
    return res.sendSuccess("Marked as a no-show");
  })
);

/**
 * POST /:bookingId/payments
 * The player paid a held booking at the desk (its price, in cash) → Confirmed.
 */
router.post(
  "/:bookingId/payments",
  checkPermission("payments", null, "write"),
  validateBody(bookingPaymentSchema),
  catchAsync(async (req, res) => {
    const result = await inTransaction(req, (conn) =>
      recordBookingPayment(conn, {
        bookingId: req.params.bookingId,
        accountId: req.user.accountId,
        note: req.body.note,
      })
    );
    if (!result.ok) {
      return res.sendError(result.message, result.status);
    }
    return res.sendSuccess(
      "Payment recorded — the booking is confirmed",
      { paymentId: result.paymentId, amount: result.amount },
      201
    );
  })
);

/**
 * DELETE /:bookingId
 * Soft delete — for a booking made by mistake. One with payments is cancelled
 * instead, so the money stays accounted for.
 */
router.delete(
  "/:bookingId",
  checkPermission("bookings", null, "write"),
  catchAsync(async (req, res) => {
    const { bookingId } = req.params;
    const now = getCurrentTimestampLocal();
    let conn;
    try {
      conn = await req.db.beginTransaction();
      const [rows] = await conn.execute(
        `SELECT b.bookingId, b.status FROM bookings b
         JOIN venues v ON v.venueId = b.venueId AND v.status != 'Deleted'
         WHERE b.bookingId = ? AND b.status != 'Deleted'
         LIMIT 1 FOR UPDATE`,
        [bookingId]
      );
      if (rows.length === 0) {
        await req.db.rollback(conn);
        return res.sendError("Booking not found", 404);
      }
      if (["CheckedIn", "Completed"].includes(rows[0].status)) {
        await req.db.rollback(conn);
        return res.sendError("This booking has been played — it can't be deleted", 409);
      }
      const [payments] = await conn.execute(
        `SELECT 1 FROM payments WHERE bookingId = ? LIMIT 1`,
        [bookingId]
      );
      if (payments.length > 0) {
        await req.db.rollback(conn);
        return res.sendError("This booking has payments — cancel it instead", 409);
      }
      await conn.execute(
        `UPDATE bookings SET status = 'Deleted', holdExpiresAt = NULL, dateUpdated = ?
         WHERE bookingId = ?`,
        [now, bookingId]
      );
      await req.db.commit(conn);
      return res.sendSuccess("Booking deleted");
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
  })
);

export default router;
