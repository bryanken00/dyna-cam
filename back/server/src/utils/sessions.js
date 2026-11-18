import { getCurrentTimestampLocal, moment } from "./dateUtils.js";
import { randomToken } from "./crypto/tokens.js";
import { FORGET_STREAM_SQL } from "./sessionStreams.js";

/**
 * Full-session recording (PLAN-001 Phase 3).
 *
 * A session books a court for [startAt, endAt). Its footage is delivered as
 * parts of SESSION_PART_SECONDS — each part is an ordinary clip row (source
 * 'SESSION', with windowStartAt/windowEndAt) so the recorder box cuts,
 * watermarks and uploads it like any clip, and it expires like any clip.
 *
 * There is no scheduler: parts are created ("materialised") when they are
 * due — whenever a box polls /device/jobs or fetches /device/config, and by
 * the hourly clip maintenance as a safety net. Creating a part is idempotent
 * (UNIQUE (sessionId, partIndex)).
 */

// 5 minutes keeps a part around 40–50 MB at the box's capped session bitrate,
// so it uploads in a few minutes even on a slow venue line
export const SESSION_PART_SECONDS = 5 * 60;
export const SESSION_MIN_MINUTES = 5;
export const SESSION_MAX_MINUTES = 3 * 60;
export const SESSION_MAX_DAYS_AHEAD = 14;
/**
 * An ended session keeps at least this much footage. Short, so End frees the
 * court at once and a Start right after it begins a new game.
 */
export const SESSION_MIN_END_SECONDS = 1;

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";

const parseLocal = (value) => moment.tz(value, FORMAT, TIMEZONE);
const formatLocal = (m) => m.clone().tz(TIMEZONE).format(FORMAT);

/**
 * CR-003: the capability a recorder box reports in its heartbeat when it can
 * cut a session part from one camera of a two-camera court (instead of both
 * stacked).
 */
export const PER_CAMERA_PARTS_CAPABILITY = "session-part-camera";

/** A box counts as current for this check when it was heard from this recently. */
const CAPABILITY_RECENT_MINUTES = 10;

/**
 * Parts a session should end up with: its windows × its part cameras (1 set,
 * or one set per camera on a two-camera court).
 */
export const expectedParts = (session) =>
  partCount(session.startAt, session.endAt) * (Number(session.partCameras) === 2 ? 2 : 1);

/**
 * How a session's parts are cut, decided once when its first part is made:
 * 2 = a set of parts per camera (the court has camera 2 and every recorder box
 * of the venue heard from lately can cut per camera), else 1 (the box's usual
 * output — one camera, or both stacked for a box that can't).
 */
const decidePartCameras = async (db, session) => {
  const [court] = await db.query(
    `SELECT camera2RtspUrl IS NOT NULL AS hasCamera2 FROM courts WHERE courtId = ? LIMIT 1`,
    [session.courtId]
  );
  if (!court || !Number(court.hasCamera2)) return 1;
  const boxes = await db.query(
    `SELECT lastStatus FROM devices
     WHERE venueId = ? AND status = 'Active' AND lastSeenAt >= ?`,
    [
      session.venueId,
      formatLocal(moment().tz(TIMEZONE).subtract(CAPABILITY_RECENT_MINUTES, "minutes")),
    ]
  );
  const capable = (row) => {
    const status = typeof row.lastStatus === "string" ? JSON.parse(row.lastStatus) : row.lastStatus;
    return (
      Array.isArray(status?.capabilities) &&
      status.capabilities.includes(PER_CAMERA_PARTS_CAPABILITY)
    );
  };
  return boxes.length > 0 && boxes.every(capable) ? 2 : 1;
};

/** Number of parts a session window splits into. */
export const partCount = (startAt, endAt) =>
  Math.max(
    1,
    Math.ceil(parseLocal(endAt).diff(parseLocal(startAt), "seconds") / SESSION_PART_SECONDS)
  );

/** The window of part `index` (0-based) of a session. */
export const partWindow = (startAt, endAt, index) => {
  const start = parseLocal(startAt).add(index * SESSION_PART_SECONDS, "seconds");
  const sessionEnd = parseLocal(endAt);
  const end = moment.min(start.clone().add(SESSION_PART_SECONDS, "seconds"), sessionEnd);
  return {
    windowStartAt: formatLocal(start),
    windowEndAt: formatLocal(end),
    durationSeconds: end.diff(start, "seconds"),
  };
};

/**
 * Create the clip rows for every session part whose window has ended, and move
 * sessions Scheduled → Recording → Processing as time passes.
 *
 * @param {import("../../config/database.js").default} db
 * @param {Object} [scope]
 * @param {string} [scope.venueId] - only this venue's sessions (a box polling)
 * @returns {Promise<number>} parts created
 */
