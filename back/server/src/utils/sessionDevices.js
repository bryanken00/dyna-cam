import crypto from "node:crypto";
import { moment } from "./dateUtils.js";
import { DEVICE_ONLINE_SECONDS, secondsAgoLocal, sessionShareUrl, toEpochMs } from "./clips.js";
import { decryptSecret } from "./crypto/secretBox.js";

/**
 * Session devices (PLAN-002 Phase E): a phone/tablet paired to ONE recording
 * session. It shows the session live (HLS from the venue's recorder box over
 * the LAN, see edge/src/live.js) with the game's download QR, can stop the
 * recording, and is unpaired SESSION_DEVICE_GRACE_MINUTES after the session
 * ends (so it can still show the QR while the game is saved).
 */

/** How long a device keeps working after its session ends. */
export const SESSION_DEVICE_GRACE_MINUTES = 10;
/** How long a signed live-view link works; the device re-reads /app/session well before. */
export const LIVE_LINK_MINUTES = 15;

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";

const safeJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const RUNNING = ["Scheduled", "Recording"];

/** Columns of a session as the device sees it (needs `s`, `c`, `v` joined). */
export const SESSION_DEVICE_COLUMNS = `s.sessionId, s.venueId, s.courtId, c.name AS courtName,
  v.name AS venueName, s.startAt, s.endAt, s.status, s.failureReason, s.shareToken,
  s.openEnded,
  s.streamUrl, s.streamPlatform, s.streamLayout, s.streamUpdatedAt,
  c.camera2RtspUrl IS NOT NULL AS hasCamera2,
  (SELECT SUM(CASE WHEN sv.status = 'Ready' THEN COALESCE(sv.sizeBytes, sv.uploadBytes, 1)
               ELSE COALESCE(sv.uploadBytes, 0) END)
   FROM session_videos sv
   WHERE sv.sessionId = s.sessionId AND sv.captureId IS NULL
     AND sv.status IN ('Uploading', 'Ready')) AS uploadTotalBytes,
  (SELECT SUM(CASE WHEN sv.status = 'Ready' THEN COALESCE(sv.sizeBytes, sv.uploadBytes, 1)
               ELSE LEAST(sv.receivedBytes, COALESCE(sv.uploadBytes, 0)) END)
   FROM session_videos sv
   WHERE sv.sessionId = s.sessionId AND sv.captureId IS NULL
     AND sv.status IN ('Uploading', 'Ready')) AS uploadSentBytes`;

export const SESSION_DEVICE_FROM = `FROM recording_sessions s
  JOIN courts c ON c.courtId = s.courtId
  JOIN venues v ON v.venueId = s.venueId`;

/**
 * @param {import("../../config/database.js").default} db
 * @returns {Promise<Object|null>} a row with SESSION_DEVICE_COLUMNS
 */
export const loadDeviceSession = async (db, sessionId) => {
  const rows = await db.query(
    `SELECT ${SESSION_DEVICE_COLUMNS} ${SESSION_DEVICE_FROM} WHERE s.sessionId = ? LIMIT 1`,
    [sessionId]
  );
  return rows[0] || null;
};

/** Has the session finished (ended, stopped, cancelled or past its end time)? */
export const sessionEnded = (row, nowMs = Date.now()) =>
  !RUNNING.includes(row.status) || toEpochMs(row.endAt) <= nowMs;

/** Is the session recording right now? */
export const sessionRecording = (row, nowMs = Date.now()) =>
  RUNNING.includes(row.status) && toEpochMs(row.startAt) <= nowMs && toEpochMs(row.endAt) > nowMs;

/** Seconds left before a device of this session is unpaired; null while it runs. */
export const unpairInSeconds = (row, nowMs = Date.now()) => {
  if (row.status === "Cancelled") return 0;
  if (!sessionEnded(row, nowMs)) return null;
  const until = toEpochMs(row.endAt) + SESSION_DEVICE_GRACE_MINUTES * 60_000;
  return Math.max(0, Math.round((until - nowMs) / 1000));
};

/** A device of this session no longer works (cancelled, or the grace is over). */
export const deviceExpired = (row, nowMs = Date.now()) => unpairInSeconds(row, nowMs) === 0;

const seconds = (ms) => Math.max(0, Math.round(ms / 1000));

