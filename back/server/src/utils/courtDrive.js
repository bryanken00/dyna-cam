import { getCurrentTimestampLocal } from "./dateUtils.js";
import { decryptSecret, encryptSecret } from "./crypto/secretBox.js";
import { driveConfigured, revokeToken } from "./googleDrive.js";

/**
 * A court's Google Drive connection (CR-001): connect, change, disconnect, and
 * how it is shown. The upload itself is jobs/driveUploads.js.
 */

/** The court columns `driveSummary` reads (prefix with the courts alias). */
export const COURT_DRIVE_COLUMNS = (alias = "c") =>
  ["driveRefreshToken", "driveEmail", "driveStatus", "driveProblem", "driveConnectedAt"]
    .map((column) => `${alias}.${column}`)
    .join(", ");

/**
 * The court's Drive as the setup page shows it. Never includes the token.
 * @param {Object} row - a courts row with COURT_DRIVE_COLUMNS
 * @param {Object} [queue] - from `driveQueue`, on the single-court page
 */
export const driveSummary = (row, queue = null) => {
  const connected = Boolean(row.driveRefreshToken);
  return {
    // false: the server has no Google OAuth client — nothing to connect to
    configured: driveConfigured(),
    connected,
    email: connected ? row.driveEmail || null : null,
    // Connected | NeedsReconnect (Google refused the stored sign-in)
    status: connected ? row.driveStatus || "Connected" : null,
    problem: connected ? row.driveProblem || null : null,
    connectedAt: connected ? row.driveConnectedAt || null : null,
    ...(queue ? { queue } : {}),
  };
};

/**
 * Upload counts for one court: waiting, given up, and the latest upload.
 * @returns {Promise<{ waiting: number, failed: number, lastUploadedAt: string|null, lastError: string|null }>}
 */
export const driveQueue = async (db, courtId) => {
  const [counts] = await db.query(
    `SELECT
       SUM(driveStatus IN ('Pending','Uploading')) AS waiting,
       SUM(driveStatus = 'Failed') AS failed,
       MAX(driveUploadedAt) AS lastUploadedAt
     FROM clips
     WHERE courtId = ? AND driveStatus IS NOT NULL AND status != 'Deleted'`,
    [courtId]
  );
  // The latest reason an upload is being retried or gave up
  const errors = await db.query(
    `SELECT driveError FROM clips
     WHERE courtId = ? AND driveError IS NOT NULL AND driveStatus IN ('Pending','Failed')
       AND status != 'Deleted'
     ORDER BY dateUpdated DESC LIMIT 1`,
    [courtId]
  );
  return {
    waiting: Number(counts?.waiting || 0),
    failed: Number(counts?.failed || 0),
    lastUploadedAt: counts?.lastUploadedAt || null,
    lastError: errors[0]?.driveError || null,
  };
};

/**
 * Revoke a court's old sign-in at Google — unless another court still uses
 * the same Google account (revoking ends the account's whole grant to Dyna
 * Cam, which would cut that court off too).
 */
const releaseGrant = async (db, storedToken, email) => {
  const token = decryptSecret(storedToken);
  if (!token) return;
  if (email) {
    const others = await db.query(
      `SELECT 1 FROM courts
       WHERE driveEmail = ? AND driveRefreshToken IS NOT NULL AND status != 'Deleted'
       LIMIT 1`,
      [email]
    );
    if (others.length > 0) return;
  }
  await revokeToken(token);
};

/**
 * Connect (or change) a court's Google account.
 * Same account as before: the court's Drive folder is kept. Another account:
 * a new folder is made on the next upload. Clips waiting for Drive go to the
 * account connected now; files already uploaded stay where they are (their
 * links keep working).
 *
 * @returns {Promise<boolean>} false when the court no longer exists
 */
