import path from "node:path";
import { logger } from "../../config/logger.js";
import { getCurrentTimestampLocal, moment } from "../utils/dateUtils.js";
import { toEpochMs } from "../utils/clips.js";
import { decryptSecret } from "../utils/crypto/secretBox.js";
import { runDriveCleanup } from "./driveCleanup.js";
import { runDriveEmails } from "./driveEmails.js";
import {
  accessToken,
  createFolder,
  DriveAuthError,
  driveConfigured,
  DriveNotFoundError,
  fileViewUrl,
  folderUsable,
  folderViewUrl,
  shareWithLink,
  uploadFile,
} from "../utils/googleDrive.js";

/**
 * Google Drive uploads (CR-001), every 30 s.
 *
 * A clip queued for Drive (`clips.driveStatus = 'Pending'`, set when it
 * becomes Ready on a court with a Google account) is claimed, uploaded into
 * the court's Drive folder — a whole game's parts into the game's own folder —
 * shared "anyone with the link", and its link stored. The server's own copy
 * is untouched: Drive is an extra copy.
 *
 *   - Google refuses the court's sign-in → the court becomes NeedsReconnect and
 *     its clips wait (they go once staff reconnect).
 *   - The server's copy is gone (expired, deleted) → Skipped.
 *   - Anything else → retried with backoff, then Failed after MAX_ATTEMPTS.
 *
 * A claim is a lease (`driveNextAttemptAt`): an upload cut off by a restart is
 * picked up again once the lease runs out.
 *
 * CR-017: each pass is followed by jobs/driveCleanup.js, which moves the Drive
 * copy of a video whose server copy expired to the Drive's trash.
 */

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";
const LEASE_MINUTES = 30;
export const DRIVE_MAX_ATTEMPTS = 6;
/** Minutes to wait before attempt 2, 3, … */
const BACKOFF_MINUTES = [1, 5, 15, 60, 180];
const BATCH = 3;

const minutesFromNow = (minutes) => moment().tz(TIMEZONE).add(minutes, "minutes").format(FORMAT);

/** "2026-11-17 14:05:03" → "2026-11-17 14.05.03" (no colons in Drive names on Windows sync) */
const stamp = (local) => String(local || "").replace(/:/g, ".");
const clock = (local) =>
  String(local || "")
    .slice(11, 16)
    .replace(":", ".");

/** The court's folder name in Drive. */
const courtFolderName = (row) => `Dyna Cam · ${row.venueName} · ${row.courtName}`;

/** A clip's file name in Drive. */
const clipFileName = (row) => {
  if (row.sessionId) {
    const part = String((row.partIndex ?? 0) + 1).padStart(2, "0");
    return `Part ${part} (${clock(row.windowStartAt)}–${clock(row.windowEndAt)}).mp4`;
  }
  return `${stamp(row.requestedAt)} ${row.courtName} replay.mp4`;
};

/** Absolute path of a stored "/public/uploads/…" video, or null if it is not one. */
const videoFile = (stored) => {
  if (typeof stored !== "string" || !stored.startsWith("/public/uploads/")) return null;
  const root = path.resolve("public", "uploads");
  const absolute = path.resolve(stored.replace(/^[/\\]+/, ""));
  return absolute.startsWith(root + path.sep) ? absolute : null;
};

/**
 * The court's folder, made on first use and again if it was deleted. Stored
 * only while the court still has the same sign-in (a change of account in the
 * meantime must not get the old account's folder).
 */
const courtFolder = async (db, token, row) => {
  if (row.driveFolderId && (await folderUsable(token, row.driveFolderId))) {
    return row.driveFolderId;
  }
  const folder = await createFolder(token, { name: courtFolderName(row) });
  await db.query(
    `UPDATE courts SET driveFolderId = ? WHERE courtId = ? AND driveRefreshToken = ?`,
    [folder.id, row.courtId, row.driveRefreshToken]
  );
  row.driveFolderId = folder.id;
  return folder.id;
};

/** A whole game's own shared folder inside the court's folder. */
const sessionFolder = async (db, token, row, parentId) => {
  if (row.sessionFolderId && (await folderUsable(token, row.sessionFolderId))) {
    return row.sessionFolderId;
  }
  const name = `${stamp(row.sessionStartAt).slice(0, 16)} game`;
  const folder = await createFolder(token, { name, parentId });
  await shareWithLink(token, folder.id);
  await db.query(
    `UPDATE recording_sessions SET driveFolderId = ?, driveUrl = ? WHERE sessionId = ?`,
    [folder.id, folderViewUrl(folder.id, folder.webViewLink), row.sessionId]
  );
  row.sessionFolderId = folder.id;
  return folder.id;
};

