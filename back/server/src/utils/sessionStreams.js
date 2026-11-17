import { getCurrentTimestampLocal, moment } from "./dateUtils.js";
import { streamSetupUrl, toEpochMs } from "./clips.js";
import { decryptSecret, encryptSecret, maskRtmpUrl } from "./crypto/secretBox.js";
import { hashToken, randomToken } from "./crypto/tokens.js";

/**
 * A player's own live stream of their session (PLAN-002 Phase G).
 *
 * The session device shows a QR of a short-lived setup code; the player opens
 * it on their own phone and pastes their Facebook / YouTube stream key. The
 * full RTMP(S) address is stored encrypted on the session, sent to the
 * venue's recorder box only while the session records (it restreams its own
 * live view — edge/src/restream.js), and cleared when the session ends. The
 * key is never returned: only a masked address.
 */

/** How long a fresh setup code works if nothing is saved with it. */
export const STREAM_SETUP_MINUTES = 15;

/** Where each platform's stream key goes. OTHER = the player gives the full address. */
export const STREAM_SERVERS = {
  FACEBOOK: "rtmps://live-api-s.facebook.com:443/rtmp/",
  YOUTUBE: "rtmp://a.rtmp.youtube.com/live2/",
};

const RUNNING = ["Scheduled", "Recording"];
const FORMAT = "YYYY-MM-DD HH:mm:ss";
const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";

/** The full address to stream to, from the validated body. */
export const buildStreamUrl = ({ platform, streamKey, url }) =>
  platform === "OTHER" ? url : `${STREAM_SERVERS[platform]}${streamKey}`;

const parseJson = (value) => {
  if (!value || typeof value !== "string") return value || null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

/**
 * The recorder box's latest report about this session's stream, from the
 * venue's boxes' heartbeats (devices.lastStatus.sessionStreams).
 */
const streamReport = async (db, row) => {
  const boxes = await db.query(
    `SELECT lastStatus FROM devices
     WHERE venueId = ? AND status = 'Active' AND lastStatus IS NOT NULL
     ORDER BY lastSeenAt DESC`,
    [row.venueId]
  );
  for (const box of boxes) {
    const report = (parseJson(box.lastStatus)?.sessionStreams || []).find(
      (entry) => entry.sessionId === row.sessionId
    );
    if (report) return report;
  }
  return null;
};

/**
 * The stream as the device, the player's page and the Admin portal show it,
 * or null when the session has none. `row` needs sessionId, venueId, status,
 * startAt, endAt, streamUrl (encrypted), streamPlatform, streamUpdatedAt.
 */
export const describeStream = async (db, row, nowMs = Date.now()) => {
  if (!row?.streamUrl) return null;
  const url = decryptSecret(row.streamUrl);
  const recording =
    RUNNING.includes(row.status) &&
    toEpochMs(row.startAt) <= nowMs &&
    toEpochMs(row.endAt) > nowMs;

  let status = "waiting";
  let message = null;
  if (recording) {
    const report = await streamReport(db, row);
    status = report?.status || "starting";
    message = report?.message || null;
  }
  return {
    platform: row.streamPlatform,
    // Phase H: what the stream shows on a 2-camera court; null on a 1-camera court
    layout: Number(row.hasCamera2) ? row.streamLayout || "STACKED" : null,
    status,
    message,
    maskedUrl: maskRtmpUrl(url),
    updatedAt: row.streamUpdatedAt,
  };
};

/**
 * A fresh setup code for a session; the previous one stops working.
 * @returns {Promise<{ url: string, expiresAt: string, expiresInSeconds: number }>}
 */
export const createStreamSetup = async (db, sessionId) => {
  const code = randomToken(16);
  const expiresAt = moment().tz(TIMEZONE).add(STREAM_SETUP_MINUTES, "minutes").format(FORMAT);
  await db.query(
    `UPDATE recording_sessions SET streamSetupTokenHash = ?, streamSetupExpiresAt = ?
     WHERE sessionId = ?`,
    [hashToken(code), expiresAt, sessionId]
  );
  return {
    url: streamSetupUrl(code),
    expiresAt,
    expiresInSeconds: STREAM_SETUP_MINUTES * 60,
  };
};

/** Columns the stream helpers need, plus what the player's page shows. */
export const STREAM_SESSION_COLUMNS = `s.sessionId, s.venueId, s.courtId, c.name AS courtName,
  v.name AS venueName, s.startAt, s.endAt, s.status, s.streamUrl, s.streamPlatform,
  s.streamLayout, s.streamUpdatedAt, s.streamSetupExpiresAt,
  c.camera2RtspUrl IS NOT NULL AS hasCamera2`;

/**
 * The session a setup code belongs to, while the code works and the session
 * is still to come or recording; null otherwise.
 */
export const findSessionBySetupCode = async (db, code) => {
  const now = getCurrentTimestampLocal();
  const rows = await db.query(
    `SELECT ${STREAM_SESSION_COLUMNS}
     FROM recording_sessions s
     JOIN courts c ON c.courtId = s.courtId
     JOIN venues v ON v.venueId = s.venueId AND v.status != 'Deleted'
     WHERE s.streamSetupTokenHash = ? AND s.streamSetupExpiresAt > ?
       AND s.status IN ('Scheduled', 'Recording') AND s.endAt > ?
     LIMIT 1`,
    [hashToken(String(code)), now, now]
  );
  return rows[0] || null;
};

/**
 * The layout a player's stream uses on this court: one camera → CAM1; two →
 * what they chose (default both stacked).
 */
export const streamLayoutFor = (row, chosen) => (row.hasCamera2 ? chosen || "STACKED" : "CAM1");

/**
 * Save the player's stream. The setup code then keeps working until the
 * session ends, so their page can show the status and Stop.
 */
export const saveStream = async (db, row, { platform, url, layout }) => {
  const now = getCurrentTimestampLocal();
  await db.query(
    `UPDATE recording_sessions
     SET streamUrl = ?, streamPlatform = ?, streamLayout = ?, streamUpdatedAt = ?,
         streamSetupExpiresAt = ?
     WHERE sessionId = ?`,
    [encryptSecret(url), platform, streamLayoutFor(row, layout), now, row.endAt, row.sessionId]
  );
};

/** Change only what the saved stream shows (Phase H); the key stays as it is. */
export const saveStreamLayout = async (db, row, layout) => {
  await db.query(
    `UPDATE recording_sessions SET streamLayout = ?, streamUpdatedAt = ? WHERE sessionId = ?`,
    [streamLayoutFor(row, layout), getCurrentTimestampLocal(), row.sessionId]
  );
};

/** Stop the player's stream (the setup code keeps working until it expires). */
export const clearStream = async (db, sessionId) => {
  await db.query(
    `UPDATE recording_sessions
     SET streamUrl = NULL, streamPlatform = NULL, streamLayout = NULL, streamUpdatedAt = ?
     WHERE sessionId = ?`,
    [getCurrentTimestampLocal(), sessionId]
  );
};

/** SQL that forgets a session's stream and setup code (session ended / cancelled). */
export const FORGET_STREAM_SQL = `streamUrl = NULL, streamLayout = NULL,
  streamSetupTokenHash = NULL, streamSetupExpiresAt = NULL`;