/** The session as GET /app/session shows it. */
export const toDeviceSession = (row, nowMs = Date.now()) => {
  const startMs = toEpochMs(row.startAt);
  const endMs = toEpochMs(row.endAt);
  const ended = sessionEnded(row, nowMs);
  const recording = sessionRecording(row, nowMs);
  return {
    sessionId: row.sessionId,
    courtId: row.courtId,
    courtName: row.courtName,
    venueName: row.venueName,
    startAt: row.startAt,
    endAt: row.endAt,
    status: row.status,
    startsInSeconds: !ended && startMs > nowMs ? seconds(startMs - nowMs) : 0,
    elapsedSeconds: recording || ended ? seconds(Math.min(nowMs, endMs) - startMs) : 0,
    // CR-005: an open game has no end time — only End game ends it
    openEnded: Number(row.openEnded) === 1,
    endsInSeconds: recording && Number(row.openEnded) !== 1 ? seconds(endMs - nowMs) : 0,
    durationSeconds: seconds(Math.min(nowMs, endMs) - startMs),
    // CR-006: "Saving your game… uploading 45%" — null while the box makes the file
    uploadPercent:
      Number(row.uploadTotalBytes) > 0
        ? Math.min(
            100,
            Math.floor((Number(row.uploadSentBytes) / Number(row.uploadTotalBytes)) * 100)
          )
        : null,
    shareUrl: sessionShareUrl(row.shareToken),
    failureReason: row.failureReason || null,
  };
};

/**
 * The signature the recorder box checks on a live-view link: hex
 * HMAC-SHA256(liveKey, `${courtId}.${exp}`). Must match edge/src/live.js.
 */
export const signLiveLink = (liveKey, courtId, exp) =>
  crypto.createHmac("sha256", liveKey).update(`${courtId}.${exp}`).digest("hex");

/**
 * A signed live-view link for the session's court, from the venue's online
 * recorder box that reported a LAN address; null when the session isn't
 * recording or no box can serve it.
 *
 * CR-007: on a two-camera court `cameras` lists each camera's link (the box
 * serves camera 2 at /live/<court>/cam2/, same signature) for the device's
 * Cam 1 | Cam 2 switch; `hlsUrl` stays camera 1 for apps without the switch.
 *
 * @returns {Promise<{ hlsUrl: string, expiresAt: string,
 *   cameras?: Array<{ camera: 1 | 2, hlsUrl: string }> } | null>}
 */
export const liveLink = async (db, row, nowMs = Date.now()) => {
  if (!sessionRecording(row, nowMs)) return null;
  const boxes = await db.query(
    `SELECT liveUrl, liveKey, lastStatus FROM devices
     WHERE venueId = ? AND status = 'Active' AND lastSeenAt >= ?
       AND liveUrl IS NOT NULL AND liveKey IS NOT NULL
     ORDER BY lastSeenAt DESC`,
    [row.venueId, secondsAgoLocal(DEVICE_ONLINE_SECONDS)]
  );
  // The box that records this court (its last heartbeat listed it); a venue
  // with one box falls back to it before its first camera report
  const records = (box) => {
    const status = typeof box.lastStatus === "string" ? safeJson(box.lastStatus) : box.lastStatus;
    return (status?.cameras || []).some((camera) => camera.courtId === row.courtId);
  };
  const box = boxes.find(records) || (boxes.length === 1 ? boxes[0] : null);
  if (!box) return null;

  // null when it was stored under another server key — the box's next heartbeat fixes it
  const liveKey = decryptSecret(box.liveKey);
  if (!liveKey) return null;

  const exp = Math.floor(nowMs / 1000) + LIVE_LINK_MINUTES * 60;
  const sig = signLiveLink(liveKey, row.courtId, exp);
  const base = `${String(box.liveUrl).replace(/\/+$/, "")}/live/${encodeURIComponent(row.courtId)}`;
  const query = `exp=${exp}&sig=${sig}`;
  const hlsUrl = `${base}/index.m3u8?${query}`;
  return {
    hlsUrl,
    expiresAt: moment(exp * 1000)
      .tz(TIMEZONE)
      .format("YYYY-MM-DD HH:mm:ss"),
    ...(Number(row.hasCamera2)
      ? {
          cameras: [
            { camera: 1, hlsUrl },
            { camera: 2, hlsUrl: `${base}/cam2/index.m3u8?${query}` },
          ],
        }
      : {}),
  };
};
