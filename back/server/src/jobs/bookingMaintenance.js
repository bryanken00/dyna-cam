import { logger } from "../../config/logger.js";
import { getCurrentTimestampLocal } from "../utils/dateUtils.js";
import { expireHolds } from "../utils/bookings.js";

/**
 * PLAN-003 Phase E: keep bookings' statuses true without anyone opening a page.
 * Every minute:
 *
 *   1. Pending holds whose time ran out → Expired (the slot is free again).
 *   2. Confirmed bookings whose time is over and that nobody checked in → NoShow.
 *   3. CheckedIn bookings whose game has ended → Completed.
 *
 * Phase G adds the reminder emails here. Every step is one idempotent UPDATE,
 * so two API processes running it at once do no harm.
 */

/**
 * One pass.
 * @param {import("../../config/database.js").default} db
 * @param {{ now?: string }} [options] - "YYYY-MM-DD HH:mm:ss" (Manila); tests pass a fixed one
 * @returns {Promise<{ expired: number, noShows: number, completed: number }>}
 */
export const runBookingMaintenance = async (db, { now = getCurrentTimestampLocal() } = {}) => {
  const expired = await expireHolds(db, { now });

  const noShows = await db.query(
    `UPDATE bookings SET status = 'NoShow', dateUpdated = ?
     WHERE status = 'Confirmed' AND endAt <= ?`,
    [now, now]
  );

  // A booked game ends at the booked end (or earlier, by End game / staff)
  const completed = await db.query(
    `UPDATE bookings b
     JOIN recording_sessions s ON s.sessionId = b.sessionId
     SET b.status = 'Completed', b.dateUpdated = ?
     WHERE b.status = 'CheckedIn'
       AND (s.status IN ('Processing', 'Ready', 'Failed', 'Cancelled') OR s.endAt <= ?)`,
    [now, now]
  );

  return {
    expired,
    noShows: Number(noShows.affectedRows || 0),
    completed: Number(completed.affectedRows || 0),
  };
};

const BOOKING_MAINTENANCE_INTERVAL_MS = 60 * 1000;

/**
 * Run now, then every `intervalMs`. Returns a function that stops it.
 * @param {import("../../config/database.js").default} db
 */
export const scheduleBookingMaintenance = (db, intervalMs = BOOKING_MAINTENANCE_INTERVAL_MS) => {
  const run = () =>
    runBookingMaintenance(db)
      .then(({ expired, noShows, completed }) => {
        if (expired || noShows || completed) {
          logger.info("Booking maintenance", { expired, noShows, completed });
        }
      })
      .catch((err) => logger.error("Booking maintenance failed", { error: err.message }));

  run();
  const timer = setInterval(run, intervalMs);
  timer.unref(); // never keep the process alive just for this
  return () => clearInterval(timer);
};
