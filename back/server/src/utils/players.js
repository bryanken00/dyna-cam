import { addMinutesLocal, getCurrentTimestampLocal, toTimestampLocal } from "./dateUtils.js";
import { hashToken, randomToken } from "./crypto/tokens.js";
import { playerTokenPair, verifyPlayerToken } from "./playerTokens.js";
import { bookingManageUrl, sessionShareUrl } from "./clips.js";

/**
 * PLAN-006: player accounts (one per Google account), their sign-in codes and
 * sessions, and the game log.
 *
 * A sign-in: the Google callback calls signInFromGoogle() → a single-use code
 * (60 s, only its SHA-256 stored) in the browser's redirect → the sign-in page
 * trades it with redeemSignInCode() for an access + refresh pair. Refresh
 * tokens rotate on every use; presenting a revoked one again ends every
 * session of that player (it was copied).
 */

const DUPLICATE = "ER_DUP_ENTRY";

/**
 * Find the player for a Google account, or make one, and give them a sign-in code.
 * @param {object} db  req.db
 * Until the player has completed their profile (first sign-in), the names
 * follow Google; after that only the email and photo do.
 * @param {{ sub, email, name, givenName, familyName, photoUrl }} identity  from utils/googleSignIn.js
 * @returns {Promise<{ code: string } | { blocked: true }>}
 */
export const signInFromGoogle = async (db, identity, { retried = false } = {}) => {
  const now = getCurrentTimestampLocal();
  let conn;
  try {
    conn = await db.beginTransaction();
    const [rows] = await conn.execute(
      `SELECT playerId, status FROM players WHERE googleSub = ? LIMIT 1 FOR UPDATE`,
      [identity.sub]
    );
    let playerId;
    if (rows.length > 0) {
      if (rows[0].status !== "Active") {
        await db.rollback(conn);
        return { blocked: true };
      }
      playerId = rows[0].playerId;
      await conn.execute(
        `UPDATE players
         SET email = ?, photoUrl = ?, lastSignInAt = ?, dateUpdated = ?,
             firstName = IF(profileCompletedAt IS NULL, ?, firstName),
             lastName = IF(profileCompletedAt IS NULL, ?, lastName),
             name = IF(profileCompletedAt IS NULL, ?, name)
         WHERE playerId = ?`,
        [
          identity.email,
          identity.photoUrl,
          now,
          now,
          identity.givenName,
          identity.familyName,
          identity.name,
          playerId,
        ]
      );
    } else {
      const [uuidRow] = await conn.execute(`SELECT UUID() AS id`);
      playerId = uuidRow[0].id;
      await conn.execute(
        `INSERT INTO players
           (playerId, googleSub, email, firstName, lastName, name, photoUrl, lastSignInAt, status,
            dateCreated, dateUpdated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?)`,
        [
          playerId,
          identity.sub,
          identity.email,
          identity.givenName,
          identity.familyName,
          identity.name,
          identity.photoUrl,
          now,
          now,
          now,
        ]
      );
    }

    const code = randomToken(32);
    await conn.execute(
      `INSERT INTO player_sign_in_codes (codeHash, playerId, expiresAt, dateCreated, dateUpdated)
       VALUES (?, ?, ?, ?, ?)`,
      [hashToken(code), playerId, addMinutesLocal(1), now, now]
    );
    await db.commit(conn);
    return { code };
  } catch (err) {
    await db.rollback(conn);
    // Two first sign-ins of one account at the same moment: the other made the row
    if (err?.code === DUPLICATE && !retried) {
      return signInFromGoogle(db, identity, { retried: true });
    }
    throw err;
  }
};

/** Store a new refresh token row (inside the caller's transaction). */
const saveRefresh = (conn, playerId, refreshToken, now) =>
  conn.execute(
    `INSERT INTO player_refresh_tokens (jti, playerId, expiresAt, dateCreated, dateUpdated)
     VALUES (?, ?, ?, ?, ?)`,
    [refreshToken.jti, playerId, toTimestampLocal(refreshToken.expiresAt), now, now]
  );

/**
 * Trade a sign-in code for tokens — once, within 60 s, for an Active player.
 * @returns {Promise<{ accessToken, refreshToken } | null>} null: used, expired, unknown
 */
