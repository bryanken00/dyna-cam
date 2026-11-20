import { logger } from "../../config/logger.js";
import { getCurrentTimestampLocal, moment } from "../utils/dateUtils.js";
import { decryptSecret } from "../utils/crypto/secretBox.js";
import { driveKeepCutoff } from "../utils/driveKeep.js";
import { accessToken, DriveAuthError, driveConfigured, trashFile } from "../utils/googleDrive.js";

/**
 * CR-017 / CR-026: a video's Google Drive copy goes DRIVE_KEEP_DAYS (2) after
 * the video was saved — or sooner, once its server copy expired.
 *
 * jobs/clipMaintenance.js expires a video after the venue's days (7 by
 * default): status Expired, server files deleted. This pass moves a Drive copy
 * (`driveStatus = 'Uploaded'`) that is past its 2 days, or whose server copy
 * expired, to the Drive's trash — Google empties the trash after 30 days — and
 * marks it `Deleted`. A game's own Drive folder follows once nothing in it is left.
 *
 *   - The court needs reconnecting, or was disconnected → waits; it goes once
 *     the court is connected again.
 *   - Google says the file is gone (or it belongs to another account the
 *     court used before) → counted as deleted.
 *   - Anything else → retried with backoff, then left with its error after
 *     MAX_ATTEMPTS (Admin shows the Drive copy wasn't deleted).
 *
 * Runs after every Drive upload pass (jobs/driveUploads.js, every 30 s).
 * `driveNextAttemptAt` is the claim's lease and the retry time.
 */

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";
const LEASE_MINUTES = 10;
export const DRIVE_DELETE_MAX_ATTEMPTS = 8;
/** Minutes to wait before attempt 2, 3, … */
const BACKOFF_MINUTES = [5, 15, 60, 180, 360, 720, 720];
const FOLDER_RETRY_MINUTES = 60;
const BATCH = 10;

const minutesFromNow = (minutes) => moment().tz(TIMEZONE).add(minutes, "minutes").format(FORMAT);

/** A court that can take Drive calls (connected, not waiting for a reconnect). */
const COURT_CONNECTED = `c.driveStatus = 'Connected' AND c.driveRefreshToken IS NOT NULL
  AND c.status != 'Deleted'`;

/** A video (alias `a`) whose Drive copy is due: past its Drive days (1st ?) or expired. */
const driveDue = (a) => `(${a}.status = 'Expired' OR ${a}.dateCreated <= ?)`;

/** Videos whose Drive copy is due and still there: replays and whole-game videos / saves. */
const KINDS = [
  {
    table: "clips",
    key: "clipId",
    due: `
      SELECT cl.clipId AS id, cl.driveFileId, cl.driveDeleteAttempts AS attempts,
             c.courtId, c.driveRefreshToken
      FROM clips cl JOIN courts c ON c.courtId = cl.courtId
      WHERE ${driveDue("cl")} AND cl.driveStatus = 'Uploaded' AND cl.driveFileId IS NOT NULL
        AND cl.driveDeleteAttempts < ${DRIVE_DELETE_MAX_ATTEMPTS}
        AND (cl.driveNextAttemptAt IS NULL OR cl.driveNextAttemptAt <= ?)
        AND ${COURT_CONNECTED}
      ORDER BY cl.dateCreated ASC`,
  },
  {
    table: "session_videos",
    key: "sessionVideoId",
    due: `
      SELECT sv.sessionVideoId AS id, sv.driveFileId, sv.driveDeleteAttempts AS attempts,
             c.courtId, c.driveRefreshToken
      FROM session_videos sv
      JOIN recording_sessions s ON s.sessionId = sv.sessionId
      JOIN courts c ON c.courtId = s.courtId
      WHERE ${driveDue("sv")} AND sv.driveStatus = 'Uploaded' AND sv.driveFileId IS NOT NULL
        AND sv.driveDeleteAttempts < ${DRIVE_DELETE_MAX_ATTEMPTS}
        AND (sv.driveNextAttemptAt IS NULL OR sv.driveNextAttemptAt <= ?)
        AND ${COURT_CONNECTED}
      ORDER BY sv.dateCreated ASC`,
  },
];

/**
 * A video (alias `a`) that may still be — or still go — in its game's Drive
 * folder: in Drive or on its way there, or not finished yet (it may still be
 * copied). A Ready video whose Drive copy is gone (CR-026: after 2 days, while
 * the server still keeps it) no longer holds the folder.
 */
const stillInFolder = (a) => `(${a}.status NOT IN ('Ready', 'Expired', 'Failed', 'Deleted')
  OR ${a}.driveStatus IN ('Pending', 'Uploading', 'Uploaded'))`;

/** Finished games whose Drive folder has nothing left in it. */
const DUE_FOLDERS = `
  SELECT s.sessionId, s.driveFolderId, c.courtId, c.driveRefreshToken
  FROM recording_sessions s JOIN courts c ON c.courtId = s.courtId
  WHERE s.driveFolderId IS NOT NULL
    AND s.status IN ('Ready', 'Failed', 'Cancelled')
    AND (s.driveFolderNextAttemptAt IS NULL OR s.driveFolderNextAttemptAt <= ?)
    AND ${COURT_CONNECTED}
    AND NOT EXISTS (SELECT 1 FROM session_videos sv
                    WHERE sv.sessionId = s.sessionId AND ${stillInFolder("sv")})
    AND NOT EXISTS (SELECT 1 FROM clips cl
                    WHERE cl.sessionId = s.sessionId AND ${stillInFolder("cl")})
  ORDER BY s.endAt ASC`;

