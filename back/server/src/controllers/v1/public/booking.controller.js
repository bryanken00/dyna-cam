import express from "express";
import {
  catchAsync,
  validateBody,
  validateParams,
  validateQuery,
} from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal, getTodayDateLocal, moment } from "../../../utils/dateUtils.js";
import { dynamicLimiter } from "../../../middlewares/rateLimiter.js";
import { hashToken } from "../../../utils/crypto/tokens.js";
import { bookingManageUrl, sessionShareUrl } from "../../../utils/clips.js";
import { checkInBooking } from "../../../utils/bookingCheckIn.js";
import { advanceSessions } from "../../../utils/sessions.js";
import { signUploadUrl } from "../../../utils/file/signedUrl.js";
import { loadVenueHours } from "../../../utils/courtTimeline.js";
import { dayAvailability } from "../../../utils/bookingAvailability.js";
import {
  cancelBooking,
  createBooking,
  expireHolds,
  moveBooking,
  toStartLocal,
} from "../../../utils/bookings.js";
import { isOnlinePaymentOn } from "../../../lib/payments/xendit.js";
import { describeSlot, sendBookingEmail, sendCreatedEmail } from "../../../utils/bookingEmails.js";
import {
  MIN_CHECKOUT_SECONDS,
  openCheckout,
  resumeCheckout,
  runPaymentFollowUps,
  settleInvoice,
} from "../../../utils/bookingPayments.js";
import {
  availabilityQuerySchema,
  bookingTokenParamsSchema,
  manageTokenParamsSchema,
  moveOptionsQuerySchema,
  playerMoveSchema,
  publicBookingSchema,
} from "../../../validators/public.validator.js";

/**
 * PLAN-003 Phase C — the player's booking pages, mounted at /api/v1/public with
 * NO login. A venue's online booking link (/book/:bookingToken) and a
 * booking's own link (/bookings/:manageToken) are the credentials. Replies
 * carry no business IDs: courts are named by a key derived from the link, and
 * availability never says who booked what.
 *
 *   GET  /book/:bookingToken                     the venue, its courts and booking rules
 *   GET  /book/:bookingToken/availability        free hours per court for a date and length
 *   POST /book/:bookingToken/bookings            book a slot: pay at the desk, or online (Phase F)
 *   GET  /bookings/:manageToken                  one booking: status, code, what can be done now
 *   POST /bookings/:manageToken/pay              Phase F: the booking's Xendit checkout
 *   POST /bookings/:manageToken/check-in         Phase D: start the booked game
 *   POST /bookings/:manageToken/cancel           Phase H: cancel before the cut-off (full refund)
 *   GET  /bookings/:manageToken/move-options     Phase H: free times at the same or a lower price
 *   POST /bookings/:manageToken/move             Phase H: move it, once, before the cut-off
 */
const router = express.Router();

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";

// Per IP: booking is a few-times-a-week thing; a few tries a minute covers a
// slot taken while the form was open
const createBookingLimiter = dynamicLimiter({
  points: parseInt(process.env.RATE_LIMIT_PUBLIC_BOOK_POINTS || "5", 10),
  duration: 60,
  keyGenerator: (req) => `public-book:${req.ip}`,
  message: "Too many tries — wait a minute and try again.",
});

/** A court's public key: stable while the venue keeps its link, says nothing about the court. */
const courtKey = (bookingToken, courtId) => hashToken(`${bookingToken}:${courtId}`).slice(0, 16);

/** Phase H: a court's key on a booking's own page (the venue's link may be off or replaced). */
const moveCourtKey = (manageToken, courtId) =>
  hashToken(`move:${manageToken}:${courtId}`).slice(0, 16);

/** The venue an online booking link belongs to (Active, online booking on), or null. */
const findVenue = async (db, bookingToken) => {
  const rows = await db.query(
    `SELECT venueId, name, address, phone, logoUrl, maxBookingMinutes, bookingDaysAhead,
            deskHoldMinutes, onlineHoldMinutes, cancelCutoffHours, checkInEarlyMinutes
     FROM venues
     WHERE bookingToken = ? AND status = 'Active'
     LIMIT 1`,
    [bookingToken]
  );
  return rows[0] || null;
};

