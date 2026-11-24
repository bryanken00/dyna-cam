import express from "express";
import { catchAsync, validateParams } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal, getTodayDateLocal, moment } from "../../../utils/dateUtils.js";
import { hashToken } from "../../../utils/crypto/tokens.js";
import { minutesToTime } from "../../../utils/bookingPrice.js";
import { loadVenueHours } from "../../../utils/courtTimeline.js";
import { expireHolds } from "../../../utils/bookings.js";
import { advanceSessions } from "../../../utils/sessions.js";
import { signUploadUrl } from "../../../utils/file/signedUrl.js";
import { displayTokenParamsSchema } from "../../../validators/public.validator.js";

/**
 * CR-038 — a venue's TV court board, mounted at /api/v1/public/board with NO
 * login: the venue's display link (venues.displayToken, issued from the venue
 * page) is the credential. It answers only what a TV in the venue shows —
 * today's courts and when each is booked, in play or closed. Never a name, a
 * booking code, a closure's reason or a business ID: courts are named by a key
 * derived from the link, and a booking's status is reduced to Booked / In play
 * / Played.
 *
 *   GET /:displayToken      today at the venue (the TV polls it every minute)
 */
const router = express.Router();

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";

const courtKey = (displayToken, courtId) => hashToken(`board:${displayToken}:${courtId}`).slice(0, 16);

/** A booking as the board says it: Booked (held, paid, no-show), In play, Played. */
const boardStatus = (status) =>
  status === "CheckedIn" ? "CheckedIn" : status === "Completed" ? "Completed" : "Confirmed";

router.get(
  "/:displayToken",
  validateParams(displayTokenParamsSchema),
  catchAsync(async (req, res) => {
    const { displayToken } = req.params;
    const venues = await req.db.query(
      `SELECT venueId, name, logoUrl FROM venues
       WHERE displayToken = ? AND status = 'Active' LIMIT 1`,
      [displayToken]
    );
    if (venues.length === 0) {
      return res.sendError("This court board link isn't valid", 404);
    }
    const venue = venues[0];
    await Promise.all([
      expireHolds(req.db, { venueId: venue.venueId }),
      advanceSessions(req.db, { venueId: venue.venueId }),
    ]);

    const date = getTodayDateLocal();
    const dayStart = `${date} 00:00:00`;
    const dayEnd = moment.tz(date, "YYYY-MM-DD", TIMEZONE).add(1, "day").format(FORMAT);
    const window = [dayEnd, dayStart];

    const [hours, courts, bookings, games, closures] = await Promise.all([
      loadVenueHours(req.db, venue.venueId),
      req.db.query(
        `SELECT courtId, name FROM courts
         WHERE venueId = ? AND status = 'Active'
         ORDER BY name ASC`,
        [venue.venueId]
      ),
      req.db.query(
        `SELECT courtId, status, startAt, endAt FROM bookings
         WHERE venueId = ? AND status NOT IN ('Cancelled', 'Expired', 'Deleted')
           AND startAt < ? AND endAt > ?
         ORDER BY startAt ASC`,
        [venue.venueId, ...window]
      ),
      // A booking's own game is drawn as the booking
      req.db.query(
        `SELECT courtId, status, startAt, endAt, openEnded FROM recording_sessions
         WHERE venueId = ? AND bookingId IS NULL AND status NOT IN ('Cancelled', 'Failed')
           AND startAt < ? AND endAt > ?
         ORDER BY startAt ASC`,
        [venue.venueId, ...window]
      ),
      req.db.query(
        `SELECT courtId, startAt, endAt FROM court_closures
         WHERE venueId = ? AND status = 'Active' AND startAt < ? AND endAt > ?
         ORDER BY startAt ASC`,
        [venue.venueId, ...window]
      ),
    ]);

    const key = (courtId) => courtKey(displayToken, courtId);
    const open = hours.get(moment.tz(date, "YYYY-MM-DD", TIMEZONE).day());
    return res.sendSuccess("Court board", {
      venue: { name: venue.name, logoUrl: signUploadUrl(venue.logoUrl) },
      date,
      now: getCurrentTimestampLocal(),
      hours: open ? { opensAt: minutesToTime(open.opensAt), closesAt: minutesToTime(open.closesAt) } : null,
      courts: courts.map((c) => ({ key: key(c.courtId), name: c.name })),
      bookings: bookings.map((b) => ({
        courtKey: key(b.courtId),
        status: boardStatus(b.status),
        startAt: b.startAt,
        endAt: b.endAt,
      })),
      games: games.map((g) => ({
        courtKey: key(g.courtId),
        status: g.status,
        startAt: g.startAt,
        endAt: g.endAt,
        openEnded: Number(g.openEnded) === 1,
      })),
      // A venue-wide closure has no court
      closures: closures.map((c) => ({
        courtKey: c.courtId ? key(c.courtId) : null,
        startAt: c.startAt,
        endAt: c.endAt,
      })),
    });
  })
);

export default router;
