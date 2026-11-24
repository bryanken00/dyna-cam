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
 * CR-041: a booked game ended early (End game) leaves the rest of the booked
 * time unrecorded. Checking the booking in again then resumes it: a NEW game
 * (its own video) from the end of the last one to the booked end, linked to the
 * same booking, which goes back to CheckedIn and points at the new game.
 *
 * Lock order is court, then booking (like moves and closures), so two
 * writers can't deadlock.
 */

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";

/** Saves a booked game allows — the same 5 as a player-started game (decided 2026-11-23). */
export const BOOKED_GAME_MAX_CAPTURES = 5;

/** CR-041: the least booked time left that is worth resuming. */
export const RESUME_MIN_SECONDS = 60;

const fail = (status, message, code) => ({ ok: false, status, message, code });

const secondsBetween = (from, to) =>
  moment.tz(to, FORMAT, TIMEZONE).diff(moment.tz(from, FORMAT, TIMEZONE), "seconds");

/** CR-041: a game that no longer records (ended, settled, or past its end). */
const gameOver = (game, now) =>
  !["Waiting", "Scheduled", "Recording"].includes(game.status) || game.endAt <= now;

const clock = (local) => moment.tz(local, FORMAT, TIMEZONE).format("h:mm A");

/**
 * CR-041: a booking already checked in → { result } (its running game, or a
 * refusal) or { resumeFrom } (where a resumed game starts; null = not checked in).
 */
const checkInAgain = async (conn, booking, now) => {
  const none = { result: null, resumeFrom: null };
  if (!["CheckedIn", "Completed"].includes(booking.status) || !booking.sessionId) return none;
  const [games] = await conn.execute(
    `SELECT sessionId, shareToken, status, endAt FROM recording_sessions
     WHERE sessionId = ? LIMIT 1`,
    [booking.sessionId]
  );
  const last = games[0];
  if (!last) return none;
  if (!gameOver(last, now)) {
    const result = {
      ok: true,
      sessionId: last.sessionId,
      shareToken: last.shareToken,
      shareUrl: sessionShareUrl(last.shareToken),
      alreadyCheckedIn: true,
      resumed: false,
      status: last.status,
    };
    return { result, resumeFrom: null };
  }
  // Never over the last game's window (it ends at End game, or 1 s after its start)
  const from = last.endAt > now ? last.endAt : now;
  if (secondsBetween(from, booking.endAt) < RESUME_MIN_SECONDS) {
    return { result: fail(409, "This booking's time is over"), resumeFrom: null };
  }
  return { result: null, resumeFrom: from };
};

/**
 * @param {import("mysql2/promise").PoolConnection} conn - inside a transaction
 * @param {Object} options
 * @param {string} options.bookingId
 * @param {boolean} [options.requireRecorderOnline] - players: refuse while the venue's
 *   recorder box is offline, since nothing would be recorded (staff may go ahead)
 * @param {string|null} [options.accountId] - the staff account checking it in
 * @returns {Promise<{ ok: true, sessionId, shareToken, shareUrl, alreadyCheckedIn: boolean,
 *   resumed: boolean, status: "Recording"|"Scheduled" } | { ok: false, status, message, code? }>}
 *   resumed (CR-041): a new game for the rest of the booked time, after one ended early
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

  // A second check-in (another phone, a double tap) lands on the same game while
  // it still records. CR-041: once it has ended early, the rest is resumed.
  const { result: again, resumeFrom } = await checkInAgain(conn, booking, now);
  if (again) return again;

  if (booking.status === "Pending") {
    const expired = booking.holdExpiresAt && booking.holdExpiresAt <= now;
    return fail(
      409,
      expired
        ? "This booking wasn't paid in time and the court was released"
        : "This booking isn't paid yet — pay at the front desk first"
    );
  }
  if (booking.status !== "Confirmed" && !resumeFrom) {
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

  // Early: the game waits for the booked start (advanceSessions starts it).
  // CR-041: a resumed game starts now (or the moment the last one ended).
  const startLocal = resumeFrom || (now < booking.startAt ? booking.startAt : now);
  const scheduled = startLocal > now;
  const game = await bookCourt(conn, {
    courtId: booking.courtId,
    startLocal,
    endLocal: booking.endAt,
    status: scheduled ? "Scheduled" : "Recording",
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
    resumed: !!resumeFrom,
    status: scheduled ? "Scheduled" : "Recording",
  };
};

/**
 * CR-041: what a booked game's page offers about the rest of the booking —
 *   { canResume: true, until }            this game ended early, booked time is left
 *   { canResume: false, until, continuedShareUrl }  a later game of the booking took over
 * or null (not a booked game, still recording, or the booked time is over).
 *
 * @param {import("../../config/database.js").default} db
 * @param {{ sessionId: string, status: string, endAt: string }} game - its settled status
 */
export const resumeOffer = async (db, game) => {
  const rows = await db.query(
    `SELECT b.status, b.endAt, b.sessionId AS currentSessionId,
            cur.shareToken AS currentShareToken, cur.status AS currentStatus
     FROM recording_sessions s
     JOIN bookings b ON b.bookingId = s.bookingId AND b.status != 'Deleted'
     LEFT JOIN recording_sessions cur ON cur.sessionId = b.sessionId
     WHERE s.sessionId = ?
     LIMIT 1`,
    [game.sessionId]
  );
  const booking = rows[0];
  if (!booking || !["CheckedIn", "Completed"].includes(booking.status)) return null;

  if (booking.currentSessionId && booking.currentSessionId !== game.sessionId) {
    return booking.currentShareToken && booking.currentStatus !== "Cancelled"
      ? {
          canResume: false,
          until: booking.endAt,
          continuedShareUrl: sessionShareUrl(booking.currentShareToken),
        }
      : null;
  }

  const now = getCurrentTimestampLocal();
  if (!gameOver(game, now)) return null;
  const from = game.endAt > now ? game.endAt : now;
  if (secondsBetween(from, booking.endAt) < RESUME_MIN_SECONDS) return null;
  return { canResume: true, until: booking.endAt, continuedShareUrl: null };
};