const activeCourts = (db, venueId) =>
  db.query(
    `SELECT courtId, name FROM courts WHERE venueId = ? AND status = 'Active' ORDER BY name ASC`,
    [venueId]
  );

/** The first and last date a player may book (today … bookingDaysAhead). */
const bookableDates = (venue) => {
  const today = getTodayDateLocal();
  const lastDate = moment
    .tz(today, "YYYY-MM-DD", TIMEZONE)
    .add(venue.bookingDaysAhead, "days")
    .format("YYYY-MM-DD");
  return { today, lastDate };
};

/** Why a date or length can't be booked, or null. */
const dateProblem = (venue, date, durationMinutes) => {
  const { today, lastDate } = bookableDates(venue);
  if (date < today) return "That date has passed";
  if (date > lastDate) return `You can book up to ${venue.bookingDaysAhead} days ahead`;
  if (durationMinutes > venue.maxBookingMinutes) {
    return `Bookings here are at most ${venue.maxBookingMinutes / 60} hours`;
  }
  return null;
};

const venueView = (venue) => ({
  name: venue.name,
  address: venue.address,
  phone: venue.phone,
  logoUrl: signUploadUrl(venue.logoUrl),
});

/**
 * GET /book/:bookingToken
 * The booking page's frame: the venue, its courts, which weekdays it opens,
 * the dates and lengths a player can pick, and the rules shown before booking.
 */
router.get(
  "/book/:bookingToken",
  validateParams(bookingTokenParamsSchema),
  catchAsync(async (req, res) => {
    const venue = await findVenue(req.db, req.params.bookingToken);
    if (!venue) {
      return res.sendError("This booking link isn't valid", 404);
    }
    const [courts, hours] = await Promise.all([
      activeCourts(req.db, venue.venueId),
      loadVenueHours(req.db, venue.venueId),
    ]);
    const { today, lastDate } = bookableDates(venue);

    return res.sendSuccess("Booking page", {
      venue: venueView(venue),
      courts: courts.map((c) => ({
        key: courtKey(req.params.bookingToken, c.courtId),
        name: c.name,
      })),
      openDays: [...hours.keys()].sort((a, b) => a - b),
      today,
      lastDate,
      rules: {
        maxBookingMinutes: venue.maxBookingMinutes,
        deskHoldMinutes: venue.deskHoldMinutes,
        onlineHoldMinutes: venue.onlineHoldMinutes,
        cancelCutoffHours: venue.cancelCutoffHours,
        checkInEarlyMinutes: venue.checkInEarlyMinutes,
      },
      // Phase F: Xendit is set up on the server
      payOnline: isOnlinePaymentOn(),
    });
  })
);

/**
 * GET /book/:bookingToken/availability?date=&durationMinutes=
 * Each court's start times that day for that length: free (with its price) or not.
 */
router.get(
  "/book/:bookingToken/availability",
  validateParams(bookingTokenParamsSchema),
  validateQuery(availabilityQuerySchema),
  catchAsync(async (req, res) => {
    const venue = await findVenue(req.db, req.params.bookingToken);
    if (!venue) {
      return res.sendError("This booking link isn't valid", 404);
    }
    const { date, durationMinutes } = req.query;
    const problem = dateProblem(venue, date, durationMinutes);
    if (problem) {
      return res.sendError(problem, 400);
    }

    await expireHolds(req.db, { venueId: venue.venueId });
    const courts = await activeCourts(req.db, venue.venueId);
    const day = await dayAvailability(req.db, {
      venueId: venue.venueId,
      courts,
      date,
      durationMinutes,
    });

    return res.sendSuccess("Availability", {
      date,
      durationMinutes,
      hours: day.hours,
      courts: day.courts.map((c) => ({
        key: courtKey(req.params.bookingToken, c.courtId),
        name: c.name,
        slots: c.slots,
      })),
    });
  })
);

/**
 * POST /book/:bookingToken/bookings
 * Body: { courtKey, date, startTime, durationMinutes, playerName, phone?, email, payMethod }
 * Pay at the desk: the slot is held until deskHoldMinutes before the start.
 * 201 { bookingCode, manageToken, manageUrl } — the player's own booking page.
 */
