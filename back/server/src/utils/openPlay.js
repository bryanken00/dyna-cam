import { getCurrentTimestampLocal, moment } from "./dateUtils.js";
import { findConflict } from "./courtTimeline.js";
import { conflictMessage } from "./bookings.js";
import { randomPayCode, randomToken } from "./crypto/tokens.js";
import { REFUND_QUEUED } from "./bookingPayments.js";
import { SKILL_LEVELS } from "./venueFacts.js";

/**
 * PLAN-009 phase C — Open Play sessions and the players' spots in them.
 *
 * A session takes some of a venue's courts for a window. Its courts are blocked
 * on the court timeline by court_closures rows tied to it (playSessionId), so a
 * booking, the availability grid, the Admin day grid and the TV board all see
 * that time as taken without knowing about Open Play. Every writer here locks
 * the session's court rows FOR UPDATE (sorted, so two writers can't deadlock)
 * before asking findConflict(), like every booking writer does.
 *
 * Spots: a free session confirms a spot at once; a paid one holds it (Pending)
 * for its Xendit checkout (utils/playPayments.js). Capacity counts live spots —
 * Confirmed, CheckedIn, and Pending with the hold not run out — and is checked
 * with the session row locked, so two players can't take the last spot.
 *
 * Functions taking `conn` run inside the caller's transaction.
 */

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";

const fail = (status, message, code) => ({ ok: false, status, message, code });

/** A spot that counts against the cap (alias `ps`, one `?` = now). */
export const LIVE_SIGNUP = `(ps.status IN ('Confirmed', 'CheckedIn')
  OR (ps.status = 'Pending' AND ps.holdExpiresAt > ?))`;

const local = (value) => moment.tz(value, FORMAT, TIMEZONE);

/** The reason staff see on the court timeline (the closure's reason). */
const blockReason = (title) => `Open Play: ${title}`.slice(0, 255);

/** Lock court rows in a fixed order (every multi-court writer does the same). */
export const lockCourts = async (conn, courtIds) => {
  for (const courtId of [...new Set(courtIds)].sort()) {
    await conn.execute(`SELECT courtId FROM courts WHERE courtId = ? FOR UPDATE`, [courtId]);
  }
};

/** The venue's Active courts among `courtIds` → [{ courtId, name }] (all of them, or a refusal). */
const venueCourts = async (conn, venueId, courtIds) => {
  const ids = [...new Set(courtIds)];
  if (!ids.length) return fail(400, "Pick at least one court");
  const [rows] = await conn.execute(
    `SELECT courtId, name FROM courts
     WHERE venueId = ? AND status = 'Active' AND courtId IN (${ids.map(() => "?").join(", ")})`,
    [venueId, ...ids]
  );
  if (rows.length !== ids.length) return fail(400, "Pick courts of this venue that are in use");
  return { ok: true, courts: rows };
};

/** The first court whose window isn't free (outside opening hours counts), as a refusal. */
const windowProblem = async (conn, { courts, startAt, endAt, ignorePlaySessionId = null, now }) => {
  for (const court of courts) {
    const conflict = await findConflict(conn, {
      courtId: court.courtId,
      startLocal: startAt,
      endLocal: endAt,
      ignorePlaySessionId,
      checkHours: true,
      now,
    });
    if (conflict) return fail(409, `${court.name}: ${conflictMessage(conflict)}`);
  }
  return null;
};

/** Replace a session's court blocks (one closure per court) with ones for this window. */
const writeBlocks = async (conn, { playSessionId, venueId, courtIds, startAt, endAt, title, accountId, now }) => {
  await conn.execute(
    `UPDATE court_closures SET status = 'Deleted', dateUpdated = ?
     WHERE playSessionId = ? AND status = 'Active'`,
    [now, playSessionId]
  );
  for (const courtId of courtIds) {
    const [uuid] = await conn.execute(`SELECT UUID() AS id`);
    await conn.execute(
      `INSERT INTO court_closures
         (closureId, venueId, courtId, playSessionId, startAt, endAt, reason, createdByAccountId,
          status, dateCreated, dateUpdated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?)`,
      [uuid[0].id, venueId, courtId, playSessionId, startAt, endAt, blockReason(title), accountId, now, now]
    );
  }
};

/** A level range that runs backwards (Advanced … Beginner) is a refusal. */
const levelProblem = ({ minLevel, maxLevel }) =>
  minLevel && maxLevel && SKILL_LEVELS.indexOf(minLevel) > SKILL_LEVELS.indexOf(maxLevel)
    ? fail(400, "The lowest level must come before the highest")
    : null;