export const redeemSignInCode = async (db, code) => {
  const now = getCurrentTimestampLocal();
  let conn;
  try {
    conn = await db.beginTransaction();
    const [rows] = await conn.execute(
      `SELECT c.playerId, c.expiresAt, c.usedAt, p.status
       FROM player_sign_in_codes c
       JOIN players p ON p.playerId = c.playerId
       WHERE c.codeHash = ?
       LIMIT 1 FOR UPDATE`,
      [hashToken(code)]
    );
    const row = rows[0];
    if (!row || row.usedAt || row.expiresAt <= now || row.status !== "Active") {
      await db.rollback(conn);
      return null;
    }
    await conn.execute(
      `UPDATE player_sign_in_codes SET usedAt = ?, dateUpdated = ? WHERE codeHash = ?`,
      [now, now, hashToken(code)]
    );
    const tokens = playerTokenPair(row.playerId);
    await saveRefresh(conn, row.playerId, tokens.refreshToken, now);
    await db.commit(conn);
    return tokens;
  } catch (err) {
    await db.rollback(conn);
    throw err;
  }
};

/**
 * Rotate a refresh token. A revoked one presented again ends every session of
 * that player.
 * @returns {Promise<{ accessToken, refreshToken } | null>} null: sign in again
 */
export const rotateRefreshToken = async (db, refreshToken) => {
  let decoded;
  try {
    decoded = verifyPlayerToken(refreshToken, "refresh");
  } catch {
    return null;
  }
  const now = getCurrentTimestampLocal();
  let conn;
  try {
    conn = await db.beginTransaction();
    const [rows] = await conn.execute(
      `SELECT t.playerId, t.expiresAt, t.revokedAt, p.status
       FROM player_refresh_tokens t
       JOIN players p ON p.playerId = t.playerId
       WHERE t.jti = ? AND t.playerId = ?
       LIMIT 1 FOR UPDATE`,
      [decoded.jti, decoded.sub]
    );
    const row = rows[0];
    if (!row) {
      await db.rollback(conn);
      return null;
    }
    if (row.revokedAt) {
      await conn.execute(
        `UPDATE player_refresh_tokens SET revokedAt = ?, dateUpdated = ?
         WHERE playerId = ? AND revokedAt IS NULL`,
        [now, now, row.playerId]
      );
      await db.commit(conn);
      return null;
    }
    if (row.expiresAt <= now || row.status !== "Active") {
      await db.rollback(conn);
      return null;
    }
    const tokens = playerTokenPair(row.playerId);
    await conn.execute(
      `UPDATE player_refresh_tokens SET revokedAt = ?, replacedByJti = ?, dateUpdated = ?
       WHERE jti = ?`,
      [now, tokens.refreshToken.jti, now, decoded.jti]
    );
    await saveRefresh(conn, row.playerId, tokens.refreshToken, now);
    await db.commit(conn);
    return tokens;
  } catch (err) {
    await db.rollback(conn);
    throw err;
  }
};

/** Sign out: revoke this refresh token (a bad or old one is simply ignored). */
export const revokeRefreshToken = async (db, refreshToken) => {
  let decoded;
  try {
    decoded = verifyPlayerToken(refreshToken, "refresh");
  } catch {
    return;
  }
  const now = getCurrentTimestampLocal();
  await db.query(
    `UPDATE player_refresh_tokens SET revokedAt = ?, dateUpdated = ?
     WHERE jti = ? AND playerId = ? AND revokedAt IS NULL`,
    [now, now, decoded.jti, decoded.sub]
  );
};

/**
 * The player as their pages show them. Until `profileComplete`, the names are
 * Google's (to pre-fill the profile form) and booking is refused.
 */
export const playerView = (player) => ({
  firstName: player.firstName || "",
  middleName: player.middleName || "",
  lastName: player.lastName || "",
  name: player.name,
  email: player.email,
  photoUrl: player.photoUrl || null,
  phone: player.phone || null,
  profileComplete: Boolean(player.profileCompletedAt),
});

/** "Ana B. Reyes" style full name, as bookings carry it (≤ 100 chars). */
export const fullName = ({ firstName, middleName, lastName }) =>
  [firstName, middleName, lastName].filter(Boolean).join(" ").slice(0, 100);

/**
 * Save the player's profile (first sign-in, or an edit later) — it is then
 * complete, and Google no longer changes the names.
 * @returns {Promise<object>} the updated row
 */