router.post(
  "/book/:bookingToken/bookings",
  createBookingLimiter,
  validateParams(bookingTokenParamsSchema),
  validateBody(publicBookingSchema),
  catchAsync(async (req, res) => {
    const { bookingToken } = req.params;
    const venue = await findVenue(req.db, bookingToken);
    if (!venue) {
      return res.sendError("This booking link isn't valid", 404);
    }
    const { date, startTime, durationMinutes, playerName, phone, email, payMethod } = req.body;
    const online = payMethod === "Online";
    if (online && !isOnlinePaymentOn()) {
      return res.sendError("Online payment isn't available here — choose Pay at the desk", 409);
    }
    const problem = dateProblem(venue, date, durationMinutes);
    if (problem) {
      return res.sendError(problem, 400);
    }

    const courts = await activeCourts(req.db, venue.venueId);
    const court = courts.find((c) => courtKey(bookingToken, c.courtId) === req.body.courtKey);
    if (!court) {
      return res.sendError(
        "That court isn't taking bookings — reload the page and pick again",
        400
      );
    }

    let conn;
    let result;
    try {
      conn = await req.db.beginTransaction();
      result = await createBooking(conn, {
        courtId: court.courtId,
        startLocal: toStartLocal(date, startTime),
        durationMinutes,
        playerName,
        phone,
        email,
        payment: online ? "Online" : "Hold",
        source: "Online",
      });
      if (result.ok) await req.db.commit(conn);
      else await req.db.rollback(conn);
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }

    if (!result.ok) {
      return res.sendError(result.message, result.status);
    }
    const reply = {
      bookingCode: result.bookingCode,
      manageToken: result.manageToken,
      manageUrl: bookingManageUrl(result.manageToken),
      checkoutUrl: null,
    };

    // Phase F: the slot is held; now open its Xendit checkout (outside the
    // transaction — it's a call to Xendit). If that fails, the hold is let go.
    if (online && result.status === "Pending") {
      const checkout = await openCheckout(req.db, { bookingId: result.bookingId });
      if (!checkout.ok) {
        await releaseHold(req.db, result.bookingId);
        return res.sendError(checkout.message, checkout.status);
      }
      reply.checkoutUrl = checkout.checkoutUrl;
      return res.sendSuccess("Booked — pay now to confirm it", reply, 201);
    }
    // Phase G: a desk hold → the pay-by email; free → the confirmation
    await sendCreatedEmail(req.db, result);
    return res.sendSuccess(
      result.status === "Pending"
        ? "Booked — pay at the desk to confirm it"
        : "Booked — you're all set",
      reply,
      201
    );
  })
);

/** A held booking whose checkout couldn't be opened gives its slot back. */
const releaseHold = async (db, bookingId) => {
  let conn;
  try {
    conn = await db.beginTransaction();
    const cancelled = await cancelBooking(conn, {
      bookingId,
      by: "System",
      reason: "Online payment could not be started",
      refund: false,
    });
    if (cancelled.ok) await db.commit(conn);
    else await db.rollback(conn);
  } catch (err) {
    await db.rollback(conn);
    throw err;
  }
};

// The player's page polls while a checkout is open; Xendit is asked at most
// this often per booking, so a webhook that's late (or can't reach a
// development machine) doesn't leave a paid booking looking unpaid
const CHECKOUT_SYNC_MS = 15 * 1000;
const lastCheckoutSync = new Map();

/** Settle a paid checkout the webhook hasn't reported yet. Never throws. */
const syncCheckout = async (db, checkoutId) => {
  const last = lastCheckoutSync.get(checkoutId) || 0;
  if (Date.now() - last < CHECKOUT_SYNC_MS) return false;
  lastCheckoutSync.set(checkoutId, Date.now());
  if (lastCheckoutSync.size > 5000) {
    for (const [id, at] of lastCheckoutSync) {
      if (Date.now() - at > CHECKOUT_SYNC_MS) lastCheckoutSync.delete(id);
    }
  }
  try {
    const settled = await settleInvoice(db, checkoutId);
    return settled.outcome === "CONFIRMED";
  } catch {
    return false;
  }
};