/** The court's sign-in could not be used: hold its Drive work until staff reconnect. */
const needsReconnect = (db, row, problem) =>
  db.query(
    `UPDATE courts SET driveStatus = 'NeedsReconnect', driveProblem = ?
     WHERE courtId = ? AND driveRefreshToken = ?`,
    [String(problem).slice(0, 255), row.courtId, row.driveRefreshToken]
  );

/** An access token for the row's court, once per court per pass. */
const tokenFor = async (db, row, tokens) => {
  const cached = tokens.get(row.courtId);
  if (cached) return cached;
  const refreshToken = decryptSecret(row.driveRefreshToken);
  if (!refreshToken) {
    throw new DriveAuthError("The stored sign-in can no longer be read. Reconnect Google Drive.");
  }
  const token = await accessToken(refreshToken);
  tokens.set(row.courtId, token);
  return token;
};

/**
 * Trash one claimed video's Drive copy.
 * @returns {Promise<"trashed"|"waiting"|"retry"|"failed">}
 */
const trashItem = async (db, kind, row, tokens) => {
  const update = (fields) => {
    const columns = Object.keys(fields);
    return db.query(
      `UPDATE ${kind.table} SET ${columns.map((column) => `${column} = ?`).join(", ")}
       WHERE ${kind.key} = ? AND driveStatus = 'Uploaded'`,
      [...columns.map((column) => fields[column]), row.id]
    );
  };
  try {
    const token = await tokenFor(db, row, tokens);
    await trashFile(token, row.driveFileId); // false = already gone: deleted all the same
    await update({
      driveStatus: "Deleted",
      driveDeletedAt: getCurrentTimestampLocal(),
      driveUrl: null,
      driveError: null,
      driveNextAttemptAt: null,
    });
    return "trashed";
  } catch (err) {
    if (err instanceof DriveAuthError) {
      tokens.delete(row.courtId);
      await needsReconnect(db, row, err.message);
      await update({ driveNextAttemptAt: null });
      return "waiting";
    }
    const attempts = (row.attempts || 0) + 1;
    const giveUp = err.retryable === false || attempts >= DRIVE_DELETE_MAX_ATTEMPTS;
    await update({
      driveDeleteAttempts: giveUp ? DRIVE_DELETE_MAX_ATTEMPTS : attempts,
      driveError: `Not deleted from Drive: ${err.message || "failed"}`.slice(0, 255),
      driveNextAttemptAt: giveUp
        ? null
        : minutesFromNow(BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)]),
    });
    logger.warn("Google Drive delete failed", { [kind.key]: row.id, attempts, error: err.message });
    return giveUp ? "failed" : "retry";
  }
};

/** Trash a finished game's empty Drive folder. @returns {Promise<"folder"|"waiting"|"retry">} */
const trashFolder = async (db, row, tokens) => {
  try {
    const token = await tokenFor(db, row, tokens);
    await trashFile(token, row.driveFolderId);
    await db.query(
      `UPDATE recording_sessions
       SET driveFolderId = NULL, driveUrl = NULL, driveFolderNextAttemptAt = NULL
       WHERE sessionId = ? AND driveFolderId = ?`,
      [row.sessionId, row.driveFolderId]
    );
    return "folder";
  } catch (err) {
    if (err instanceof DriveAuthError) {
      tokens.delete(row.courtId);
      await needsReconnect(db, row, err.message);
      return "waiting";
    }
    await db.query(
      `UPDATE recording_sessions SET driveFolderNextAttemptAt = ? WHERE sessionId = ?`,
      [minutesFromNow(FOLDER_RETRY_MINUTES), row.sessionId]
    );
    logger.warn("Google Drive folder delete failed", {
      sessionId: row.sessionId,
      error: err.message,
    });
    return "retry";
  }
};

/**
 * One pass: trash up to `limit` due Drive copies of each kind,
 * then up to `limit` emptied game folders.
 * @param {import("../../config/database.js").default} db
 * @returns {Promise<Record<string, number>>} how each one ended
 */
export const runDriveCleanup = async (db, { limit = BATCH } = {}) => {
  const tally = {};
  if (!driveConfigured()) return tally;
  const count = (result) => {
    tally[result] = (tally[result] || 0) + 1;
  };

  const now = getCurrentTimestampLocal();
  const cutoff = driveKeepCutoff();
  const max = Math.max(1, Math.min(100, Number(limit) || BATCH));
  const tokens = new Map();
  for (const kind of KINDS) {
    const due = await db.query(`${kind.due} LIMIT ${max}`, [cutoff, now]);
    for (const row of due) {
      const claimed = await db.query(
        `UPDATE ${kind.table} SET driveNextAttemptAt = ?
         WHERE ${kind.key} = ? AND (status = 'Expired' OR dateCreated <= ?)
           AND driveStatus = 'Uploaded'
           AND (driveNextAttemptAt IS NULL OR driveNextAttemptAt <= ?)`,
        [minutesFromNow(LEASE_MINUTES), row.id, cutoff, now]
      );
      if (!claimed.affectedRows) continue;
      count(await trashItem(db, kind, row, tokens));
    }
  }

  const folders = await db.query(`${DUE_FOLDERS} LIMIT ${max}`, [now]);
  for (const row of folders) count(await trashFolder(db, row, tokens));
  return tally;
};
