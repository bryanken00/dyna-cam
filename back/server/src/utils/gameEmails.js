import { sendgridConfigured, sendMail } from "../lib/mailer/mailer.js";
import { gameDriveEmail } from "../lib/mailer/templates.js";
import { moment } from "./dateUtils.js";
import { DRIVE_KEEP_DAYS } from "./driveKeep.js";

/**
 * CR-018: "Your game is ready in Google Drive" — the game's Drive folder link,
 * emailed to the player's email (typed on New game) once:
 *
 *   - the game has ended and settled (Ready),
 *   - it is paid or free (CR-015: the Drive link stays hidden until paid),
 *   - every whole-game video's Drive upload has finished, with at least one in
 *     Drive and still kept (CR-026: Drive copies go 2 days after saving).
 *
 * A court without Drive (or an upload that failed) sends nothing. The send
 * itself goes through lib/mailer (SendGrid when SENDGRID_API_KEY is set).
 * jobs/driveEmails.js sends it automatically; Admin can send it again.
 */

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";

/** A whole-game video of `s` (alias `sv`), not a CR-013 save. */
const WHOLE = `sv.sessionId = s.sessionId AND sv.captureId IS NULL`;

/** Every condition for the email but the email address (needs alias `s`). */
export const DRIVE_EMAIL_READY = `s.status = 'Ready' AND s.paymentStatus IN ('Paid', 'Free')
  AND s.driveUrl IS NOT NULL
  AND EXISTS (SELECT 1 FROM session_videos sv
              WHERE ${WHOLE} AND sv.status = 'Ready' AND sv.driveStatus = 'Uploaded')
  AND NOT EXISTS (SELECT 1 FROM session_videos sv
                  WHERE ${WHOLE} AND sv.driveStatus IN ('Pending', 'Uploading'))`;

/** Columns `driveEmailState` reads, for a sessions query with alias `s`. */
export const DRIVE_EMAIL_COLUMNS = `s.email, s.driveEmailStatus, s.driveEmailTo, s.driveEmailSentAt,
  s.driveEmailError,
  (${DRIVE_EMAIL_READY}) AS driveEmailReady,
  EXISTS (SELECT 1 FROM session_videos sv
          WHERE ${WHOLE} AND sv.driveStatus IN ('Pending', 'Uploading')) AS driveEmailUploading`;

/**
 * Where the game's Drive email stands, for Admin:
 *   NoEmail · WaitingForGame · WaitingForPayment · WaitingForDrive · Queued
 *   · NotSetUp (ready, but SENDGRID_API_KEY isn't set — it waits)
 *   · Sending · Sent · Failed · NoDrive (nothing in Drive — nothing will be sent)
 * @returns {{ status: string, to: string|null, sentAt: string|null, error: string|null }}
 */
export const driveEmailState = (row) => {
  const result = (status) => ({
    status,
    to: row.driveEmailTo || null,
    sentAt: row.driveEmailSentAt || null,
    error: row.driveEmailError || null,
  });
  if (row.driveEmailStatus === "Sent") return result("Sent");
  if (!row.email) return result("NoEmail");
  if (row.driveEmailStatus) return result(row.driveEmailStatus);
  if (["Waiting", "Scheduled", "Recording", "Processing"].includes(row.status)) {
    return result("WaitingForGame");
  }
  if (["Cancelled", "Failed"].includes(row.status)) return result("NoDrive");
  if (row.paymentStatus === "Unpaid") return result("WaitingForPayment");
  if (Number(row.driveEmailUploading) === 1) return result("WaitingForDrive");
  if (Number(row.driveEmailReady) === 1) {
    return result(sendgridConfigured() ? "Queued" : "NotSetUp");
  }
  return result("NoDrive");
};

const formatLocal = (value) =>
  value ? moment.tz(value, FORMAT, TIMEZONE).format("MMM D, YYYY, h:mm A") : null;

/**
 * Send the game's Drive email now, if the game is ready for it. Throws when
 * the mailer (SendGrid) refuses. Does not record anything — the caller does.
 * @returns {Promise<{ sent: true, to: string } | { sent: false }>}
 */
export const sendGameDriveEmail = async (db, sessionId) => {
  // keepUntil (CR-026): the Drive copy goes DRIVE_KEEP_DAYS after saving, or with the server's
  const [row] = await db.query(
    `SELECT s.sessionId, s.email, s.driveUrl, s.startAt, s.playerName,
            c.name AS courtName, v.name AS venueName,
            (SELECT MIN(LEAST(sv.expiresAt, DATE_ADD(sv.dateCreated, INTERVAL ${DRIVE_KEEP_DAYS} DAY)))
             FROM session_videos sv
             WHERE ${WHOLE} AND sv.status = 'Ready' AND sv.driveStatus = 'Uploaded') AS keepUntil
     FROM recording_sessions s
     JOIN courts c ON c.courtId = s.courtId
     JOIN venues v ON v.venueId = s.venueId
     WHERE s.sessionId = ? AND s.email IS NOT NULL AND ${DRIVE_EMAIL_READY}
     LIMIT 1`,
    [sessionId]
  );
  if (!row) return { sent: false };

  const mail = gameDriveEmail({
    playerName: row.playerName,
    courtName: row.courtName,
    venueName: row.venueName,
    playedOn: formatLocal(row.startAt),
    driveUrl: row.driveUrl,
    keepUntil: formatLocal(row.keepUntil),
  });
  await sendMail({ to: row.email, subject: mail.subject, html: mail.html, throwOnError: true });
  return { sent: true, to: row.email };
};