const BOOKING_PAGE_SELECT = `SELECT b.bookingId, b.bookingCode, b.startAt, b.endAt, b.playerName,
              b.email, b.price, b.paymentStatus, b.payMethod, b.holdExpiresAt, b.checkoutId,
              b.status, b.cancelledAt, b.cancelledBy, b.rescheduledCount, b.venueId, b.courtId,
              c.name AS courtName, v.name, v.address, v.phone, v.logoUrl, v.cancelCutoffHours,
              v.checkInEarlyMinutes, v.bookingDaysAhead, s.shareToken AS gameShareToken,
              EXISTS (SELECT 1 FROM payments p
                      WHERE p.bookingId = b.bookingId AND p.status = 'Paid' AND p.method = 'CASH')
                AS paidCash
       FROM bookings b
       JOIN courts c ON c.courtId = b.courtId
       JOIN venues v ON v.venueId = b.venueId AND v.status != 'Deleted'
       LEFT JOIN recording_sessions s ON s.sessionId = b.sessionId
       WHERE b.manageToken = ? AND b.status != 'Deleted'
       LIMIT 1`;

/** Can the player pay this booking online now? */
const canPayOnline = (b, now) =>
  isOnlinePaymentOn() &&
  b.status === "Pending" &&
  b.paymentStatus === "Unpaid" &&
  Boolean(b.holdExpiresAt) &&
  moment.tz(b.holdExpiresAt, FORMAT, TIMEZONE).diff(moment.tz(now, FORMAT, TIMEZONE), "seconds") >=
    MIN_CHECKOUT_SECONDS;

/**
 * Phase H: what the player may change themselves, and why not. Only an
 * unplayed booking, before the venue's cut-off; a cash payment is given back
 * at the desk, so that one is cancelled there; a booking moves once.
 */
const playerChanges = (b, now) => {
  const cutoffAt = moment
    .tz(b.startAt, FORMAT, TIMEZONE)
    .subtract(b.cancelCutoffHours, "hours")
    .format(FORMAT);
  const open = ["Pending", "Confirmed"].includes(b.status);
  const beforeCutoff = now < cutoffAt;
  return {
    cutoffAt,
    cutoffPassed: open && !beforeCutoff,
    paidAtDesk: Number(b.paidCash) === 1,
    movedOnce: Number(b.rescheduledCount) > 0,
    cancel: open && beforeCutoff && Number(b.paidCash) !== 1,
    move: open && beforeCutoff && Number(b.rescheduledCount) === 0,
  };
};

/**
 * GET /bookings/:manageToken
 * The player's booking: where and when, its price and payment, its status, and
 * what they can do now (pay online, check in, cancel, move).
 */
router.get(
  "/bookings/:manageToken",
  validateParams(manageTokenParamsSchema),
  catchAsync(async (req, res) => {
    await expireHolds(req.db);
    let rows = await req.db.query(BOOKING_PAGE_SELECT, [req.params.manageToken]);
    if (rows.length === 0) {
      return res.sendError("This booking link isn't valid", 404);
    }
    // Phase F: back from the checkout, before the webhook — ask Xendit
    if (
      rows[0].status === "Pending" &&
      rows[0].checkoutId &&
      isOnlinePaymentOn() &&
      (await syncCheckout(req.db, rows[0].checkoutId))
    ) {
      rows = await req.db.query(BOOKING_PAGE_SELECT, [req.params.manageToken]);
    }
    const b = rows[0];
    const start = moment.tz(b.startAt, FORMAT, TIMEZONE);
    const now = getCurrentTimestampLocal();
    const checkInFrom = start.clone().subtract(b.checkInEarlyMinutes, "minutes").format(FORMAT);
    const changes = playerChanges(b, now);

    return res.sendSuccess("Booking", {
      booking: {
        bookingCode: b.bookingCode,
        status: b.status,
        venue: venueView(b),
        courtName: b.courtName,
        startAt: b.startAt,
        endAt: b.endAt,
        durationMinutes: moment.tz(b.endAt, FORMAT, TIMEZONE).diff(start, "minutes"),
        playerName: b.playerName,
        email: b.email,
        price: Number(b.price),
        paymentStatus: b.paymentStatus,
        payMethod: b.payMethod,
        // Pay by then (at the desk, or online), or the slot is released
        payBy: b.status === "Pending" ? b.holdExpiresAt : null,
        // Phase F: a checkout is open — the page polls until the payment lands
        checkoutOpen: b.status === "Pending" && Boolean(b.checkoutId),
        cancelledAt: b.cancelledAt,
        cancelledBy: b.cancelledBy,
        cancelCutoffAt: changes.cutoffAt,
        // Phase H: why Cancel / Move may be missing — past the cut-off, paid in cash, moved once
        cutoffPassed: changes.cutoffPassed,
        paidAtDesk: changes.paidAtDesk,
        movedOnce: changes.movedOnce,
        checkInFrom,
        hasEnded: b.endAt <= now,
        // Phase D: the game's page once checked in
        gameUrl: b.gameShareToken ? sessionShareUrl(b.gameShareToken) : null,
        gameShareToken: b.gameShareToken || null,
        actions: {
          checkIn: b.status === "Confirmed" && now >= checkInFrom && now < b.endAt,
          payOnline: canPayOnline(b, now),
          cancel: changes.cancel,
          move: changes.move,
        },
      },
    });
  })
);