/** What a Drive upload works on: a clip (a replay), or a whole-game video (CR-003). */
const KINDS = {
  clip: {
    table: "clips",
    key: "clipId",
    select: `
      SELECT cl.clipId AS id, cl.courtId, cl.sessionId, cl.partIndex, cl.status, cl.videoPath,
             cl.requestedAt, cl.windowStartAt, cl.windowEndAt, cl.driveAttempts,
             c.name AS courtName, c.driveRefreshToken, c.driveFolderId,
             c.status AS courtStatus, v.name AS venueName,
             s.startAt AS sessionStartAt, s.driveFolderId AS sessionFolderId
      FROM clips cl
      JOIN courts c ON c.courtId = cl.courtId
      JOIN venues v ON v.venueId = cl.venueId
      LEFT JOIN recording_sessions s ON s.sessionId = cl.sessionId
      WHERE cl.clipId = ? LIMIT 1`,
    due: `
      SELECT cl.clipId AS id
      FROM clips cl
      JOIN courts c ON c.courtId = cl.courtId
      WHERE cl.driveStatus = 'Pending'
        AND (cl.driveNextAttemptAt IS NULL OR cl.driveNextAttemptAt <= ?)
        AND (c.driveStatus = 'Connected' OR c.driveRefreshToken IS NULL OR c.status = 'Deleted')
      ORDER BY cl.dateUpdated ASC`,
    fileName: clipFileName,
  },
  sessionVideo: {
    table: "session_videos",
    key: "sessionVideoId",
    select: `
      SELECT sv.sessionVideoId AS id, s.courtId, sv.sessionId, sv.camera, sv.status,
             sv.videoPath, sv.driveAttempts,
             c.name AS courtName, c.driveRefreshToken, c.driveFolderId,
             c.status AS courtStatus, v.name AS venueName,
             s.startAt AS sessionStartAt, s.driveFolderId AS sessionFolderId,
             sc.startAt AS captureStartAt, sc.endAt AS captureEndAt
      FROM session_videos sv
      JOIN recording_sessions s ON s.sessionId = sv.sessionId
      JOIN courts c ON c.courtId = s.courtId
      JOIN venues v ON v.venueId = sv.venueId
      LEFT JOIN session_captures sc ON sc.captureId = sv.captureId
      WHERE sv.sessionVideoId = ? LIMIT 1`,
    due: `
      SELECT sv.sessionVideoId AS id
      FROM session_videos sv
      JOIN recording_sessions s ON s.sessionId = sv.sessionId
      JOIN courts c ON c.courtId = s.courtId
      WHERE sv.driveStatus = 'Pending'
        AND (sv.driveNextAttemptAt IS NULL OR sv.driveNextAttemptAt <= ?)
        AND (c.driveStatus = 'Connected' OR c.driveRefreshToken IS NULL OR c.status = 'Deleted')
      ORDER BY sv.dateUpdated ASC`,
    // "Cam 1 – whole game.mp4", or "Whole game.mp4" on a one-camera court;
    // CR-013 saves: "Save 8m00s–10m00s – Cam 1.mp4"
    fileName: (row) => {
      if (row.captureStartAt) {
        const at = (stamp) => {
          const total = Math.max(0, Math.round((toEpochMs(stamp) - toEpochMs(row.sessionStartAt)) / 1000));
          return `${Math.floor(total / 60)}m${String(total % 60).padStart(2, "0")}s`;
        };
        const span = `${at(row.captureStartAt)}–${at(row.captureEndAt)}`;
        return row.camera ? `Save ${span} – Cam ${row.camera}.mp4` : `Save ${span}.mp4`;
      }
      return row.camera ? `Cam ${row.camera} – whole game.mp4` : "Whole game.mp4";
    },
  },
};

const finish = (db, kind, id, fields) => {
  const columns = Object.keys(fields);
  return db.query(
    `UPDATE ${kind.table} SET ${columns.map((column) => `${column} = ?`).join(", ")}
     WHERE ${kind.key} = ? AND driveStatus = 'Uploading'`,
    [...columns.map((column) => fields[column]), id]
  );
};

/**
 * Upload one claimed clip or whole-game video.
 * @param {Map<string, string>} tokens - access tokens per court, for this run
 * @returns {Promise<"uploaded"|"skipped"|"waiting"|"retry"|"failed">}
 */
