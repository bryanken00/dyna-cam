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