// Per IP: cancelling or moving is rare; a few taps a minute covers retries
const changeLimiter = dynamicLimiter({
  points: parseInt(process.env.RATE_LIMIT_PUBLIC_CHANGE_POINTS || "10", 10),
  duration: 60,
  keyGenerator: (req) => `public-booking-change:${req.ip}`,
  message: "Too many tries — wait a minute and try again.",
});

/** The booking behind a manage link (with what playerChanges() needs), or null. */
const findManagedBooking = async (db, manageToken) => {
  await expireHolds(db);
  const rows = await db.query(BOOKING_PAGE_SELECT, [manageToken]);
  return rows[0] || null;
};

/** Why the player can't change it now, in their words — or null. */
const changeRefusal = (b, changes, what) => {
  if (!["Pending", "Confirmed"].includes(b.status)) {
    return b.status === "CheckedIn" || b.status === "Completed"
      ? "This booking has been played"
      : `This booking is ${b.status === "NoShow" ? "a no-show" : b.status.toLowerCase()} — it can't be changed`;
  }
  if (changes.cutoffPassed)
    return `It's too close to the start to ${what} it online — call the venue`;
  if (what === "cancel" && changes.paidAtDesk) {
    return "It was paid at the desk — call the venue to cancel it and get your money back";
  }
  if (what === "move" && changes.movedOnce) {
    return "You've already moved this booking once — call the venue to change it again";
  }
  return null;
};

/** Run one utils/bookings.js write in a transaction. */
const inTransaction = async (db, write) => {
  let conn;
  try {
    conn = await db.beginTransaction();
    const result = await write(conn);
    if (result.ok) await db.commit(conn);
    else await db.rollback(conn);
    return result;
  } catch (err) {
    await db.rollback(conn);
    throw err;
  }
};

/**
 * POST /bookings/:manageToken/cancel
 * Phase H: the player cancels before the venue's cut-off — a full refund of
 * an online payment (Xendit), an open checkout closed. After the cut-off, or
 * when it was paid in cash at the desk, 409 "call the venue".
 */
router.post(
  "/bookings/:manageToken/cancel",
  changeLimiter,
  validateParams(manageTokenParamsSchema),
  catchAsync(async (req, res) => {
    const b = await findManagedBooking(req.db, req.params.manageToken);
    if (!b) {
      return res.sendError("This booking link isn't valid", 404);
    }
    const refusal = changeRefusal(b, playerChanges(b, getCurrentTimestampLocal()), "cancel");
    if (refusal) {
      return res.sendError(refusal, 409);
    }

    const result = await inTransaction(req.db, (conn) =>
      cancelBooking(conn, {
        bookingId: b.bookingId,
        by: "Player",
        reason: "Cancelled by the player",
        refund: true,
        asPlayer: true,
      })
    );
    if (!result.ok) {
      return res.sendError(result.message, null, result.status, result.code);
    }
    const online = await runPaymentFollowUps(req.db, result.followUp, {
      reason: "REQUESTED_BY_CUSTOMER",
    });
    await sendBookingEmail(req.db, b.bookingId, "Cancelled");

    let message = "Booking cancelled";
    if (online.refunded > 0) {
      message = `Booking cancelled — ₱${online.refunded.toLocaleString("en-PH")} is on its way back to you`;
    } else if (online.failed > 0) {
      message =
        "Booking cancelled — the refund didn't go through, so the venue will contact you about it";
    }
    return res.sendSuccess(message, { refunded: online.refunded, refundFailed: online.failed });
  })
);

