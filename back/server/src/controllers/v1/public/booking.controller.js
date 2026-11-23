import express from "express";
import { catchAsync, validateBody, validateParams, validateQuery } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal, getTodayDateLocal, moment } from "../../../utils/dateUtils.js";
import { dynamicLimiter } from "../../../middlewares/rateLimiter.js";
import { hashToken } from "../../../utils/crypto/tokens.js";
import { bookingManageUrl } from "../../../utils/clips.js";
import { signUploadUrl } from "../../../utils/file/signedUrl.js";
import { loadVenueHours } from "../../../utils/courtTimeline.js";
import { dayAvailability } from "../../../utils/bookingAvailability.js";
import { createBooking, expireHolds, toStartLocal } from "../../../utils/bookings.js";
import {
  availabilityQuerySchema,
  bookingTokenParamsSchema,
  manageTokenParamsSchema,
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
 *   POST /book/:bookingToken/bookings            book a slot (pay at the desk; online in Phase F)
 *   GET  /bookings/:manageToken                  one booking: status, code, what can be done now
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

/** The venue an online booking link belongs to (Active, online booking on), or null. */
const findVenue = async (db, bookingToken) => {
  const rows = await db.query(
    `SELECT venueId, name, address, phone, logoUrl, maxBookingMinutes, bookingDaysAhead,
            deskHoldMinutes, cancelCutoffHours, checkInEarlyMinutes
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
      courts: courts.map((c) => ({ key: courtKey(req.params.bookingToken, c.courtId), name: c.name })),
      openDays: [...hours.keys()].sort((a, b) => a - b),
      today,
      lastDate,
      rules: {
        maxBookingMinutes: venue.maxBookingMinutes,
        deskHoldMinutes: venue.deskHoldMinutes,
        cancelCutoffHours: venue.cancelCutoffHours,
        checkInEarlyMinutes: venue.checkInEarlyMinutes,
      },
      // Phase F: Xendit
      payOnline: false,
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
    const { date, startTime, durationMinutes, playerName, phone, email } = req.body;
    const problem = dateProblem(venue, date, durationMinutes);
    if (problem) {
      return res.sendError(problem, 400);
    }

    const courts = await activeCourts(req.db, venue.venueId);
    const court = courts.find((c) => courtKey(bookingToken, c.courtId) === req.body.courtKey);
    if (!court) {
      return res.sendError("That court isn't taking bookings — reload the page and pick again", 400);
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
        payment: "Hold",
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
    return res.sendSuccess(
      result.status === "Pending"
        ? "Booked — pay at the desk to confirm it"
        : "Booked — you're all set",
      {
        bookingCode: result.bookingCode,
        manageToken: result.manageToken,
        manageUrl: bookingManageUrl(result.manageToken),
      },
      201
    );
  })
);

/**
 * GET /bookings/:manageToken
 * The player's booking: where and when, its price and payment, its status, and
 * what they can do now (pay online, cancel, move, check in — later phases).
 */
router.get(
  "/bookings/:manageToken",
  validateParams(manageTokenParamsSchema),
  catchAsync(async (req, res) => {
    await expireHolds(req.db);
    const rows = await req.db.query(
      `SELECT b.bookingCode, b.startAt, b.endAt, b.playerName, b.email, b.price, b.paymentStatus,
              b.payMethod, b.holdExpiresAt, b.status, b.cancelledAt, b.cancelledBy,
              c.name AS courtName, v.name, v.address, v.phone, v.logoUrl, v.cancelCutoffHours,
              v.checkInEarlyMinutes
       FROM bookings b
       JOIN courts c ON c.courtId = b.courtId
       JOIN venues v ON v.venueId = b.venueId AND v.status != 'Deleted'
       WHERE b.manageToken = ? AND b.status != 'Deleted'
       LIMIT 1`,
      [req.params.manageToken]
    );
    if (rows.length === 0) {
      return res.sendError("This booking link isn't valid", 404);
    }
    const b = rows[0];
    const start = moment.tz(b.startAt, FORMAT, TIMEZONE);
    const now = getCurrentTimestampLocal();

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
        // Pay at the desk by then, or the slot is released
        payBy: b.status === "Pending" ? b.holdExpiresAt : null,
        cancelledAt: b.cancelledAt,
        cancelledBy: b.cancelledBy,
        cancelCutoffAt: start.clone().subtract(b.cancelCutoffHours, "hours").format(FORMAT),
        checkInFrom: start.clone().subtract(b.checkInEarlyMinutes, "minutes").format(FORMAT),
        hasEnded: b.endAt <= now,
        // Filled in by later phases: D check in, F pay online, H cancel / move
        actions: { checkIn: false, payOnline: false, cancel: false, move: false },
      },
    });
  })
);

export default router;