export const connectCourtDrive = async (db, { courtId, accountId, refreshToken, email }) => {
  const now = getCurrentTimestampLocal();
  let conn;
  let previous;
  try {
    conn = await db.beginTransaction();
    const [rows] = await conn.execute(
      `SELECT c.driveRefreshToken, c.driveEmail
       FROM courts c
       JOIN venues v ON v.venueId = c.venueId AND v.status != 'Deleted'
       WHERE c.courtId = ? AND c.status != 'Deleted'
       LIMIT 1 FOR UPDATE`,
      [courtId]
    );
    if (rows.length === 0) {
      await db.rollback(conn);
      return false;
    }
    previous = rows[0];
    const sameAccount =
      Boolean(email) && Boolean(previous.driveEmail) && previous.driveEmail === email;
    await conn.execute(
      `UPDATE courts
       SET driveRefreshToken = ?, driveEmail = ?,
           driveFolderId = IF(?, driveFolderId, NULL),
           driveStatus = 'Connected', driveProblem = NULL,
           driveConnectedAt = ?, driveConnectedBy = ?, dateUpdated = ?
       WHERE courtId = ?`,
      [encryptSecret(refreshToken), email, sameAccount, now, accountId, now, courtId]
    );
    // Clips held while the court needed reconnecting (or still waiting) go now
    await conn.execute(
      `UPDATE clips SET driveNextAttemptAt = NULL
       WHERE courtId = ? AND driveStatus = 'Pending'`,
      [courtId]
    );
    await db.commit(conn);
  } catch (err) {
    await db.rollback(conn);
    throw err;
  }

  // A different account replaced the old one: give the old grant back. The same
  // account: its new token supersedes the old (revoking would end both).
  if (previous.driveRefreshToken && previous.driveEmail !== email) {
    await releaseGrant(db, previous.driveRefreshToken, previous.driveEmail);
  }
  return true;
};

/**
 * Disconnect a court's Google account. Clips still waiting are Skipped (they
 * stay on the server as before); uploaded files stay in that Drive.
 * @returns {Promise<boolean>} false when the court does not exist
 */
export const disconnectCourtDrive = async (db, courtId) => {
  const rows = await db.query(
    `SELECT c.driveRefreshToken, c.driveEmail
     FROM courts c
     JOIN venues v ON v.venueId = c.venueId AND v.status != 'Deleted'
     WHERE c.courtId = ? AND c.status != 'Deleted'
     LIMIT 1`,
    [courtId]
  );
  if (rows.length === 0) return false;

  const now = getCurrentTimestampLocal();
  await db.query(
    `UPDATE courts
     SET driveRefreshToken = NULL, driveEmail = NULL, driveFolderId = NULL, driveStatus = NULL,
         driveProblem = NULL, driveConnectedAt = NULL, driveConnectedBy = NULL, dateUpdated = ?
     WHERE courtId = ? AND status != 'Deleted'`,
    [now, courtId]
  );
  await db.query(
    `UPDATE clips
     SET driveStatus = 'Skipped', driveError = 'Google Drive was disconnected',
         driveNextAttemptAt = NULL
     WHERE courtId = ? AND driveStatus = 'Pending'`,
    [courtId]
  );
  if (rows[0].driveRefreshToken) {
    await releaseGrant(db, rows[0].driveRefreshToken, rows[0].driveEmail);
  }
  return true;
};

/**
 * Queue a clip that just became Ready for its court's Drive, when the court
 * has a Google account (also one that needs reconnecting: it uploads once
 * reconnected).
 */
export const queueClipForDrive = (db, clipId) =>
  db.query(
    `UPDATE clips cl
     JOIN courts c ON c.courtId = cl.courtId
     SET cl.driveStatus = 'Pending', cl.driveAttempts = 0, cl.driveNextAttemptAt = NULL,
         cl.driveError = NULL
     WHERE cl.clipId = ? AND cl.status = 'Ready' AND cl.driveStatus IS NULL
       AND c.driveRefreshToken IS NOT NULL AND c.status != 'Deleted'`,
    [clipId]
  );