/**
 * GET /bookings/:manageToken/move-options?date=
 * Phase H: the times the player can move to that day — same length, free, and
 * at the same or a lower price than they booked. Its own time doesn't count as
 * taken (it's marked `current`). Courts are named by a key of this booking.
 */
router.get(
  "/bookings/:manageToken/move-options",
  validateParams(manageTokenParamsSchema),
  validateQuery(moveOptionsQuerySchema),
  catchAsync(async (req, res) => {
    const { manageToken } = req.params;
    const b = await findManagedBooking(req.db, manageToken);
    if (!b) {
      return res.sendError("This booking link isn't valid", 404);
    }
    const refusal = changeRefusal(b, playerChanges(b, getCurrentTimestampLocal()), "move");
    if (refusal) {
      return res.sendError(refusal, 409);
    }
    const { today, lastDate } = bookableDates(b);
    const { date } = req.query;
    if (date < today || date > lastDate) {
      return res.sendError(
        date < today
          ? "That date has passed"
          : `You can book up to ${b.bookingDaysAhead} days ahead`,
        400
      );
    }

    const durationMinutes = moment
      .tz(b.endAt, FORMAT, TIMEZONE)
      .diff(moment.tz(b.startAt, FORMAT, TIMEZONE), "minutes");
    const [courts, hours] = await Promise.all([
      activeCourts(req.db, b.venueId),
      loadVenueHours(req.db, b.venueId),
    ]);
    const day = await dayAvailability(req.db, {
      venueId: b.venueId,
      courts,
      date,
      durationMinutes,
      moving: {
        bookingId: b.bookingId,
        courtId: b.courtId,
        startAt: b.startAt,
        maxPrice: Number(b.price),
      },
    });

    return res.sendSuccess("Move options", {
      date,
      today,
      lastDate,
      openDays: [...hours.keys()].sort((x, y) => x - y),
      durationMinutes,
      maxPrice: Number(b.price),
      hours: day.hours,
      courts: day.courts.map((c) => ({
        key: moveCourtKey(manageToken, c.courtId),
        name: c.name,
        slots: c.slots,
      })),
    });
  })
);

/**
 * POST /bookings/:manageToken/move
 * Body: { courtKey?, date, startTime }. Phase H: once, before the cut-off,
 * same length, to a free time that costs the same or less — the booking keeps
 * its price (no partial refunds). Locks, checks and moves in one transaction.
 */
router.post(
  "/bookings/:manageToken/move",
  changeLimiter,
  validateParams(manageTokenParamsSchema),
  validateBody(playerMoveSchema),
  catchAsync(async (req, res) => {
    const { manageToken } = req.params;
    const b = await findManagedBooking(req.db, manageToken);
    if (!b) {
      return res.sendError("This booking link isn't valid", 404);
    }
    const refusal = changeRefusal(b, playerChanges(b, getCurrentTimestampLocal()), "move");
    if (refusal) {
      return res.sendError(refusal, 409);
    }

    let courtId = b.courtId;
    if (req.body.courtKey) {
      const courts = await activeCourts(req.db, b.venueId);
      const court = courts.find((c) => moveCourtKey(manageToken, c.courtId) === req.body.courtKey);
      if (!court) {
        return res.sendError(
          "That court isn't taking bookings — reload the page and pick again",
          400
        );
      }
      courtId = court.courtId;
    }

    const result = await inTransaction(req.db, (conn) =>
      moveBooking(conn, {
        bookingId: b.bookingId,
        courtId,
        startLocal: toStartLocal(req.body.date, req.body.startTime),
        asPlayer: true,
      })
    );
    if (!result.ok) {
      return res.sendError(result.message, null, result.status, result.code);
    }
    await runPaymentFollowUps(req.db, result.followUp);
    await sendBookingEmail(req.db, b.bookingId, "Moved", {
      previous: await describeSlot(req.db, result.from),
    });
    return res.sendSuccess("Booking moved", { startAt: result.startAt, endAt: result.endAt });
  })
);

