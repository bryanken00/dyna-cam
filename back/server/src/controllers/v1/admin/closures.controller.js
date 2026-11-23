import express from "express";
import { catchAsync, validateBody, validateQuery } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal } from "../../../utils/dateUtils.js";
import { ERROR_CODES } from "../../../utils/APIError.js";
import { checkPermission } from "../../../middlewares/checkPermission.middleware.js";
import { LIVE_BOOKING } from "../../../utils/courtTimeline.js";
import { cancelBooking } from "../../../utils/bookings.js";
import { runPaymentFollowUps } from "../../../utils/bookingPayments.js";
import {
  createClosureSchema,
  listClosuresQuerySchema,
  updateClosureSchema,
} from "../../../validators/closures.validator.js";

/**
 * PLAN-003 Phase A — closures (blackouts): a court, or the whole venue, can't
 * be booked or played on for a while (maintenance, an event, a tournament).
 * Permission: bookings.
 *
 * A closure can't land on an open game, and it lands on live bookings only
 * when staff choose to cancel them (cancelConflicts) — otherwise the 409 lists
 * them (error.conflicts).
 */
const router = express.Router();

const CLOSURE_COLUMNS = `cl.closureId, cl.venueId, cl.courtId, c.name AS courtName, cl.startAt,
  cl.endAt, cl.reason, cl.status, cl.dateCreated, cl.dateUpdated`;

const CLOSURE_FROM = `court_closures cl
  JOIN venues v ON v.venueId = cl.venueId AND v.status != 'Deleted'
  LEFT JOIN courts c ON c.courtId = cl.courtId`;

/**
 * Inside the writer's transaction: lock the courts the closure covers (one, or
 * every court at the venue) so no booking or game lands on them meanwhile,
 * then find what's in the way.
 *
 * @returns {Promise<{ games: Array, bookings: Array }>}
 */
const findInTheWay = async (conn, { venueId, courtId, startAt, endAt, now }) => {
  await conn.execute(
    `SELECT courtId FROM courts
     WHERE venueId = ? AND (? IS NULL OR courtId = ?) AND status != 'Deleted'
     FOR UPDATE`,
    [venueId, courtId, courtId]
  );

  const [games] = await conn.execute(
    `SELECT s.sessionId, c.name AS courtName, s.startAt, s.endAt
     FROM recording_sessions s JOIN courts c ON c.courtId = s.courtId
     WHERE s.venueId = ? AND (? IS NULL OR s.courtId = ?)
       AND s.status IN ('Waiting', 'Scheduled', 'Recording')
       AND s.startAt < ? AND s.endAt > ?
     ORDER BY s.startAt ASC`,
    [venueId, courtId, courtId, endAt, startAt]
  );

  // A checked-in booking is its game (above)
  const [bookings] = await conn.execute(
    `SELECT b.bookingId, b.bookingCode, b.playerName, c.name AS courtName, b.startAt, b.endAt,
            b.status, b.paymentStatus
     FROM bookings b JOIN courts c ON c.courtId = b.courtId
     WHERE b.venueId = ? AND (? IS NULL OR b.courtId = ?)
       AND ${LIVE_BOOKING} AND b.status != 'CheckedIn'
       AND b.startAt < ? AND b.endAt > ?
     ORDER BY b.startAt ASC
     FOR UPDATE`,
    [venueId, courtId, courtId, now, endAt, startAt]
  );

  return { games, bookings };
};

/**
 * The shared checks of POST and PUT, inside their transaction. Returns an
 * error reply to send, or null when the closure may be saved (having
 * cancelled the bookings in the way if asked to). Each cancelled booking's
 * payment follow-up (Phase F: online refunds, open checkouts) is pushed onto
 * followUps, to run after the commit.
 */