export const materializeSessionParts = async (db, { venueId } = {}) => {
  const now = getCurrentTimestampLocal();
  const params = [now];
  let where = "s.status IN ('Scheduled', 'Recording') AND s.startAt <= ?";
  if (venueId) {
    where += " AND s.venueId = ?";
    params.push(venueId);
  }

  const sessions = await db.query(
    `SELECT s.sessionId, s.venueId, s.courtId, s.startAt, s.endAt, s.status, s.partCameras
     FROM recording_sessions s
     WHERE ${where}`,
    params
  );

  let created = 0;
  for (const session of sessions) {
    const total = partCount(session.startAt, session.endAt);
    const firstDue = partWindow(session.startAt, session.endAt, 0).windowEndAt <= now;
    if (firstDue && !session.partCameras) {
      // CR-003: fixed for the whole game once its first part is made
      const decided = await decidePartCameras(db, session);
      await db.query(
        `UPDATE recording_sessions SET partCameras = ? WHERE sessionId = ? AND partCameras IS NULL`,
        [decided, session.sessionId]
      );
      const [row] = await db.query(
        `SELECT partCameras FROM recording_sessions WHERE sessionId = ? LIMIT 1`,
        [session.sessionId]
      );
      session.partCameras = row.partCameras;
    }
    // 0 = the box's usual output; 1 and 2 = one camera each (CR-003)
    const cameras = Number(session.partCameras) === 2 ? [1, 2] : [0];
    for (let index = 0; index < total; index += 1) {
      const window = partWindow(session.startAt, session.endAt, index);
      if (window.windowEndAt > now) break; // later parts aren't due yet

      for (const camera of cameras) {
        const [{ id }] = await db.query(`SELECT UUID() AS id`);
        const result = await db.query(
          `INSERT IGNORE INTO clips
             (clipId, venueId, courtId, sessionId, partIndex, camera, source, requestedAt,
              windowStartAt, windowEndAt, durationSeconds, shareToken, status, dateCreated,
              dateUpdated)
           VALUES (?, ?, ?, ?, ?, ?, 'SESSION', ?, ?, ?, ?, ?, 'Pending', ?, ?)`,
          [
            id,
            session.venueId,
            session.courtId,
            session.sessionId,
            index,
            camera,
            window.windowEndAt,
            window.windowStartAt,
            window.windowEndAt,
            window.durationSeconds,
            randomToken(),
            now,
            now,
          ]
        );
        created += result.affectedRows || 0;
      }
    }

    const nextStatus = session.endAt <= now ? "Processing" : "Recording";
    if (nextStatus !== session.status) {
      // A finished session forgets the player's stream key (PLAN-002 Phase G)
      const forget = nextStatus === "Processing" ? `, ${FORGET_STREAM_SQL}` : "";
      await db.query(
        `UPDATE recording_sessions SET status = ?, dateUpdated = ?${forget}
         WHERE sessionId = ? AND status IN ('Scheduled', 'Recording')`,
        [nextStatus, now, session.sessionId]
      );
    }
  }
  return created;
};

/**
 * Settle a Processing session once none of its parts is still being made:
 * Ready if at least one part is ready, Failed if none is.
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

  const rows = await db.query(
    `SELECT s.sessionId, s.startAt, s.endAt, s.partCameras,
            SUM(cl.status IN ('Pending', 'Processing')) AS open,
            SUM(cl.status IN ('Ready', 'Expired')) AS ready,
            COUNT(cl.clipId) AS parts
     FROM recording_sessions s
     LEFT JOIN clips cl ON cl.sessionId = s.sessionId AND cl.status != 'Deleted'
     WHERE ${where}
     GROUP BY s.sessionId, s.startAt, s.endAt, s.partCameras`,
    params
  );

  const now = getCurrentTimestampLocal();
  for (const row of rows) {
    const expected = expectedParts(row);
    if (Number(row.parts) < expected || Number(row.open) > 0) continue;
    const ready = Number(row.ready);
    const status = ready > 0 ? "Ready" : "Failed";
    const reason =
      ready === 0
        ? "None of the session's parts could be saved"
        : ready < expected
          ? `${expected - ready} of ${expected} parts could not be saved`
          : null;
    await db.query(
      `UPDATE recording_sessions SET status = ?, failureReason = ?, dateUpdated = ?
       WHERE sessionId = ? AND status = 'Processing'`,
      [status, reason, now, row.sessionId]
    );
  }
};

/**
 * End a recording session now (the device's Stop recording / the admin End button). The
 * footage so far is kept: its last part is cut to the new end. A session is
 * at least SESSION_MIN_END_SECONDS long, so it always has one part.
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

  await db.query(
    `UPDATE recording_sessions SET endAt = ?, dateUpdated = ?
     WHERE sessionId = ? AND status IN ('Scheduled', 'Recording') AND endAt > ?`,
    [endAt, now, sessionId, endAt]
  );
  await materializeSessionParts(db, { venueId: session.venueId });
  return { ok: true, endAt };
};