// Per IP: a player taps Pay a few times at most
const payLimiter = dynamicLimiter({
  points: parseInt(process.env.RATE_LIMIT_PUBLIC_PAY_POINTS || "10", 10),
  duration: 60,
  keyGenerator: (req) => `public-pay:${req.ip}`,
  message: "Too many tries — wait a minute and try again.",
});

/**
 * POST /bookings/:manageToken/pay
 * Phase F: the booking's Xendit checkout — the open one (same page) or a new
 * one while the hold lasts. 200 { checkoutUrl } or, when it turns out to be
 * paid already, { paid: true, checkoutUrl: null }.
 */
router.post(
  "/bookings/:manageToken/pay",
  payLimiter,
  validateParams(manageTokenParamsSchema),
  catchAsync(async (req, res) => {
    if (!isOnlinePaymentOn()) {
      return res.sendError("Online payment isn't available here — pay at the desk", 409);
    }
    await expireHolds(req.db);
    const rows = await req.db.query(
      `SELECT bookingId, price, status, paymentStatus, checkoutId FROM bookings
       WHERE manageToken = ? AND status != 'Deleted' LIMIT 1`,
      [req.params.manageToken]
    );
    if (rows.length === 0) {
      return res.sendError("This booking link isn't valid", 404);
    }
    const booking = rows[0];
    if (booking.paymentStatus === "Paid" || booking.paymentStatus === "Free") {
      return res.sendError("This booking is already paid", 409);
    }
    if (booking.status !== "Pending") {
      return res.sendError(
        booking.status === "Expired"
          ? "The hold on this slot ran out — book it again"
          : "This booking can't be paid any more",
        409
      );
    }

    const result = await resumeCheckout(req.db, { ...booking, price: Number(booking.price) });
    if (!result.ok) {
      return res.sendError(result.message, result.status);
    }
    if (result.paid) {
      return res.sendSuccess("Payment received — your booking is confirmed", {
        paid: true,
        checkoutUrl: null,
      });
    }
    return res.sendSuccess("Checkout ready", { paid: false, checkoutUrl: result.checkoutUrl });
  })
);

// Per IP: checking in is once a booking; a few taps a minute covers retries
const checkInLimiter = dynamicLimiter({
  points: parseInt(process.env.RATE_LIMIT_PUBLIC_CHECKIN_POINTS || "10", 10),
  duration: 60,
  keyGenerator: (req) => `public-checkin:${req.ip}`,
  message: "Too many tries — wait a minute and try again.",
});

/**
 * POST /bookings/:manageToken/check-in
 * Phase D: start the booking's recorded game from its own page, during the
 * check-in window. 201 { shareUrl, shareToken } (200 when already checked in).
 */
router.post(
  "/bookings/:manageToken/check-in",
  checkInLimiter,
  validateParams(manageTokenParamsSchema),
  catchAsync(async (req, res) => {
    const rows = await req.db.query(
      `SELECT bookingId FROM bookings WHERE manageToken = ? AND status != 'Deleted' LIMIT 1`,
      [req.params.manageToken]
    );
    if (rows.length === 0) {
      return res.sendError("This booking link isn't valid", 404);
    }
    await advanceSessions(req.db);

    let conn;
    let result;
    try {
      conn = await req.db.beginTransaction();
      result = await checkInBooking(conn, {
        bookingId: rows[0].bookingId,
        requireRecorderOnline: true,
      });
      if (result.ok) await req.db.commit(conn);
      else await req.db.rollback(conn);
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }

    if (!result.ok) {
      return res.sendError(result.message, null, result.status, result.code);
    }
    if (!result.alreadyCheckedIn) await sendBookingEmail(req.db, rows[0].bookingId, "GameStarted");
    return res.sendSuccess(
      result.status === "Scheduled"
        ? "Checked in — recording starts at your booked time"
        : "Checked in — the camera is recording",
      { shareToken: result.shareToken, shareUrl: result.shareUrl },
      result.alreadyCheckedIn ? 200 : 201
    );
  })
);

export default router;