const checkWindow = async (
  conn,
  { venueId, courtId, startAt, endAt, reason, cancelConflicts, now, accountId, followUps }
) => {
  if (endAt <= now) {
    return { message: "The closure must end in the future", status: 400 };
  }

  if (courtId) {
    const [courts] = await conn.execute(
      `SELECT courtId FROM courts WHERE courtId = ? AND venueId = ? AND status != 'Deleted'`,
      [courtId, venueId]
    );
    if (courts.length === 0) {
      return { message: "Pick a court at this venue", status: 400 };
    }
  }

  const { games, bookings } = await findInTheWay(conn, { venueId, courtId, startAt, endAt, now });

  if (games.length > 0) {
    return {
      message: `A game is on ${games[0].courtName} then — end it before closing the court`,
      status: 409,
      code: ERROR_CODES.INVALID_STATUS,
    };
  }

  if (bookings.length > 0 && !cancelConflicts) {
    return {
      message:
        bookings.length === 1
          ? "1 booking is in the way of this closure"
          : `${bookings.length} bookings are in the way of this closure`,
      status: 409,
      code: ERROR_CODES.BOOKINGS_IN_THE_WAY,
      error: {
        conflicts: bookings.map((b) => ({
          bookingCode: b.bookingCode,
          playerName: b.playerName,
          courtName: b.courtName,
          startAt: b.startAt,
          endAt: b.endAt,
          paymentStatus: b.paymentStatus,
        })),
      },
    };
  }

  // The court is closed on them: cancelled and, if paid, refunded in full
  const cancelReason = reason ? `Court closed: ${reason}` : "Court closed";
  for (const booking of bookings) {
    const cancelled = await cancelBooking(conn, {
      bookingId: booking.bookingId,
      by: "Staff",
      reason: cancelReason,
      refund: true,
      accountId,
    });
    if (!cancelled.ok) return { message: cancelled.message, status: cancelled.status };
    followUps.push(cancelled.followUp);
  }
  return null;
};

/** After commit: refund the cancelled bookings' online payments, close their checkouts. */
const refundCancelled = async (req, followUps) => {
  for (const followUp of followUps) {
    await runPaymentFollowUps(req.db, followUp, {
      accountId: req.user.accountId,
      reason: "CANCELLATION",
    });
  }
};

/**
 * GET /?venueId=&when=upcoming|past|all
 * A venue's closures — upcoming (not ended) soonest first, past latest first.
 */
