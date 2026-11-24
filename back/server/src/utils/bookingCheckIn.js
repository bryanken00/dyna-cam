import { getCurrentTimestampLocal, moment } from "./dateUtils.js";
import { bookCourt } from "./gameStart.js";
import { onlineSince } from "./clipRequests.js";
import { sessionShareUrl } from "./clips.js";
import { ERROR_CODES } from "./APIError.js";

/**
 * PLAN-003 Phase D: check a booking in → its recorded game.
 *
 * The game is an ordinary recording_sessions row (bookingId set) made by
 * bookCourt() for the booked window only: it starts now (or at the booked
 * start, Scheduled, if the player is early) and ends by itself at the booked
 * end. It's free — the court was paid with the booking — and allows
 * BOOKED_GAME_MAX_CAPTURES saves, like a game started from the court QR.
 *
 * Lock order is court, then booking (like moves and closures), so two
 * writers can't deadlock.
 */

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";

/** Saves a booked game allows — the same 5 as a player-started game (decided 2026-11-23). */
export const BOOKED_GAME_MAX_CAPTURES = 5;

const fail = (status, message, code) => ({ ok: false, status, message, code });

const clock = (local) => moment.tz(local, FORMAT, TIMEZONE).format("h:mm A");

/**
 * @param {import("mysql2/promise").PoolConnection} conn - inside a transaction
 * @param {Object} options
 * @param {string} options.bookingId
 * @param {boolean} [options.requireRecorderOnline] - players: refuse while the venue's
 *   recorder box is offline, since nothing would be recorded (staff may go ahead)
 * @param {string|null} [options.accountId] - the staff account checking it in
 * @returns {Promise<{ ok: true, sessionId, shareToken, shareUrl, alreadyCheckedIn: boolean,
 *   status: "Recording"|"Scheduled" } | { ok: false, status, message, code? }>}
 */
export const checkInBooking = async (
  conn,
  { bookingId, requireRecorderOnline = false, accountId = null }
) => {
  const now = getCurrentTimestampLocal();

  const [peek] = await conn.execute(`SELECT courtId FROM bookings WHERE bookingId = ? LIMIT 1`, [
    bookingId,
  ]);
  if (peek.length === 0) return fail(404, "Booking not found");

  const [courts] = await conn.execute(
    `SELECT c.courtId, c.cameraRtspUrl IS NOT NULL AS hasCamera,
            EXISTS (SELECT 1 FROM devices d
                    WHERE d.venueId = c.venueId AND d.status = 'Active' AND d.lastSeenAt >= ?)
              AS recorderOnline
     FROM courts c
     WHERE c.courtId = ?
     LIMIT 1 FOR UPDATE`,
    [onlineSince(), peek[0].courtId]
  );

  const [rows] = await conn.execute(
    `SELECT b.bookingId, b.courtId, b.startAt, b.endAt, b.playerName, b.phone, b.email, b.status,
            b.paymentStatus, b.holdExpiresAt, b.sessionId, v.checkInEarlyMinutes
     FROM bookings b
     JOIN venues v ON v.venueId = b.venueId AND v.status != 'Deleted'
     WHERE b.bookingId = ? AND b.status != 'Deleted'
     LIMIT 1 FOR UPDATE`,
    [bookingId]
  );
  if (rows.length === 0) return fail(404, "Booking not found");
  const booking = rows[0];

  // A second check-in (another phone, a double tap) lands on the same game
  if (booking.status === "CheckedIn" && booking.sessionId) {
    const [games] = await conn.execute(
      `SELECT sessionId, shareToken, status FROM recording_sessions WHERE sessionId = ? LIMIT 1`,
      [booking.sessionId]
    );
    if (games.length > 0) {
      return {
        ok: true,
        sessionId: games[0].sessionId,
        shareToken: games[0].shareToken,
        shareUrl: sessionShareUrl(games[0].shareToken),
        alreadyCheckedIn: true,
        status: games[0].status,
      };
    }
  }

  if (booking.status === "Pending") {
    const expired = booking.holdExpiresAt && booking.holdExpiresAt <= now;
    return fail(
      409,
      expired
        ? "This booking wasn't paid in time and the court was released"
        : "This booking isn't paid yet — pay at the front desk first"
    );
  }
  if (booking.status !== "Confirmed") {
    return fail(
      409,
      {
        Cancelled: "This booking was cancelled",
        Expired: "This booking wasn't paid in time and the court was released",
        NoShow: "This booking was marked as a no-show — ask the front desk",
        Completed: "This booking has already been played",
      }[booking.status] || "This booking can't be checked in"
    );
  }

  const opensAt = moment
    .tz(booking.startAt, FORMAT, TIMEZONE)
    .subtract(booking.checkInEarlyMinutes, "minutes")
    .format(FORMAT);
  if (now < opensAt) {
    return fail(409, `Check in opens at ${clock(opensAt)} — come back then`);
  }
  if (now >= booking.endAt) {
    return fail(409, "This booking's time is over");
  }

  if (!courts[0]?.hasCamera || (requireRecorderOnline && !Number(courts[0].recorderOnline))) {
    return fail(
      503,
      "This court's camera is offline right now, so your game can't be recorded. Please tell the front desk.",
      ERROR_CODES.CAMERA_OFFLINE
    );
  }

  // Early: the game waits for the booked start (advanceSessions starts it)
  const early = now < booking.startAt;
  const game = await bookCourt(conn, {
    courtId: booking.courtId,
    startLocal: early ? booking.startAt : now,
    endLocal: booking.endAt,
    status: early ? "Scheduled" : "Recording",
    now,
    playerName: booking.playerName,
    phone: booking.phone,
    email: booking.email,
    maxCaptures: BOOKED_GAME_MAX_CAPTURES,
    free: true,
    createdByAccountId: accountId,
    bookingId: booking.bookingId,
  });
  if (!game.ok) {
    if (game.reason === "BUSY") {
      // Something still on the court (a game running over, an open game)
      return fail(409, "The court is still in use — please tell the front desk");
    }
    return fail(game.reason === "NO_CAMERA" ? 503 : 404, "This court can't record right now — please tell the front desk");
  }

  await conn.execute(
    `UPDATE bookings SET status = 'CheckedIn', sessionId = ?, dateUpdated = ? WHERE bookingId = ?`,
    [game.sessionId, now, booking.bookingId]
  );

  return {
    ok: true,
    sessionId: game.sessionId,
    shareToken: game.shareToken,
    shareUrl: sessionShareUrl(game.shareToken),
    alreadyCheckedIn: false,
    status: early ? "Scheduled" : "Recording",
  };
};
