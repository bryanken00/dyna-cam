import { insertWithPayCode } from "./payments.js";
import { randomToken } from "./crypto/tokens.js";
import { findConflict } from "./courtTimeline.js";

/**
 * Book a court for a fixed window — Admin's New game (startNow / startAt,
 * CR-016) and the player's Start a game page (CR-027) share this.
 *
 * Locks the court row, so two bookings on one court can't both pass the
 * overlap check. Run it inside a transaction. PLAN-003: the check is the court
 * timeline — games, live bookings and closures (not opening hours: a game may
 * run outside them) — so a walk-in can't take booked time.
 *
 * @param {import("mysql2/promise").PoolConnection} conn - inside a transaction
 * @param {Object} game
 * @param {string} game.courtId
 * @param {string} game.startLocal - "YYYY-MM-DD HH:mm:ss" (Manila)
 * @param {string} game.endLocal
 * @param {"Recording"|"Scheduled"} game.status - Recording = starts now
 * @param {string} game.now - getCurrentTimestampLocal()
 * @param {string|null} [game.playerName]
 * @param {string|null} [game.phone]
 * @param {string|null} [game.email]
 * @param {number|null} [game.maxCaptures] - NULL → CAPTURE_MAX_PER_GAME
 * @param {boolean} [game.free] - CR-015: no pay code, videos open at once
 * @param {string|null} [game.createdByAccountId] - the staff account, or null
 * @param {boolean} [game.startedByPlayer] - CR-027: started from the court's QR
 * @param {string|null} [game.bookingId] - PLAN-003: the booking being checked in (its own
 *   slot doesn't block it, and the game is linked to it)
 * @returns {Promise<{ ok: true, sessionId: string, shareToken: string, payCode: string|null }
 *   | { ok: false, reason: "COURT_NOT_FOUND"|"NO_CAMERA"|"BUSY", busyFrom?: string,
 *       conflict?: { type: "GAME"|"BOOKING"|"CLOSURE", from, until, id, code? } }>}
 *   busyFrom: the start of the earliest thing in the way (BUSY only)
 */
export const bookCourt = async (
  conn,
  {
    courtId,
    startLocal,
    endLocal,
    status,
    now,
    playerName = null,
    phone = null,
    email = null,
    maxCaptures = null,
    free = false,
    createdByAccountId = null,
    startedByPlayer = false,
    bookingId = null,
  }
) => {
  const [courts] = await conn.execute(
    `SELECT c.courtId, c.venueId, c.cameraRtspUrl IS NOT NULL AS hasCamera
     FROM courts c JOIN venues v ON v.venueId = c.venueId
     WHERE c.courtId = ? AND c.status = 'Active' AND v.status = 'Active'
     LIMIT 1 FOR UPDATE`,
    [courtId]
  );
  if (courts.length === 0) return { ok: false, reason: "COURT_NOT_FOUND" };
  if (!courts[0].hasCamera) return { ok: false, reason: "NO_CAMERA" };

  // An open game waiting for a device has a rolling endAt ahead of now, so it
  // overlaps too
  const conflict = await findConflict(conn, {
    courtId,
    startLocal,
    endLocal,
    ignoreBookingId: bookingId,
    now,
  });
  if (conflict) return { ok: false, reason: "BUSY", busyFrom: conflict.from, conflict };

  const [uuidRow] = await conn.execute(`SELECT UUID() as id`);
  const sessionId = uuidRow[0].id;
  const shareToken = randomToken();
  const payCode = await insertWithPayCode(
    (code) =>
      conn.execute(
        `INSERT INTO recording_sessions
           (sessionId, venueId, courtId, startAt, endAt, playerName, phone, email, shareToken,
            createdByAccountId, startedByPlayer, bookingId, maxCaptures, status, paymentStatus,
            payCode, dateCreated, dateUpdated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sessionId,
          courts[0].venueId,
          courtId,
          startLocal,
          endLocal,
          playerName || null,
          phone || null,
          email || null,
          shareToken,
          createdByAccountId,
          startedByPlayer ? 1 : 0,
          bookingId,
          maxCaptures ?? null,
          status,
          code ? "Unpaid" : "Free",
          code,
          now,
          now,
        ]
      ),
    { conn, free }
  );
  return { ok: true, sessionId, shareToken, payCode };
};