router.get(
  "/",
  checkPermission("bookings", null, "read"),
  validateQuery(listClosuresQuerySchema),
  catchAsync(async (req, res) => {
    const { venueId, when, page, pageSize } = req.query;
    const now = getCurrentTimestampLocal();
    const offset = (page - 1) * pageSize;

    let whereClause = "WHERE cl.venueId = ? AND cl.status != 'Deleted'";
    const params = [venueId];
    if (when === "upcoming") {
      whereClause += " AND cl.endAt > ?";
      params.push(now);
    } else if (when === "past") {
      whereClause += " AND cl.endAt <= ?";
      params.push(now);
    }
    const order = when === "upcoming" ? "ASC" : "DESC";

    const [countRows, closures] = await Promise.all([
      req.db.query(`SELECT COUNT(*) AS total FROM ${CLOSURE_FROM} ${whereClause}`, params),
      req.db.query(
        `SELECT ${CLOSURE_COLUMNS} FROM ${CLOSURE_FROM}
         ${whereClause}
         ORDER BY cl.startAt ${order}
         LIMIT ? OFFSET ?`,
        [...params, Number(pageSize), Number(offset)]
      ),
    ]);
    const total = countRows[0]?.total || 0;

    return res.sendSuccess("Closures retrieved successfully", {
      closures,
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
 * GET /:closureId
 */
router.get(
  "/:closureId",
  checkPermission("bookings", null, "read"),
  catchAsync(async (req, res) => {
    const rows = await req.db.query(
      `SELECT ${CLOSURE_COLUMNS} FROM ${CLOSURE_FROM}
       WHERE cl.closureId = ? AND cl.status != 'Deleted'
       LIMIT 1`,
      [req.params.closureId]
    );
    if (rows.length === 0) {
      return res.sendError("Closure not found", 404);
    }
    return res.sendSuccess("Closure retrieved successfully", { closure: rows[0] });
  })
);

/**
 * POST /
 * Body: { venueId, courtId?, startAt, endAt, reason?, cancelConflicts? }
 */
router.post(
  "/",
  checkPermission("bookings", null, "write"),
  validateBody(createClosureSchema),
  catchAsync(async (req, res) => {
    const { venueId, courtId = null, startAt, endAt, reason, cancelConflicts } = req.body;
    const now = getCurrentTimestampLocal();
    const followUps = [];

    let conn;
    try {
      conn = await req.db.beginTransaction();

      const [venues] = await conn.execute(
        `SELECT venueId FROM venues WHERE venueId = ? AND status != 'Deleted' LIMIT 1`,
        [venueId]
      );
      if (venues.length === 0) {
        await req.db.rollback(conn);
        return res.sendError("Venue not found", 404);
      }

      const refusal = await checkWindow(conn, {
        venueId,
        courtId,
        startAt,
        endAt,
        reason,
        cancelConflicts,
        accountId: req.user.accountId,
        now,
        followUps,
      });
      if (refusal) {
        await req.db.rollback(conn);
        return res.sendError(refusal.message, refusal.error || null, refusal.status, refusal.code);
      }

      const [uuidRow] = await conn.execute(`SELECT UUID() as id`);
      const closureId = uuidRow[0].id;
      await conn.execute(
        `INSERT INTO court_closures
           (closureId, venueId, courtId, startAt, endAt, reason, createdByAccountId, status,
            dateCreated, dateUpdated)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?)`,
        [closureId, venueId, courtId, startAt, endAt, reason || null, req.user.accountId, now, now]
      );

      await req.db.commit(conn);
      await refundCancelled(req, followUps);
      return res.sendSuccess("Closure added", { closureId }, 201);
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
  })
);

/**
 * PUT /:closureId
 * Body: { courtId?, startAt, endAt, reason?, cancelConflicts? } — same checks as POST.
 */
router.put(
  "/:closureId",
  checkPermission("bookings", null, "write"),
  validateBody(updateClosureSchema),
  catchAsync(async (req, res) => {
    const { closureId } = req.params;
    const { courtId = null, startAt, endAt, reason, cancelConflicts } = req.body;
    const now = getCurrentTimestampLocal();
    const followUps = [];

    let conn;
    try {
      conn = await req.db.beginTransaction();

      const [rows] = await conn.execute(
        `SELECT cl.closureId, cl.venueId FROM ${CLOSURE_FROM}
         WHERE cl.closureId = ? AND cl.status != 'Deleted'
         LIMIT 1 FOR UPDATE`,
        [closureId]
      );
      if (rows.length === 0) {
        await req.db.rollback(conn);
        return res.sendError("Closure not found", 404);
      }

      const refusal = await checkWindow(conn, {
        venueId: rows[0].venueId,
        courtId,
        startAt,
        endAt,
        reason,
        cancelConflicts,
        accountId: req.user.accountId,
        now,
        followUps,
      });
      if (refusal) {
        await req.db.rollback(conn);
        return res.sendError(refusal.message, refusal.error || null, refusal.status, refusal.code);
      }

      await conn.execute(
        `UPDATE court_closures
         SET courtId = ?, startAt = ?, endAt = ?, reason = ?, dateUpdated = ?
         WHERE closureId = ?`,
        [courtId, startAt, endAt, reason || null, now, closureId]
      );

      await req.db.commit(conn);
      await refundCancelled(req, followUps);
      return res.sendSuccess("Closure updated");
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
  })
);

/**
 * DELETE /:closureId — soft delete; the court can be booked again.
 */
router.delete(
  "/:closureId",
  checkPermission("bookings", null, "write"),
  catchAsync(async (req, res) => {
    const result = await req.db.query(
      `UPDATE court_closures cl
       JOIN venues v ON v.venueId = cl.venueId AND v.status != 'Deleted'
       SET cl.status = 'Deleted', cl.dateUpdated = ?
       WHERE cl.closureId = ? AND cl.status != 'Deleted'`,
      [getCurrentTimestampLocal(), req.params.closureId]
    );
    if (result.affectedRows === 0) {
      return res.sendError("Closure not found", 404);
    }
    return res.sendSuccess("Closure removed");
  })
);

export default router;