/**
 * A new session on `courtIds` (Scheduled), with its court blocks.
 * @param {Object} fields - { kind, title, description, coachName, clubId, startAt, endAt, minLevel,
 *   maxLevel, capacity, pricePerHead } (validated; clubId checked by the caller)
 * @returns {Promise<{ ok: true, playSessionId, playToken } | { ok: false, status, message }>}
 */
export const createPlaySession = async (
  conn,
  { venueId, seriesId = null, fields, courtIds, accountId = null, now = getCurrentTimestampLocal() }
) => {
  const levels = levelProblem(fields);
  if (levels) return levels;
  if (fields.endAt <= now) return fail(400, "The session must end in the future");
  await lockCourts(conn, courtIds);
  const picked = await venueCourts(conn, venueId, courtIds);
  if (!picked.ok) return picked;
  const busy = await windowProblem(conn, { courts: picked.courts, startAt: fields.startAt, endAt: fields.endAt, now });
  if (busy) return busy;

  const [uuid] = await conn.execute(`SELECT UUID() AS id`);
  const playSessionId = uuid[0].id;
  const playToken = randomToken();
  await conn.execute(
    `INSERT INTO play_sessions
       (playSessionId, venueId, seriesId, clubId, playToken, kind, title, description, coachName, startAt, endAt,
        minLevel, maxLevel, capacity, pricePerHead, createdByAccountId, status, dateCreated, dateUpdated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Scheduled', ?, ?)`,
    [
      playSessionId,
      venueId,
      seriesId,
      // PLAN-009 phase F: members of this club only; a clinic's coach
      fields.clubId || null,
      playToken,
      fields.kind || "OpenPlay",
      fields.title,
      fields.description || null,
      fields.coachName || null,
      fields.startAt,
      fields.endAt,
      fields.minLevel || null,
      fields.maxLevel || null,
      fields.capacity,
      fields.pricePerHead,
      accountId,
      now,
      now,
    ]
  );
  for (const court of picked.courts) {
    await conn.execute(`INSERT INTO play_session_courts (playSessionId, courtId) VALUES (?, ?)`, [
      playSessionId,
      court.courtId,
    ]);
  }
  await writeBlocks(conn, {
    playSessionId,
    venueId,
    courtIds: picked.courts.map((c) => c.courtId),
    startAt: fields.startAt,
    endAt: fields.endAt,
    title: fields.title,
    accountId,
    now,
  });
  return { ok: true, playSessionId, playToken };
};

/** How many live spots a session has (inside a transaction: `conn`). */
export const liveSpots = async (conn, playSessionId, now, { exceptSignupId = null } = {}) => {
  const [rows] = await conn.execute(
    `SELECT COUNT(*) AS n FROM play_signups ps
     WHERE ps.playSessionId = ? AND ${LIVE_SIGNUP} AND (? IS NULL OR ps.playSignupId != ?)`,
    [playSessionId, now, exceptSignupId, exceptSignupId]
  );
  return Number(rows[0].n);
};

/** Lock a session row (any status but Deleted) → the row, or null. */
export const lockSession = async (conn, { playSessionId = null, playToken = null }) => {
  const [rows] = await conn.execute(
    `SELECT ps.*, v.companyId, v.onlineHoldMinutes, v.cancelCutoffHours, v.name AS venueName,
            v.status AS venueStatus, co.status AS companyStatus
     FROM play_sessions ps
     JOIN venues v ON v.venueId = ps.venueId
     JOIN companies co ON co.companyId = v.companyId
     WHERE ${playSessionId ? "ps.playSessionId = ?" : "ps.playToken = ?"} AND ps.status != 'Deleted'
     LIMIT 1 FOR UPDATE`,
    [playSessionId || playToken]
  );
  return rows[0] || null;
};

/** The session's court IDs. */
export const sessionCourtIds = async (conn, playSessionId) => {
  const [rows] = await conn.execute(`SELECT courtId FROM play_session_courts WHERE playSessionId = ?`, [
    playSessionId,
  ]);
  return rows.map((r) => r.courtId);
};

/**
 * Change a Scheduled session that hasn't ended: its window, courts, cap, price
 * (new spots only), levels, title. The cap can't go below the spots taken.
 * @param session - the locked row (lockSession)
 */