const uploadItem = async (db, kind, id, tokens) => {
  const [row] = await db.query(kind.select, [id]);
  if (!row) return "skipped";

  const skip = async (reason) => {
    await finish(db, kind, id, {
      driveStatus: "Skipped",
      driveError: reason,
      driveNextAttemptAt: null,
    });
    return "skipped";
  };

  if (!row.driveRefreshToken || row.courtStatus === "Deleted") {
    return skip("Google Drive was disconnected");
  }
  const filePath = row.status === "Ready" ? videoFile(row.videoPath) : null;
  if (!filePath) return skip("The video was no longer on the server");

  const refreshToken = decryptSecret(row.driveRefreshToken);
  if (!refreshToken) {
    await db.query(
      `UPDATE courts SET driveStatus = 'NeedsReconnect',
              driveProblem = 'The stored sign-in can no longer be read. Reconnect Google Drive.'
       WHERE courtId = ? AND driveRefreshToken = ?`,
      [row.courtId, row.driveRefreshToken]
    );
    await finish(db, kind, id, { driveStatus: "Pending", driveNextAttemptAt: null });
    return "waiting";
  }

  try {
    let token = tokens.get(row.courtId);
    if (!token) {
      token = await accessToken(refreshToken);
      tokens.set(row.courtId, token);
    }

    const send = async () => {
      let parentId = await courtFolder(db, token, row);
      if (row.sessionId) parentId = await sessionFolder(db, token, row, parentId);
      return uploadFile(token, { filePath, name: kind.fileName(row), parentId });
    };

    let file;
    try {
      file = await send();
    } catch (err) {
      // A folder was deleted between the check and the upload: make it again, once
      if (!(err instanceof DriveNotFoundError)) throw err;
      row.driveFolderId = null;
      row.sessionFolderId = null;
      file = await send();
    }
    await shareWithLink(token, file.id);

    await finish(db, kind, id, {
      driveStatus: "Uploaded",
      driveFileId: file.id,
      driveUrl: fileViewUrl(file.id, file.webViewLink),
      driveUploadedAt: getCurrentTimestampLocal(),
      driveError: null,
      driveNextAttemptAt: null,
    });
    return "uploaded";
  } catch (err) {
    if (err instanceof DriveAuthError) {
      tokens.delete(row.courtId);
      // Only if the court still has the sign-in that failed (not one connected since)
      await db.query(
        `UPDATE courts SET driveStatus = 'NeedsReconnect', driveProblem = ?
         WHERE courtId = ? AND driveRefreshToken = ?`,
        [err.message.slice(0, 255), row.courtId, row.driveRefreshToken]
      );
      await finish(db, kind, id, { driveStatus: "Pending", driveNextAttemptAt: null });
      return "waiting";
    }
    if (err.code === "ENOENT") return skip("The video was no longer on the server");

    const attempts = (row.driveAttempts || 0) + 1;
    const giveUp = err.retryable === false || attempts >= DRIVE_MAX_ATTEMPTS;
    await finish(db, kind, id, {
      driveStatus: giveUp ? "Failed" : "Pending",
      driveAttempts: attempts,
      driveError: String(err.message || "Upload failed").slice(0, 255),
      driveNextAttemptAt: giveUp
        ? null
        : minutesFromNow(BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)]),
    });
    logger.warn("Google Drive upload failed", { [kind.key]: id, attempts, error: err.message });
    return giveUp ? "failed" : "retry";
  }
};

/**
 * One pass: release stale claims, then upload up to `limit` waiting clips and
 * up to `limit` waiting whole-game videos of connected courts.
 * @param {import("../../config/database.js").default} db
 * @returns {Promise<Record<string, number>>} how each upload ended
 */
export const runDriveUploads = async (db, { limit = BATCH } = {}) => {
  const tally = {};
  if (!driveConfigured()) return tally;

  const now = getCurrentTimestampLocal();
  const max = Math.max(1, Math.min(50, Number(limit) || BATCH));
  const tokens = new Map();
  for (const kind of Object.values(KINDS)) {
    // An upload cut off by a restart: its lease ran out
    await db.query(
      `UPDATE ${kind.table} SET driveStatus = 'Pending'
       WHERE driveStatus = 'Uploading' AND driveNextAttemptAt <= ?`,
      [now]
    );
    const due = await db.query(`${kind.due} LIMIT ${max}`, [now]);
    for (const { id } of due) {
      const claimed = await db.query(
        `UPDATE ${kind.table} SET driveStatus = 'Uploading', driveNextAttemptAt = ?
         WHERE ${kind.key} = ? AND driveStatus = 'Pending'`,
        [minutesFromNow(LEASE_MINUTES), id]
      );
      if (!claimed.affectedRows) continue;
      const result = await uploadItem(db, kind, id, tokens);
      tally[result] = (tally[result] || 0) + 1;
    }
  }
  return tally;
};

const INTERVAL_MS = 30 * 1000;

/**
 * Run every `intervalMs`, one pass at a time. Returns a function that stops it.
 * @param {import("../../config/database.js").default} db
 */
export const scheduleDriveUploads = (db, intervalMs = INTERVAL_MS) => {
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    runDriveUploads(db)
      .then((tally) => {
        if (Object.keys(tally).length > 0) logger.info("Google Drive uploads", tally);
      })
      .catch((err) => logger.error("Google Drive uploads failed", { error: err.message }))
      // CR-018: email each finished, paid game's Drive link to its player
      .then(() => runDriveEmails(db))
      .then((tally) => {
        if (tally && Object.keys(tally).length > 0) logger.info("Game Drive emails", tally);
      })
      .catch((err) => logger.error("Game Drive emails failed", { error: err.message }))
      // CR-017: then trash the Drive copies of videos whose server copy expired
      .then(() => runDriveCleanup(db))
      .then((tally) => {
        if (tally && Object.keys(tally).length > 0) logger.info("Google Drive deletes", tally);
      })
      .catch((err) => logger.error("Google Drive deletes failed", { error: err.message }))
      .finally(() => {
        running = false;
      });
  };
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref(); // never keep the process alive just for this
  return () => clearInterval(timer);
};
