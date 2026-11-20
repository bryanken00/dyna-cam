import { logger } from "../../config/logger.js";
import { getCurrentTimestampLocal, moment } from "../utils/dateUtils.js";
import { sendgridConfigured } from "../lib/mailer/mailer.js";
import { DRIVE_EMAIL_READY, sendGameDriveEmail } from "../utils/gameEmails.js";

/**
 * CR-018: email each game's Google Drive link to its player, once — as soon as
 * the game is ready for it (utils/gameEmails.js: ended, paid or free, its
 * videos in Drive). Runs after every Drive upload pass (jobs/driveUploads.js,
 * every 30 s), so a payment recorded later sends it within half a minute.
 *
 * A claim is a lease (`driveEmailStatus = 'Sending'`, `driveEmailNextAttemptAt`);
 * a send the mailer (SendGrid) refuses is retried with backoff, then Failed.
 */

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";
const LEASE_MINUTES = 5;
export const DRIVE_EMAIL_MAX_ATTEMPTS = 5;
/** Minutes to wait before attempt 2, 3, … */
const BACKOFF_MINUTES = [5, 15, 60, 180];
const BATCH = 10;

const minutesFromNow = (minutes) => moment().tz(TIMEZONE).add(minutes, "minutes").format(FORMAT);

/**
 * One pass.
 * @param {import("../../config/database.js").default} db
 * @returns {Promise<Record<string, number>>} how each send ended
 */
export const runDriveEmails = async (db, { limit = BATCH } = {}) => {
  const tally = {};
  // Without SendGrid an email is only logged: hold them until it's set up
  if (!sendgridConfigured()) return tally;
  const now = getCurrentTimestampLocal();
  const max = Math.max(1, Math.min(100, Number(limit) || BATCH));

  // A send cut off by a restart: its lease ran out
  await db.query(
    `UPDATE recording_sessions SET driveEmailStatus = NULL
     WHERE driveEmailStatus = 'Sending' AND driveEmailNextAttemptAt <= ?`,
    [now]
  );

  const due = await db.query(
    `SELECT s.sessionId, s.driveEmailAttempts
     FROM recording_sessions s
     WHERE s.email IS NOT NULL AND s.driveEmailStatus IS NULL
       AND (s.driveEmailNextAttemptAt IS NULL OR s.driveEmailNextAttemptAt <= ?)
       AND ${DRIVE_EMAIL_READY}
     ORDER BY s.endAt ASC
     LIMIT ${max}`,
    [now]
  );

  for (const row of due) {
    const claimed = await db.query(
      `UPDATE recording_sessions SET driveEmailStatus = 'Sending', driveEmailNextAttemptAt = ?
       WHERE sessionId = ? AND driveEmailStatus IS NULL`,
      [minutesFromNow(LEASE_MINUTES), row.sessionId]
    );
    if (!claimed.affectedRows) continue;

    let result;
    try {
      const sent = await sendGameDriveEmail(db, row.sessionId);
      if (sent.sent) {
        await db.query(
          `UPDATE recording_sessions
           SET driveEmailStatus = 'Sent', driveEmailTo = ?, driveEmailSentAt = ?,
               driveEmailError = NULL, driveEmailNextAttemptAt = NULL
           WHERE sessionId = ? AND driveEmailStatus = 'Sending'`,
          [sent.to, getCurrentTimestampLocal(), row.sessionId]
        );
        result = "sent";
      } else {
        // No longer ready (email cleared, refunded, …) — back to waiting
        await db.query(
          `UPDATE recording_sessions SET driveEmailStatus = NULL, driveEmailNextAttemptAt = NULL
           WHERE sessionId = ? AND driveEmailStatus = 'Sending'`,
          [row.sessionId]
        );
        result = "skipped";
      }
    } catch (err) {
      const attempts = (row.driveEmailAttempts || 0) + 1;
      const giveUp = attempts >= DRIVE_EMAIL_MAX_ATTEMPTS;
      await db.query(
        `UPDATE recording_sessions
         SET driveEmailStatus = ?, driveEmailAttempts = ?, driveEmailError = ?,
             driveEmailNextAttemptAt = ?
         WHERE sessionId = ? AND driveEmailStatus = 'Sending'`,
        [
          giveUp ? "Failed" : null,
          attempts,
          String(err.message || "Sending failed").slice(0, 255),
          giveUp
            ? null
            : minutesFromNow(BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)]),
          row.sessionId,
        ]
      );
      logger.warn("Game Drive email failed", {
        sessionId: row.sessionId,
        attempts,
        error: err.message,
      });
      result = giveUp ? "failed" : "retry";
    }
    tally[result] = (tally[result] || 0) + 1;
  }
  return tally;
};