export const updatePlaySession = async (conn, { session, fields, courtIds, accountId = null, now }) => {
  if (session.status !== "Scheduled") return fail(409, "This session was cancelled");
  if (session.endAt <= now) return fail(409, "This session is over — it can't be changed");
  const levels = levelProblem(fields);
  if (levels) return levels;
  if (fields.endAt <= now) return fail(400, "The session must end in the future");
  const taken = await liveSpots(conn, session.playSessionId, now);
  if (fields.capacity < taken) {
    return fail(409, `${taken} players have joined — the cap can't be lower than that`);
  }

  const before = await sessionCourtIds(conn, session.playSessionId);
  await lockCourts(conn, [...before, ...courtIds]);
  const picked = await venueCourts(conn, session.venueId, courtIds);
  if (!picked.ok) return picked;
  const busy = await windowProblem(conn, {
    courts: picked.courts,
    startAt: fields.startAt,
    endAt: fields.endAt,
    ignorePlaySessionId: session.playSessionId,
    now,
  });
  if (busy) return busy;

  await conn.execute(
    `UPDATE play_sessions
     SET title = ?, description = ?, coachName = ?, clubId = ?, startAt = ?, endAt = ?, minLevel = ?, maxLevel = ?,
         capacity = ?, pricePerHead = ?, dateUpdated = ?
     WHERE playSessionId = ?`,
    [
      fields.title,
      fields.description || null,
      fields.coachName || null,
      fields.clubId || null,
      fields.startAt,
      fields.endAt,
      fields.minLevel || null,
      fields.maxLevel || null,
      fields.capacity,
      fields.pricePerHead,
      now,
      session.playSessionId,
    ]
  );
  await conn.execute(`DELETE FROM play_session_courts WHERE playSessionId = ?`, [session.playSessionId]);
  for (const court of picked.courts) {
    await conn.execute(`INSERT INTO play_session_courts (playSessionId, courtId) VALUES (?, ?)`, [
      session.playSessionId,
      court.courtId,
    ]);
  }
  await writeBlocks(conn, {
    playSessionId: session.playSessionId,
    venueId: session.venueId,
    courtIds: picked.courts.map((c) => c.courtId),
    startAt: fields.startAt,
    endAt: fields.endAt,
    title: fields.title,
    accountId,
    now,
  });
  return { ok: true };
};

/**
 * One spot cancelled (any live one): a paid spot's online payments are queued
 * for a refund (sent after commit — runPaymentFollowUps), an open checkout is
 * returned to close.
 * @returns {{ refundPaymentIds: string[], closeCheckoutId: string|null, venueId: string }}
 */
export const cancelSignupRow = async (conn, { signup, venueId, by, now }) => {
  await conn.execute(
    `UPDATE play_signups
     SET status = 'Cancelled', cancelledAt = ?, cancelledBy = ?, holdExpiresAt = NULL,
         checkoutId = NULL, checkoutUrl = NULL, dateUpdated = ?
     WHERE playSignupId = ?`,
    [now, by, now, signup.playSignupId]
  );
  const refundPaymentIds = [];
  if (signup.paymentStatus === "Paid") {
    const [paid] = await conn.execute(
      `SELECT paymentId FROM payments
       WHERE playSignupId = ? AND status = 'Paid' AND method = 'ONLINE' AND refundError IS NULL`,
      [signup.playSignupId]
    );
    for (const p of paid) {
      await conn.execute(`UPDATE payments SET refundError = ?, dateUpdated = ? WHERE paymentId = ?`, [
        REFUND_QUEUED,
        now,
        p.paymentId,
      ]);
      refundPaymentIds.push(p.paymentId);
    }
  }
  return { refundPaymentIds, closeCheckoutId: signup.checkoutId || null, venueId };
};

/**
 * Cancel a Scheduled session: its court blocks go, every live spot is cancelled
 * (paid ones refunded after commit).
 * @returns {Promise<{ ok: true, followUps: Array, signupIds: string[] } | { ok: false, … }>}
 */
export const cancelPlaySession = async (conn, { session, reason = null, now }) => {
  if (session.status !== "Scheduled") return fail(409, "This session was already cancelled");
  if (session.endAt <= now) return fail(409, "This session is over — it can't be cancelled");
  await conn.execute(
    `UPDATE play_sessions SET status = 'Cancelled', cancelledAt = ?, cancelReason = ?, dateUpdated = ?
     WHERE playSessionId = ?`,
    [now, reason, now, session.playSessionId]
  );
  await conn.execute(
    `UPDATE court_closures SET status = 'Deleted', dateUpdated = ?
     WHERE playSessionId = ? AND status = 'Active'`,
    [now, session.playSessionId]
  );
  const [spots] = await conn.execute(
    `SELECT ps.* FROM play_signups ps
     WHERE ps.playSessionId = ? AND ps.status IN ('Pending', 'Confirmed', 'CheckedIn') FOR UPDATE`,
    [session.playSessionId]
  );
  const followUps = [];
  for (const signup of spots) {
    followUps.push(await cancelSignupRow(conn, { signup, venueId: session.venueId, by: "Staff", now }));
  }
  return { ok: true, followUps, signupIds: spots.map((s) => s.playSignupId) };
};

