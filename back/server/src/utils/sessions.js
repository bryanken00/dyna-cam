import { getCurrentTimestampLocal, moment } from "./dateUtils.js";
import { FORGET_STREAM_SQL } from "./sessionStreams.js";

/**
 * Whole-game recording.
 *
 * A game (a recording session) records a court over [startAt, endAt): booked
 * with times (PLAN-001/002), or an open game started by pairing its session
 * device and ended by End game (CR-005).
 *
 * CR-006: a game travels as ONE file per camera. While it records, the venue's
 * recorder box only keeps its footage. When it ends, a session_videos row is
 * made per camera (one-camera court: camera 0; two cameras: 1 and 2) and the
 * box gets a game job for each: it copies the game into one mp4 and uploads it
 * in chunks (controllers/v1/device/game-videos.controller.js). There are no
 * 5-minute pieces and no joining on the server.
 *
 * There is no scheduler: sessions move Scheduled → Recording → Processing
 * whenever a box polls /device/jobs or /device/config, a page is opened, or
 * the hourly maintenance runs.
 */

export const SESSION_MIN_MINUTES = 5;
export const SESSION_MAX_MINUTES = 3 * 60;
export const SESSION_MAX_DAYS_AHEAD = 14;
/**
 * An ended session keeps at least this much footage. Short, so End frees the
 * court at once and a new game can start right after it.
 */
export const SESSION_MIN_END_SECONDS = 1;

/**
 * CR-005: an open game (created without times, ended only by End game / End)
 * keeps its endAt this far ahead of now. It's rolled forward on every pass
 * (box polls, pages, the hourly maintenance), long before it's reached.
 */
export const OPEN_GAME_AHEAD_HOURS = 6;
const OPEN_GAME_ROLL_BELOW_HOURS = 5;

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";

const parseLocal = (value) => moment.tz(value, FORMAT, TIMEZONE);
const formatLocal = (m) => m.clone().tz(TIMEZONE).format(FORMAT);

/** The rolling end for an open game, from now. */
export const openGameEnd = () =>
  moment().tz(TIMEZONE).add(OPEN_GAME_AHEAD_HOURS, "hours").format(FORMAT);

/** Keep every open game's end ahead of now, so the clock never ends it. */
export const rollOpenGames = async (db) => {
  const soon = moment().tz(TIMEZONE).add(OPEN_GAME_ROLL_BELOW_HOURS, "hours").format(FORMAT);
  // A live window, not an edit: dateUpdated is left alone
  await db.query(
    `UPDATE recording_sessions SET endAt = ?
     WHERE openEnded = 1 AND status IN ('Waiting', 'Recording') AND endAt < ?`,
    [openGameEnd(), soon]
  );
};

/**
 * CR-006: the game's whole video per camera, made when it ends — camera 0 on a
 * one-camera court, cameras 1 and 2 on a two-camera court. Idempotent
 * (UNIQUE (sessionId, camera)).
 */
export const createGameVideos = async (db, session) => {
  const [court] = await db.query(
    `SELECT camera2RtspUrl IS NOT NULL AS hasCamera2 FROM courts WHERE courtId = ? LIMIT 1`,
    [session.courtId]
  );
  const cameras = court && Number(court.hasCamera2) ? [1, 2] : [0];
  const now = getCurrentTimestampLocal();
  for (const camera of cameras) {
    const [{ id }] = await db.query(`SELECT UUID() AS id`);
    await db.query(
      `INSERT IGNORE INTO session_videos
         (sessionVideoId, sessionId, venueId, camera, status, dateCreated, dateUpdated)
       VALUES (?, ?, ?, ?, 'Pending', ?, ?)`,
      [id, session.sessionId, session.venueId, camera, now, now]
    );
  }
  await db.query(
    `UPDATE recording_sessions SET wholeVideo = 'Pending'
     WHERE sessionId = ? AND wholeVideo IS NULL`,
    [session.sessionId]
  );
};

