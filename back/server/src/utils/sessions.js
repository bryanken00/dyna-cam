import { getCurrentTimestampLocal, moment } from "./dateUtils.js";
import { randomToken } from "./crypto/tokens.js";

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
/** A phone can't start a game when the court is booked within this many minutes. */
export const SESSION_START_GAP_MINUTES = SESSION_MIN_MINUTES;

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";

const parseLocal = (value) => moment.tz(value, FORMAT, TIMEZONE);
const formatLocal = (m) => m.clone().tz(TIMEZONE).format(FORMAT);

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
    `SELECT s.sessionId, s.venueId, s.courtId, s.startAt, s.endAt, s.status
     FROM recording_sessions s
     WHERE ${where}`,
    params
  );

  let created = 0;
  for (const session of sessions) {
    const total = partCount(session.startAt, session.endAt);
    for (let index = 0; index < total; index += 1) {
      const window = partWindow(session.startAt, session.endAt, index);
      if (window.windowEndAt > now) break; // later parts aren't due yet

      const [{ id }] = await db.query(`SELECT UUID() AS id`);
      const result = await db.query(
        `INSERT IGNORE INTO clips
           (clipId, venueId, courtId, sessionId, partIndex, source, requestedAt, windowStartAt,
            windowEndAt, durationSeconds, shareToken, status, dateCreated, dateUpdated)
         VALUES (?, ?, ?, ?, ?, 'SESSION', ?, ?, ?, ?, ?, 'Pending', ?, ?)`,
        [
          id,
          session.venueId,
          session.courtId,
          session.sessionId,
          index,
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

    const nextStatus = session.endAt <= now ? "Processing" : "Recording";
    if (nextStatus !== session.status) {
      await db.query(
        `UPDATE recording_sessions SET status = ?, dateUpdated = ?
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
    `SELECT s.sessionId, s.startAt, s.endAt,
            SUM(cl.status IN ('Pending', 'Processing')) AS open,
            SUM(cl.status IN ('Ready', 'Expired')) AS ready,
            COUNT(cl.clipId) AS parts
     FROM recording_sessions s
     LEFT JOIN clips cl ON cl.sessionId = s.sessionId AND cl.status != 'Deleted'
     WHERE ${where}
     GROUP BY s.sessionId, s.startAt, s.endAt`,
    params
  );

  const now = getCurrentTimestampLocal();
  for (const row of rows) {
    const expected = partCount(row.startAt, row.endAt);
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
 * The session recording on a court right now (a booking in progress or a game
 * started from a phone), locked. Inside the caller's transaction.
 * @returns {Promise<Object|null>} { sessionId, startAt, endAt, shareToken }
 */
export const findRunningSession = async (conn, courtId) => {
  const now = getCurrentTimestampLocal();
  const [rows] = await conn.execute(
    `SELECT sessionId, startAt, endAt, shareToken FROM recording_sessions
     WHERE courtId = ? AND status IN ('Scheduled', 'Recording') AND startAt <= ? AND endAt > ?
     ORDER BY startAt DESC
     LIMIT 1 FOR UPDATE`,
    [courtId, now, now]
  );
  return rows[0] || null;
};

/**
 * Start recording a whole game on a court now (PLAN-002 Phase D: "Start
 * recording" on a paired phone). It runs until it is ended, or stops by itself
 * after SESSION_MAX_MINUTES or at the court's next booking, whichever is first.
 * The caller locks the court row (FOR UPDATE) inside its transaction, so two
 * phones tapping Start together get the same session.
 *
 * @param {import("mysql2/promise").PoolConnection} conn
 * @param {Object} court - a row with COURT_RECORDING_COLUMNS (utils/clipRequests.js)
 * @param {{ pairedAppId?: string, accountId?: string }} by - who started it
 * @returns {Promise<{ ok: true, started: boolean, sessionId: string }
 *   | { ok: false, reason: "CAMERA_OFFLINE" }
 *   | { ok: false, reason: "BOOKED_SOON", bookedAt: string }>}
 */
export const startSessionNow = async (conn, court, { pairedAppId = null, accountId = null }) => {
  const running = await findRunningSession(conn, court.courtId);
  if (running) return { ok: true, started: false, sessionId: running.sessionId };

  if (!court.hasCamera || !court.recorderOnline) {
    return { ok: false, reason: "CAMERA_OFFLINE" };
  }

  const nowM = moment().tz(TIMEZONE);
  const now = formatLocal(nowM);
  let end = nowM.clone().add(SESSION_MAX_MINUTES, "minutes");
  const [next] = await conn.execute(
    `SELECT startAt FROM recording_sessions
     WHERE courtId = ? AND status NOT IN ('Cancelled', 'Failed') AND startAt > ? AND startAt < ?
     ORDER BY startAt ASC
     LIMIT 1`,
    [court.courtId, now, formatLocal(end)]
  );
  if (next.length > 0) {
    const bookedAt = parseLocal(next[0].startAt);
    if (bookedAt.diff(nowM, "minutes", true) < SESSION_START_GAP_MINUTES) {
      return { ok: false, reason: "BOOKED_SOON", bookedAt: next[0].startAt };
    }
    end = bookedAt;
  }

  const [uuidRow] = await conn.execute(`SELECT UUID() as id`);
  const sessionId = uuidRow[0].id;
  await conn.execute(
    `INSERT INTO recording_sessions
       (sessionId, venueId, courtId, startAt, endAt, shareToken, createdByAccountId, pairedAppId,
        status, dateCreated, dateUpdated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Recording', ?, ?)`,
    [
      sessionId,
      court.venueId,
      court.courtId,
      now,
      formatLocal(end),
      randomToken(),
      accountId,
      pairedAppId,
      now,
      now,
    ]
  );
  return { ok: true, started: true, sessionId };
};

/**
 * End a recording session now ("End recording" / the admin End button). The
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
