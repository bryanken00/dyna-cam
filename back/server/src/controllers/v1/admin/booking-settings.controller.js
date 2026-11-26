import express from "express";
import { catchAsync, validateBody } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal } from "../../../utils/dateUtils.js";
import { checkPermission } from "../../../middlewares/checkPermission.middleware.js";
import { randomToken } from "../../../utils/crypto/tokens.js";
import { bookingPageUrl, courtBoardUrl } from "../../../utils/clips.js";
import { signUploadUrl } from "../../../utils/file/signedUrl.js";
import { toRate } from "../../../utils/bookingPrice.js";
import { hoursList, loadVenueHours } from "../../../utils/courtTimeline.js";
import { updateBookingSettingsSchema } from "../../../validators/booking-settings.validator.js";

/**
 * PLAN-003 Phase A — a venue's court-booking setup: the online booking link,
 * the rules (holds, cut-off, early check-in), the weekly opening
 * hours and the hourly rates. Players book online any open day from today on
 * (CR-048: no weekly confirmation, no days-ahead limit).
 * Permission: bookings.
 */
const router = express.Router();

const RULE_COLUMNS = `v.deskHoldMinutes,
  v.onlineHoldMinutes, v.cancelCutoffHours, v.checkInEarlyMinutes`;

/** "17:00" → "17:00:00" for a TIME column. */
const toTime = (hhmm) => `${hhmm}:00`;

/** The venue (not Deleted) or null. */
const findVenue = async (db, venueId) => {
  const rows = await db.query(
    `SELECT v.venueId, v.name, v.phone, v.logoUrl, v.bookingToken, v.displayToken, ${RULE_COLUMNS}
     FROM venues v
     WHERE v.venueId = ? AND v.status != 'Deleted'
     LIMIT 1`,
    [venueId]
  );
  return rows[0] || null;
};

/**
 * GET /:venueId
 * The whole booking setup, plus the venue's courts (for the rates' court
 * picker — a bookings user may not have the courts permission).
 */
router.get(
  "/:venueId",
  checkPermission("bookings", null, "read"),
  catchAsync(async (req, res) => {
    const venue = await findVenue(req.db, req.params.venueId);
    if (!venue) {
      return res.sendError("Venue not found", 404);
    }

    const [hours, rates, courts] = await Promise.all([
      loadVenueHours(req.db, venue.venueId),
      req.db.query(
        `SELECT r.rateId, r.name, r.courtId, c.name AS courtName, r.daysOfWeek, r.startTime,
                r.endTime, r.pricePerHour
         FROM court_rates r
         LEFT JOIN courts c ON c.courtId = r.courtId
         WHERE r.venueId = ? AND r.status = 'Active'
         ORDER BY r.courtId IS NOT NULL, c.name, r.startTime, r.name`,
        [venue.venueId]
      ),
      req.db.query(
        `SELECT courtId, name, status FROM courts
         WHERE venueId = ? AND status != 'Deleted'
         ORDER BY name ASC`,
        [venue.venueId]
      ),
    ]);

    return res.sendSuccess("Booking settings retrieved successfully", {
      settings: {
        venueId: venue.venueId,
        venueName: venue.name,
        venuePhone: venue.phone,
        venueLogoUrl: signUploadUrl(venue.logoUrl),
        bookingEnabled: Boolean(venue.bookingToken),
        bookingUrl: venue.bookingToken ? bookingPageUrl(venue.bookingToken) : null,
        // CR-038: the TV court board's link (null: off)
        displayUrl: venue.displayToken ? courtBoardUrl(venue.displayToken) : null,
        deskHoldMinutes: venue.deskHoldMinutes,
        onlineHoldMinutes: venue.onlineHoldMinutes,
        cancelCutoffHours: venue.cancelCutoffHours,
        checkInEarlyMinutes: venue.checkInEarlyMinutes,
        hours: hoursList(hours),
        rates: rates.map(toRate),
      },
      courts,
    });
  })
);

/**
 * PUT /:venueId
 * Save the rules, the opening hours (a day left out = closed) and the rates
 * (a rate left out is removed; one without a rateId is new) in one go.
 */