/**
 * Move sessions along as time passes: Scheduled → Recording at the start,
 * Recording → Processing at the end — and a game that just ended gets its
 * whole-video rows (the box's game jobs). Open games never end by the clock.
 *
 * @param {import("../../config/database.js").default} db
 * @param {Object} [scope]
 * @param {string} [scope.venueId] - only this venue's sessions (a box polling)
 */
export const advanceSessions = async (db, { venueId } = {}) => {
  await rollOpenGames(db);
  const now = getCurrentTimestampLocal();
  const params = [now];
  let where = "s.status IN ('Scheduled', 'Recording') AND s.startAt <= ?";
  if (venueId) {
    where += " AND s.venueId = ?";
    params.push(venueId);
  }
  const sessions = await db.query(
    `SELECT s.sessionId, s.venueId, s.courtId, s.endAt, s.status
     FROM recording_sessions s
     WHERE ${where}`,
    params
  );
  for (const session of sessions) {
    const nextStatus = session.endAt <= now ? "Processing" : "Recording";
    if (nextStatus === session.status) continue;
    // A finished game forgets the player's stream key (PLAN-002 Phase G)
    const forget = nextStatus === "Processing" ? `, ${FORGET_STREAM_SQL}` : "";
    const result = await db.query(
      `UPDATE recording_sessions SET status = ?, dateUpdated = ?${forget}
       WHERE sessionId = ? AND status IN ('Scheduled', 'Recording')`,
      [nextStatus, now, session.sessionId]
    );
    if (nextStatus === "Processing" && result.affectedRows > 0) {
      await createGameVideos(db, session);
    }
  }
};

/** @deprecated name from the 5-minute-piece days; same as advanceSessions */
export const materializeSessionParts = advanceSessions;

const clockOf = (local) => parseLocal(local).format("h:mm");
const meridiemOf = (local) => parseLocal(local).format("A");

const stretchText = (gap) => {
  const sameHalf = meridiemOf(gap.startAt) === meridiemOf(gap.endAt);
  const start = sameHalf
    ? clockOf(gap.startAt)
    : `${clockOf(gap.startAt)} ${meridiemOf(gap.startAt)}`;
  return `${start} – ${clockOf(gap.endAt)} ${meridiemOf(gap.endAt)}`;
};

/**
 * CR-004: the note for footage a game is missing, in minutes and times —
 * "8 minutes weren't recorded (11:23 – 11:31 AM)", per camera on a two-camera
 * game ("Cam 2: …"). Null when nothing is missing.
 *
 * @param {Array<{ camera: number, gaps: Array<{ startAt: string, endAt: string }> }>} cameras
 *   each camera's missing stretches (Manila wall-clock strings)
 */
export const missingFootageNote = (cameras) => {
  const notes = [...cameras]
    .filter((entry) => entry.gaps?.length > 0)
    .sort((a, b) => a.camera - b.camera)
    .map(({ camera, gaps }) => {
      const sorted = [...gaps].sort((a, b) => (a.startAt < b.startAt ? -1 : 1));
      const seconds = sorted.reduce(
        (sum, gap) => sum + parseLocal(gap.endAt).diff(parseLocal(gap.startAt), "seconds"),
        0
      );
      const minutes = Math.max(1, Math.round(seconds / 60));
      const what =
        minutes === 1 ? "1 minute wasn't recorded" : `${minutes} minutes weren't recorded`;
      return `${camera ? `Cam ${camera}: ` : ""}${what} (${sorted.map(stretchText).join(", ")})`;
    });
  return notes.length > 0 ? notes.join("; ") : null;
};

const parseGaps = (gaps) => {
  if (!gaps) return [];
  try {
    return typeof gaps === "string" ? JSON.parse(gaps) : gaps;
  } catch {
    return [];
  }
};

/**
 * Settle a Processing game once each of its videos is uploaded or given up:
 * Ready if at least one video is in, Failed if none is. The note names the
 * minutes that weren't recorded.
 *
 * @param {import("../../config/database.js").default} db
 * @param {string} [sessionId] - one session, or every Processing session
 */
