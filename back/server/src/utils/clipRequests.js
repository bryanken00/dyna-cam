import {
  CLIP_COOLDOWN_SECONDS,
  CLIP_DURATION_SECONDS,
  DEVICE_ONLINE_SECONDS,
  secondsAgoLocal,
} from "./clips.js";
import { getCurrentTimestampLocal, moment } from "./dateUtils.js";
import { randomPayCode, randomToken } from "./crypto/tokens.js";

/**
 * Saving a clip — shared by every way a player or staff member can ask for one
 * (court QR, court button, Admin "save now"). Runs inside the caller's
 * transaction (`conn` from req.db.beginTransaction()).
 *
 * Rules (PLAN-001):
 *  - the court and its venue must be Active, the court must have a camera, and
 *    the venue's recorder box must be online — otherwise nothing could cut it
 *  - a request within CLIP_COOLDOWN_SECONDS of another clip on the same court
 *    returns that clip (merged) instead of making a second one
 */

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";

/** Columns every caller needs to decide whether a court can record. */
export const COURT_RECORDING_COLUMNS = `
  c.courtId, c.venueId, c.name, c.cameraRtspUrl IS NOT NULL AS hasCamera,
  v.name AS venueName, v.logoUrl, v.clipPrice, c.streamEnabled, c.streamWatchUrl,
  EXISTS (
    SELECT 1 FROM devices d
    WHERE d.venueId = c.venueId AND d.status = 'Active' AND d.lastSeenAt >= ?
  ) AS recorderOnline`;

/** The `?` parameter COURT_RECORDING_COLUMNS needs (first in the list). */
export const onlineSince = () => secondsAgoLocal(DEVICE_ONLINE_SECONDS);

/** Manila timestamp of an epoch-ms instant (a button press time from the box). */
export const localFromEpochMs = (ms) => moment(ms).tz(TIMEZONE).format("YYYY-MM-DD HH:mm:ss");

/**
 * @param {import("mysql2/promise").PoolConnection} conn - inside a transaction
 * @param {Object} court - a row with COURT_RECORDING_COLUMNS
 * @param {Object} options
 * @param {"QR"|"BUTTON"|"STAFF"} options.source
 * @param {string} options.requestedAt - Manila timestamp of the moment to keep
 * @returns {Promise<{ ok: false, reason: "CAMERA_OFFLINE" }
 *   | { ok: true, merged: boolean, clipId: string, shareToken: string }>}
 */
export const requestClip = async (conn, court, { source, requestedAt }) => {
  if (!court.hasCamera || !court.recorderOnline) {
    return { ok: false, reason: "CAMERA_OFFLINE" };
  }

  // Lock just the court row: concurrent requests on one court are serialised,
  // so the cooldown check below can't be raced
  await conn.execute(`SELECT id FROM courts WHERE courtId = ? FOR UPDATE`, [court.courtId]);

  const [recent] = await conn.execute(
    `SELECT clipId, shareToken FROM clips
     WHERE courtId = ? AND status IN ('Pending', 'Processing', 'Ready')
       AND requestedAt BETWEEN DATE_SUB(?, INTERVAL ? SECOND) AND DATE_ADD(?, INTERVAL ? SECOND)
     ORDER BY requestedAt DESC
     LIMIT 1`,
    [court.courtId, requestedAt, CLIP_COOLDOWN_SECONDS, requestedAt, CLIP_COOLDOWN_SECONDS]
  );
  if (recent.length > 0) {
    return { ok: true, merged: true, clipId: recent[0].clipId, shareToken: recent[0].shareToken };
  }

  const [uuidRow] = await conn.execute(`SELECT UUID() as id`);
  const clipId = uuidRow[0].id;
  const shareToken = randomToken();
  const now = getCurrentTimestampLocal();

  // Players' clips cost the venue's price (Phase 4, paid in cash at the desk);
  // a staff save is free
  const price = source === "STAFF" ? 0 : Number(court.clipPrice || 0);
  const priced = price > 0;

  // The pay code is unique; on the (rare) collision try another
  for (let attempt = 0; ; attempt += 1) {
    try {
      await conn.execute(
        `INSERT INTO clips
           (clipId, venueId, courtId, source, requestedAt, durationSeconds, price, paymentStatus,
            payCode, shareToken, status, dateCreated, dateUpdated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?)`,
        [
          clipId,
          court.venueId,
          court.courtId,
          source,
          requestedAt,
          CLIP_DURATION_SECONDS,
          price,
          priced ? "Unpaid" : "Free",
          priced ? randomPayCode() : null,
          shareToken,
          now,
          now,
        ]
      );
      break;
    } catch (err) {
      if (err.code !== "ER_DUP_ENTRY" || attempt >= 4) throw err;
    }
  }

  return { ok: true, merged: false, clipId, shareToken };
};