router.put(
  "/:venueId",
  checkPermission("bookings", null, "write"),
  validateBody(updateBookingSettingsSchema),
  catchAsync(async (req, res) => {
    const { venueId } = req.params;
    const { hours, rates, ...rules } = req.body;
    const now = getCurrentTimestampLocal();

    let conn;
    try {
      conn = await req.db.beginTransaction();

      const [venues] = await conn.execute(
        `SELECT venueId FROM venues WHERE venueId = ? AND status != 'Deleted' LIMIT 1 FOR UPDATE`,
        [venueId]
      );
      if (venues.length === 0) {
        await req.db.rollback(conn);
        return res.sendError("Venue not found", 404);
      }

      // A rate's court must be one of this venue's courts
      const [courts] = await conn.execute(
        `SELECT courtId FROM courts WHERE venueId = ? AND status != 'Deleted'`,
        [venueId]
      );
      const courtIds = new Set(courts.map((c) => c.courtId));
      if (rates.some((r) => r.courtId && !courtIds.has(r.courtId))) {
        await req.db.rollback(conn);
        return res.sendError("A rate is for a court that isn't at this venue", 400);
      }

      // An existing rate must be one of this venue's live rates
      const [existingRates] = await conn.execute(
        `SELECT rateId FROM court_rates WHERE venueId = ? AND status = 'Active' FOR UPDATE`,
        [venueId]
      );
      const rateIds = new Set(existingRates.map((r) => r.rateId));
      if (rates.some((r) => r.rateId && !rateIds.has(r.rateId))) {
        await req.db.rollback(conn);
        return res.sendError("A rate was removed by someone else — reload and try again", 409);
      }

      await conn.execute(
        `UPDATE venues
         SET deskHoldMinutes = ?, onlineHoldMinutes = ?, cancelCutoffHours = ?, checkInEarlyMinutes = ?,
             dateUpdated = ?
         WHERE venueId = ?`,
        [
          rules.deskHoldMinutes,
          rules.onlineHoldMinutes,
          rules.cancelCutoffHours,
          rules.checkInEarlyMinutes,
          now,
          venueId,
        ]
      );

      // ── Opening hours: one Active row per open day ──
      const [existingHours] = await conn.execute(
        `SELECT venueHourId, dayOfWeek, opensAt, closesAt FROM venue_hours
         WHERE venueId = ? AND status = 'Active' FOR UPDATE`,
        [venueId]
      );
      const byDay = new Map(existingHours.map((h) => [Number(h.dayOfWeek), h]));
      for (let day = 0; day <= 6; day += 1) {
        const wanted = hours.find((h) => h.dayOfWeek === day);
        const current = byDay.get(day);
        if (wanted && current) {
          await conn.execute(
            `UPDATE venue_hours SET opensAt = ?, closesAt = ?, dateUpdated = ?
             WHERE venueHourId = ?`,
            [toTime(wanted.opensAt), toTime(wanted.closesAt), now, current.venueHourId]
          );
        } else if (wanted) {
          const [uuidRow] = await conn.execute(`SELECT UUID() as id`);
          await conn.execute(
            `INSERT INTO venue_hours
               (venueHourId, venueId, dayOfWeek, opensAt, closesAt, status, dateCreated, dateUpdated)
             VALUES (?, ?, ?, ?, ?, 'Active', ?, ?)`,
            [uuidRow[0].id, venueId, day, toTime(wanted.opensAt), toTime(wanted.closesAt), now, now]
          );
        } else if (current) {
          await conn.execute(
            `UPDATE venue_hours SET status = 'Deleted', dateUpdated = ? WHERE venueHourId = ?`,
            [now, current.venueHourId]
          );
        }
      }

      // ── Rates: keep/edit the listed ones, add new ones, remove the rest ──
      const kept = new Set(rates.filter((r) => r.rateId).map((r) => r.rateId));
      for (const rateId of rateIds) {
        if (!kept.has(rateId)) {
          await conn.execute(
            `UPDATE court_rates SET status = 'Deleted', dateUpdated = ? WHERE rateId = ?`,
            [now, rateId]
          );
        }
      }
      for (const rate of rates) {
        const values = [
          rate.courtId || null,
          rate.name,
          [...rate.daysOfWeek].sort((a, b) => a - b).join(","),
          toTime(rate.startTime),
          toTime(rate.endTime),
          rate.pricePerHour,
        ];
        if (rate.rateId) {
          await conn.execute(
            `UPDATE court_rates
             SET courtId = ?, name = ?, daysOfWeek = ?, startTime = ?, endTime = ?,
                 pricePerHour = ?, dateUpdated = ?
             WHERE rateId = ?`,
            [...values, now, rate.rateId]
          );
        } else {
          const [uuidRow] = await conn.execute(`SELECT UUID() as id`);
          await conn.execute(
            `INSERT INTO court_rates
               (rateId, venueId, courtId, name, daysOfWeek, startTime, endTime, pricePerHour,
                status, dateCreated, dateUpdated)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?)`,
            [uuidRow[0].id, venueId, ...values, now, now]
          );
        }
      }

      await req.db.commit(conn);
      return res.sendSuccess("Booking settings saved");
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
  })
);

/**
 * POST /:venueId/link
 * Turn online booking on with a new link. A link shared before stops working.
 */
router.post(
  "/:venueId/link",
  checkPermission("bookings", null, "write"),
  catchAsync(async (req, res) => {
    const bookingToken = randomToken();
    const result = await req.db.query(
      `UPDATE venues SET bookingToken = ?, dateUpdated = ? WHERE venueId = ? AND status != 'Deleted'`,
      [bookingToken, getCurrentTimestampLocal(), req.params.venueId]
    );
    if (result.affectedRows === 0) {
      return res.sendError("Venue not found", 404);
    }
    return res.sendSuccess("New booking link issued — share it again", {
      bookingUrl: bookingPageUrl(bookingToken),
    });
  })
);

/**
 * DELETE /:venueId/link
 * Turn online booking off. Bookings already made are untouched.
 */
router.delete(
  "/:venueId/link",
  checkPermission("bookings", null, "write"),
  catchAsync(async (req, res) => {
    const result = await req.db.query(
      `UPDATE venues SET bookingToken = NULL, dateUpdated = ?
       WHERE venueId = ? AND status != 'Deleted'`,
      [getCurrentTimestampLocal(), req.params.venueId]
    );
    if (result.affectedRows === 0) {
      return res.sendError("Venue not found", 404);
    }
    return res.sendSuccess("Online booking turned off");
  })
);

/**
 * POST /:venueId/display-link
 * CR-038: turn the TV court board on with a new link. A link opened before
 * (on a TV) stops working.
 */
router.post(
  "/:venueId/display-link",
  checkPermission("bookings", null, "write"),
  catchAsync(async (req, res) => {
    const displayToken = randomToken();
    const result = await req.db.query(
      `UPDATE venues SET displayToken = ?, dateUpdated = ?
       WHERE venueId = ? AND status != 'Deleted'`,
      [displayToken, getCurrentTimestampLocal(), req.params.venueId]
    );
    if (result.affectedRows === 0) {
      return res.sendError("Venue not found", 404);
    }
    return res.sendSuccess("New TV board link issued — open it on the TV again", {
      displayUrl: courtBoardUrl(displayToken),
    });
  })
);

/**
 * DELETE /:venueId/display-link
 * CR-038: turn the TV court board off; a TV showing it says the link isn't valid.
 */
router.delete(
  "/:venueId/display-link",
  checkPermission("bookings", null, "write"),
  catchAsync(async (req, res) => {
    const result = await req.db.query(
      `UPDATE venues SET displayToken = NULL, dateUpdated = ?
       WHERE venueId = ? AND status != 'Deleted'`,
      [getCurrentTimestampLocal(), req.params.venueId]
    );
    if (result.affectedRows === 0) {
      return res.sendError("Venue not found", 404);
    }
    return res.sendSuccess("TV board turned off");
  })
);

export default router;