export const settleSessions = async (db, sessionId) => {
  const params = [];
  let where = "s.status = 'Processing'";
  if (sessionId) {
    where += " AND s.sessionId = ?";
    params.push(sessionId);
  }
  const sessions = await db.query(
    `SELECT s.sessionId, s.venueId, s.courtId, s.startAt, s.endAt, s.wholeVideo
     FROM recording_sessions s WHERE ${where}`,
    params
  );

  const now = getCurrentTimestampLocal();
  for (const session of sessions) {
    let videos = await db.query(
      `SELECT camera, status, gaps FROM session_videos
       WHERE sessionId = ? AND status != 'Deleted'`,
      [session.sessionId]
    );
    if (videos.length === 0) {
      // Ended before this change, or its rows were never made: make them now
      await createGameVideos(db, session);
      continue;
    }
    if (videos.some((v) => ["Pending", "Uploading", "Joining"].includes(v.status))) continue;

    const ready = videos.filter((v) => ["Ready", "Expired"].includes(v.status));
    const status = ready.length > 0 ? "Ready" : "Failed";
    videos = videos.map((v) => ({
      camera: v.camera,
      // A camera with no video at all is missing the whole game
      gaps: ["Ready", "Expired"].includes(v.status)
        ? parseGaps(v.gaps)
        : [{ startAt: session.startAt, endAt: session.endAt }],
    }));
    const reason =
      ready.length === 0 ? "None of the game could be recorded" : missingFootageNote(videos);
    await db.query(
      `UPDATE recording_sessions SET status = ?, failureReason = ?, wholeVideo = 'Done',
              dateUpdated = ?
       WHERE sessionId = ? AND status = 'Processing'`,
      [status, reason, now, session.sessionId]
    );
  }
};

/**
 * CR-006: how far the game's upload is, for "Saving your game… uploading 45%".
 * Null until the box has started sending (it's making the file first).
 * @param {Array<{ uploadBytes, receivedBytes, status }>} videos
 * @returns {number|null} 0–100
 */
export const uploadPercent = (videos) => {
  const sending = videos.filter((v) => Number(v.uploadBytes) > 0 || v.status === "Ready");
  if (sending.length === 0) return null;
  let total = 0;
  let received = 0;
  for (const v of sending) {
    const size = Number(v.uploadBytes) || Number(v.sizeBytes) || 1;
    total += size;
    received += v.status === "Ready" ? size : Math.min(size, Number(v.receivedBytes) || 0);
  }
  return Math.min(100, Math.floor((received / total) * 100));
};

/**
 * End a recording session now (End game on the device, or End game in Admin).
 * The footage so far is kept. A session is at least SESSION_MIN_END_SECONDS
 * long. Its videos are made as soon as it's Processing (advanceSessions).
 *
 * @param {import("../../config/database.js").default} db
 * @param {string} sessionId
 * @returns {Promise<{ ok: true, endAt: string } | { ok: false, status: 404 | 409 }>}
 */
export const endSessionNow = async (db, sessionId) => {
  const nowM = moment().tz(TIMEZONE);
  const now = formatLocal(nowM);
  const rows = await db.query(
    `SELECT venueId, startAt, status FROM recording_sessions WHERE sessionId = ? LIMIT 1`,
    [sessionId]
  );
  if (rows.length === 0) return { ok: false, status: 404 };
  const session = rows[0];
  if (!["Scheduled", "Recording"].includes(session.status) || session.startAt > now) {
    return { ok: false, status: 409 };
  }
  const minEnd = parseLocal(session.startAt).add(SESSION_MIN_END_SECONDS, "seconds");
  const endAt = formatLocal(moment.max(nowM, minEnd));

  // CR-005: an open game gets its real end here and stops rolling (openEnded = 0)
  await db.query(
    `UPDATE recording_sessions SET endAt = ?, openEnded = 0, dateUpdated = ?
     WHERE sessionId = ? AND status IN ('Scheduled', 'Recording') AND endAt > ?`,
    [endAt, now, sessionId, endAt]
  );
  await advanceSessions(db, { venueId: session.venueId });
  return { ok: true, endAt };
};
