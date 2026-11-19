import fs from "node:fs";
import path from "node:path";
import { toEpochMs } from "./clips.js";
import { getCurrentTimestampLocal, moment } from "./dateUtils.js";
import { clipUploadFolder, removeClipFiles } from "./file/clipFiles.js";
import { gameVideoCameras } from "./sessions.js";
import { SESSION_VIDEO_COLUMNS } from "./sessionVideos.js";

/**
 * CR-013: "save the last N minutes" of a game from its paired courtside device.
 *
 * A capture is a stretch of the game — from N minutes before Save was tapped
 * to that moment — made exactly like the whole-game video (CR-006): one
 * `session_videos` row per camera, with `captureId` set. The recorder box gets
 * the same `type: "game"` job with the capture's window, copies that footage
 * and uploads it; nothing on the box is new. Free, part of the game.
 *
 * Every whole-game rule (settling the game, counts, retry, the device's upload
 * %) looks only at `captureId IS NULL`.
 */

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";

const envInt = (name, fallback, min) => {
  const value = parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value >= min ? value : fallback;
};

/** Shortest save, and the game time needed before the first one. */
export const CAPTURE_MIN_SECONDS = 60;
/** Longest save a device may ask for (the API also caps it at the time played). */
export const CAPTURE_MAX_SECONDS = 4 * 3600;
/**
 * Saves a game may hold at once (deleting one frees a slot). Saves are never
 * refused for coming quickly: the box makes them one at a time, so a new one
 * just waits its turn ("Queued"). The same length asked again within
 * CAPTURE_REPEAT_SECONDS (a double tap) returns the save already made.
 */
export const captureLimits = () => ({
  maxPerGame: envInt("CAPTURE_MAX_PER_GAME", 5, 1),
});
const CAPTURE_REPEAT_SECONDS = 3;

/** Why a save was refused, in the player's words, with the HTTP status. */
export const CAPTURE_REFUSALS = {
  NOT_RECORDING: { status: 409, message: "The game isn't recording, so there's nothing to save." },
  TOO_EARLY: { status: 409, message: "You can save once the first minute has been played." },
  TOO_MANY: {
    status: 409,
    message: `This game already has its saves — delete one to save another.`,
  },
};

/**
 * Save the last `seconds` of the paired device's game.
 *
 * @param {import("../../config/database.js").default} db
 * @param {{ sessionId: string, pairedAppId: string|null, seconds: number }} input
 * @returns {Promise<{ ok: true, captureId: string, repeated: boolean }
 *   | { ok: false, reason: keyof CAPTURE_REFUSALS }>}
 */
export const createCapture = async (db, { sessionId, pairedAppId, seconds }) => {
  const { maxPerGame } = captureLimits();
  let conn;
  try {
    conn = await db.beginTransaction();
    // Lock the game: concurrent saves are serialised, so the per-game limit
    // and the double-tap check can't be raced
    const [sessions] = await conn.execute(
      `SELECT sessionId, venueId, courtId, startAt, status FROM recording_sessions
       WHERE sessionId = ? FOR UPDATE`,
      [sessionId]
    );
    const session = sessions[0];
    const now = getCurrentTimestampLocal();
    const refuse = async (reason) => {
      await db.rollback(conn);
      conn = null;
      return { ok: false, reason };
    };

    if (!session || session.status !== "Recording" || session.startAt > now) {
      return refuse("NOT_RECORDING");
    }
    const nowM = moment.tz(now, FORMAT, TIMEZONE);
    const played = nowM.diff(moment.tz(session.startAt, FORMAT, TIMEZONE), "seconds");
    if (played < CAPTURE_MIN_SECONDS) return refuse("TOO_EARLY");

    // A double tap: the same length again within a few seconds is the same save
    const [recent] = await conn.execute(
      `SELECT captureId, dateCreated FROM session_captures
       WHERE sessionId = ? AND status = 'Active' AND seconds = ?
       ORDER BY dateCreated DESC, id DESC LIMIT 1`,
      [sessionId, seconds]
    );
    if (
      recent[0] &&
      nowM.diff(moment.tz(recent[0].dateCreated, FORMAT, TIMEZONE), "seconds") <
        CAPTURE_REPEAT_SECONDS
    ) {
      await db.commit(conn);
      conn = null;
      return { ok: true, captureId: recent[0].captureId, repeated: true };
    }

    const [counts] = await conn.execute(
      `SELECT COUNT(*) AS total FROM session_captures WHERE sessionId = ? AND status = 'Active'`,
      [sessionId]
    );
    if (Number(counts[0].total) >= maxPerGame) return refuse("TOO_MANY");

    const length = Math.min(Math.max(seconds, CAPTURE_MIN_SECONDS), played);
    const startAt = nowM.clone().subtract(length, "seconds").format(FORMAT);
    const [[{ id: captureId }]] = await conn.execute(`SELECT UUID() AS id`);
    await conn.execute(
      `INSERT INTO session_captures
         (captureId, sessionId, venueId, startAt, endAt, seconds, pairedAppId, status,
          dateCreated, dateUpdated)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?)`,
      [captureId, sessionId, session.venueId, startAt, now, seconds, pairedAppId, now, now]
    );
    // One video per camera, made by the box like the whole game's
    for (const camera of await gameVideoCameras(db, session.courtId)) {
      const [[{ id }]] = await conn.execute(`SELECT UUID() AS id`);
      await conn.execute(
        `INSERT INTO session_videos
           (sessionVideoId, sessionId, captureId, venueId, camera, status, dateCreated, dateUpdated)
         VALUES (?, ?, ?, ?, ?, 'Pending', ?, ?)`,
        [id, sessionId, captureId, session.venueId, camera, now, now]
      );
    }
    await db.commit(conn);
    conn = null;
    return { ok: true, captureId, repeated: false };
  } catch (err) {
    if (conn) await db.rollback(conn);
    throw err;
  }
};