/** Insert a spot with a fresh signupCode (retrying the rare collision). */
export const insertSignup = async (conn, values) => {
  for (let attempt = 0; ; attempt += 1) {
    const signupCode = randomPayCode();
    const [uuid] = await conn.execute(`SELECT UUID() AS id`);
    try {
      await conn.execute(
        `INSERT INTO play_signups
           (playSignupId, playSessionId, playerId, walkInName, email, phone, signupCode, price,
            paymentStatus, holdExpiresAt, createdByAccountId, status, dateCreated, dateUpdated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuid[0].id,
          values.playSessionId,
          values.playerId || null,
          values.walkInName || null,
          values.email || null,
          values.phone || null,
          signupCode,
          values.price,
          values.paymentStatus,
          values.holdExpiresAt || null,
          values.createdByAccountId || null,
          values.status,
          values.now,
          values.now,
        ]
      );
      return { playSignupId: uuid[0].id, signupCode };
    } catch (err) {
      if (err.code !== "ER_DUP_ENTRY" || attempt >= 4) throw err;
    }
  }
};

/** Why a locked session takes no new spot right now (null: it does). */
export const joinProblem = (session, now) => {
  if (!session || session.status === "Deleted") return fail(404, "This session isn't available");
  if (session.venueStatus !== "Active" || session.companyStatus !== "Active") {
    return fail(404, "This session isn't available");
  }
  if (session.status === "Cancelled") return fail(409, "This session was cancelled");
  if (session.endAt <= now) return fail(409, "This session is over");
  return null;
};

/**
 * How long a spot is held for its checkout: the venue's online hold, but never
 * past the session's end (players may join a session that's already running).
 */
export const spotHoldUntil = (session, now) => {
  const until = local(now).add(session.onlineHoldMinutes || 15, "minutes").format(FORMAT);
  return until < session.endAt ? until : session.endAt;
};

/** The player's live spot in a session (inside the transaction), or null. */
export const playerSpot = async (conn, playSessionId, playerId, now) => {
  const [rows] = await conn.execute(
    `SELECT ps.* FROM play_signups ps
     WHERE ps.playSessionId = ? AND ps.playerId = ? AND ${LIVE_SIGNUP}
     ORDER BY ps.id DESC LIMIT 1 FOR UPDATE`,
    [playSessionId, playerId, now]
  );
  return rows[0] || null;
};

/** Spots whose hold ran out → Expired (the spot is free again). The minute job runs this. */
export const expirePlayHolds = async (db, { now = getCurrentTimestampLocal() } = {}) => {
  const result = await db.query(
    `UPDATE play_signups SET status = 'Expired', dateUpdated = ?
     WHERE status = 'Pending' AND holdExpiresAt IS NOT NULL AND holdExpiresAt <= ?`,
    [now, now]
  );
  return Number(result?.affectedRows || 0);
};

/** What staff and players see: Scheduled · Live · Ended · Cancelled. */
export const sessionState = (s, now) => {
  if (s.status === "Cancelled") return "Cancelled";
  if (s.endAt <= now) return "Ended";
  if (s.startAt <= now) return "Live";
  return "Scheduled";
};

/** "Juan dela Cruz" → "Juan" — the only part of a name other players see. */
export const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "Player";

/** PLAN-009 phase F: is this player an Active member of the club? */
export const isClubMember = async (conn, clubId, playerId) => {
  const [rows] = await conn.execute(
    `SELECT 1 FROM club_members WHERE clubId = ? AND playerId = ? AND status = 'Active' LIMIT 1`,
    [clubId, playerId]
  );
  return rows.length > 0;
};

/** PLAN-009 phase F: a club a session may be limited to — Active, at the session's venue. */
export const clubProblem = async (conn, clubId, venueId) => {
  if (!clubId) return null;
  const [rows] = await conn.execute(
    `SELECT 1 FROM clubs WHERE clubId = ? AND venueId = ? AND status = 'Active' LIMIT 1`,
    [clubId, venueId]
  );
  return rows.length ? null : fail(400, "Pick an active club of this venue");
};