export const saveProfile = async (db, playerId, { firstName, middleName, lastName, phone }) => {
  const now = getCurrentTimestampLocal();
  await db.query(
    `UPDATE players
     SET firstName = ?, middleName = ?, lastName = ?, name = ?, phone = ?,
         profileCompletedAt = COALESCE(profileCompletedAt, ?), dateUpdated = ?
     WHERE playerId = ? AND status = 'Active'`,
    [
      firstName,
      middleName?.trim() || null,
      lastName,
      fullName({ firstName, middleName, lastName }),
      phone || null,
      now,
      now,
      playerId,
    ]
  );
  const rows = await db.query(
    `SELECT playerId, email, firstName, middleName, lastName, name, photoUrl, phone,
            profileCompletedAt
     FROM players WHERE playerId = ? LIMIT 1`,
    [playerId]
  );
  return rows[0];
};

// ── the game log ────────────────────────────────────────────────────────────

/** Bookings that are still to be played. */
const UPCOMING_STATUSES = ["Pending", "Confirmed", "CheckedIn"];

/**
 * The player's bookings: booked while signed in, or (made before they had an
 * account, PLAN-006 2026-11-26) with their verified Google email — the column's
 * collation makes the match case-insensitive. Expired holds and deleted
 * bookings are left out.
 */
const MINE = `b.status NOT IN ('Deleted', 'Expired')
  AND (b.playerId = ? OR (b.playerId IS NULL AND b.email = ?))`;

const BOOKING_SELECT = `SELECT b.bookingId, b.bookingCode, b.manageToken, b.startAt, b.endAt,
         b.status, b.paymentStatus, b.price, c.name AS courtName, v.name AS venueName
  FROM bookings b
  JOIN courts c ON c.courtId = b.courtId
  JOIN venues v ON v.venueId = b.venueId`;

/**
 * Upcoming bookings (all, soonest first) and one page of past ones (latest
 * first), each with its games. No business IDs: a booking is named by its code.
 */
export const gameLog = async (db, player, { page = 1, limit = 10 } = {}) => {
  const now = getCurrentTimestampLocal();
  const mine = [player.playerId, player.email];
  const upcomingFilter = `b.status IN (${UPCOMING_STATUSES.map(() => "?").join(", ")}) AND b.endAt > ?`;

  const upcoming =
    page === 1
      ? await db.query(
          `${BOOKING_SELECT} WHERE ${MINE} AND ${upcomingFilter} ORDER BY b.startAt ASC LIMIT 50`,
          [...mine, ...UPCOMING_STATUSES, now]
        )
      : [];
  const pastWhere = `${MINE} AND NOT (${upcomingFilter})`;
  const pastArgs = [...mine, ...UPCOMING_STATUSES, now];
  const [{ total }] = await db.query(
    `SELECT COUNT(*) AS total FROM bookings b WHERE ${pastWhere}`,
    pastArgs
  );
  const offset = (page - 1) * limit;
  const past = await db.query(
    `${BOOKING_SELECT} WHERE ${pastWhere} ORDER BY b.startAt DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
    pastArgs
  );

  const ids = [...upcoming, ...past].map((b) => b.bookingId);
  const games = ids.length
    ? await db.query(
        `SELECT bookingId, startAt, endAt, status, shareToken, driveUrl, paymentStatus
         FROM recording_sessions
         WHERE bookingId IN (${ids.map(() => "?").join(", ")}) AND status != 'Cancelled'
         ORDER BY startAt ASC`,
        ids
      )
    : [];

  const view = (b) => ({
    bookingCode: b.bookingCode,
    venueName: b.venueName,
    courtName: b.courtName,
    startAt: b.startAt,
    endAt: b.endAt,
    status: b.status,
    paymentStatus: b.paymentStatus,
    price: Number(b.price),
    bookingUrl: bookingManageUrl(b.manageToken),
    games: games
      .filter((g) => g.bookingId === b.bookingId)
      .map((g) => ({
        startAt: g.startAt,
        endAt: g.endAt,
        status: g.status,
        gameUrl: sessionShareUrl(g.shareToken),
        // A game's Drive folder, once its videos are there (and paid, for an old unpaid game)
        driveUrl: g.status === "Ready" && g.paymentStatus !== "Unpaid" ? g.driveUrl || null : null,
      })),
  });

  return {
    upcoming: upcoming.map(view),
    past: past.map(view),
    pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) },
  };
};