/** Seconds between two stored Manila timestamps. */
const secondsBetween = (from, to) => Math.round((toEpochMs(to) - toEpochMs(from)) / 1000);

/** A save's videos together: Saving while any is, Ready once any is, else Expired / Failed. */
const captureStatus = (videos) => {
  const statuses = videos.map((video) => video.status);
  if (statuses.some((s) => ["Pending", "Uploading", "Joining"].includes(s))) return "Saving";
  if (statuses.includes("Ready")) return "Ready";
  if (statuses.length > 0 && statuses.every((s) => s === "Expired")) return "Expired";
  return "Failed";
};

/** 0–100 across a save's videos while they upload; null before the box starts sending. */
const capturePercent = (videos) => {
  let total = 0;
  let sent = 0;
  for (const video of videos) {
    if (video.status === "Ready") {
      const size = Number(video.sizeBytes || video.uploadBytes) || 1;
      total += size;
      sent += size;
    } else if (video.status === "Uploading" && Number(video.uploadBytes) > 0) {
      total += Number(video.uploadBytes);
      sent += Math.min(Number(video.receivedBytes) || 0, Number(video.uploadBytes));
    }
  }
  if (total === 0) return null;
  // Every byte in but the box hasn't finished it yet: 99, not a stuck 100
  return Math.min(99, Math.floor((sent / total) * 100));
};

/**
 * A game's saves, oldest first, each with its videos.
 *
 * @param {Function} toVideo  shapes one `session_videos` row (toPublicVideo / toAdminVideo)
 * @param {{ withIds?: boolean }} [opts]  include `captureId` (Admin, the device); never on
 *   the public page
 */
export const loadCaptures = async (db, sessionId, toVideo, { withIds = false } = {}) => {
  const captures = await db.query(
    `SELECT sc.captureId, sc.startAt, sc.endAt, sc.seconds, sc.dateCreated,
            s.startAt AS gameStartAt
     FROM session_captures sc
     JOIN recording_sessions s ON s.sessionId = sc.sessionId
     WHERE sc.sessionId = ? AND sc.status = 'Active'
     ORDER BY sc.dateCreated ASC, sc.id ASC`,
    [sessionId]
  );
  if (captures.length === 0) return [];
  const videos = await db.query(
    `SELECT captureId, ${SESSION_VIDEO_COLUMNS} FROM session_videos
     WHERE sessionId = ? AND captureId IS NOT NULL AND status != 'Deleted'
     ORDER BY camera ASC`,
    [sessionId]
  );
  let earlierSaving = false;
  return captures.map((capture, i) => {
    const own = videos.filter((video) => video.captureId === capture.captureId);
    let status = captureStatus(own);
    // The box makes saves one at a time, oldest first: a save it hasn't
    // started while an earlier one is still being made is waiting its turn
    const started = own.some((video) => video.status !== "Pending");
    if (status === "Saving") {
      if (earlierSaving && !started) status = "Queued";
      earlierSaving = true;
    }
    return {
      ...(withIds ? { captureId: capture.captureId } : {}),
      number: i + 1,
      // Where in the game it is: "8:00 – 10:00"
      fromSeconds: Math.max(0, secondsBetween(capture.gameStartAt, capture.startAt)),
      toSeconds: Math.max(0, secondsBetween(capture.gameStartAt, capture.endAt)),
      seconds: secondsBetween(capture.startAt, capture.endAt),
      savedAt: capture.dateCreated,
      status,
      uploadPercent: status === "Saving" ? capturePercent(own) : status === "Ready" ? 100 : null,
      // A save's only video isn't "Whole game": "Video", or Cam 1 / Cam 2
      videos: own.map((video) => ({
        ...toVideo(video),
        label: video.camera ? `Cam ${video.camera}` : "Video",
      })),
    };
  });
};

/**
 * Delete a save of this game: the save and its videos become Deleted (rows
 * stay, soft), their files go, a Drive copy not made yet is skipped. If the
 * box is still making it, its next upload call gets a 404 and it drops the
 * job (edge contract); it is no longer handed out by /device/jobs.
 *
 * @returns {Promise<boolean>} false when there is no such save on this game
 */
export const deleteCapture = async (db, { sessionId, captureId }) => {
  const now = getCurrentTimestampLocal();
  const videos = await db.query(
    `SELECT sessionVideoId, venueId, videoPath, thumbnailPath FROM session_videos
     WHERE sessionId = ? AND captureId = ? AND status != 'Deleted'`,
    [sessionId, captureId]
  );
  const result = await db.query(
    `UPDATE session_captures SET status = 'Deleted', dateUpdated = ?
     WHERE captureId = ? AND sessionId = ? AND status = 'Active'`,
    [now, captureId, sessionId]
  );
  if (result.affectedRows === 0) return false;
  await db.query(
    `UPDATE session_videos
     SET status = 'Deleted', videoPath = NULL, thumbnailPath = NULL,
         driveStatus = CASE WHEN driveStatus IN ('Pending', 'Failed') THEN 'Skipped' ELSE driveStatus END,
         dateUpdated = ?
     WHERE sessionId = ? AND captureId = ? AND status != 'Deleted'`,
    [now, sessionId, captureId]
  );
  for (const video of videos) {
    await removeClipFiles(video.videoPath, video.thumbnailPath);
    // A half-sent file's chunks
    const folder = path.resolve("public", clipUploadFolder(video.venueId, video.sessionVideoId));
    await fs.promises.rm(folder, { recursive: true, force: true }).catch(() => {});
  }
  return true;
};
