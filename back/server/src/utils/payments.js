import { randomPayCode } from "./crypto/tokens.js";
import { getCurrentTimestampLocal } from "./dateUtils.js";

/**
 * Recording a cash payment for a clip (PLAN-001 Phase 4) — shared by the
 * Admin portal (a staff account) and paired staff phones (PLAN-002). Runs
 * inside the caller's transaction.
 *
 * A payment can only be taken for an Unpaid clip that is still Pending,
 * Processing or Ready; recording it unlocks the clip for the player.
 *
 * CR-015: a game (recording session) is paid the same way — staff type the
 * amount — and its videos open for the player once it is Paid.
 */

const PAYABLE = ["Pending", "Processing", "Ready"];

/**
 * @param {import("mysql2/promise").PoolConnection} conn - inside a transaction
 * @param {Object} options
 * @param {string} [options.payCode] - find the clip by the code the player shows…
 * @param {string} [options.clipId] - …or by its ID
 * @param {string} [options.venueId] - only a clip of this venue (paired phones)
 * @param {string} [options.accountId] - the staff account taking the cash
 * @param {string} [options.pairedAppId] - or the paired phone taking it
 * @param {string} [options.note]
 * @returns {Promise<{ ok: true, paymentId: string, clipId: string, amount: number }
 *   | { ok: false, status: number, message: string }>}
 */
export const recordCashPayment = async (
  conn,
  { payCode, clipId, venueId, accountId, pairedAppId, note }
) => {
  const params = [payCode || clipId];
  let where = `${payCode ? "payCode" : "clipId"} = ? AND status != 'Deleted'`;
  if (venueId) {
    where += " AND venueId = ?";
    params.push(venueId);
  }

  const [rows] = await conn.execute(
    `SELECT clipId, venueId, price, paymentStatus, status FROM clips
     WHERE ${where}
     LIMIT 1 FOR UPDATE`,
    params
  );
  if (rows.length === 0) {
    return {
      ok: false,
      status: 404,
      message: payCode ? "No clip has that pay code" : "Clip not found",
    };
  }
  const clip = rows[0];
  if (clip.paymentStatus !== "Unpaid") {
    return {
      ok: false,
      status: 409,
      message: clip.paymentStatus === "Paid" ? "This clip is already paid" : "This clip is free",
    };
  }
  if (!PAYABLE.includes(clip.status)) {
    return {
      ok: false,
      status: 409,
      message: `This clip ${clip.status === "Expired" ? "has expired" : "could not be saved"} — don't take payment`,
    };
  }

  const now = getCurrentTimestampLocal();
  const [uuidRow] = await conn.execute(`SELECT UUID() as id`);
  const paymentId = uuidRow[0].id;
  await conn.execute(
    `INSERT INTO payments
       (paymentId, clipId, venueId, amount, method, receivedByAccountId, pairedAppId, note, status,
        paidAt, dateCreated, dateUpdated)
     VALUES (?, ?, ?, ?, 'CASH', ?, ?, ?, 'Paid', ?, ?, ?)`,
    [
      paymentId,
      clip.clipId,
      clip.venueId,
      clip.price,
      accountId || null,
      pairedAppId || null,
      note || null,
      now,
      now,
      now,
    ]
  );
  await conn.execute(`UPDATE clips SET paymentStatus = 'Paid', dateUpdated = ? WHERE clipId = ?`, [
    now,
    clip.clipId,
  ]);

  return { ok: true, paymentId, clipId: clip.clipId, amount: Number(clip.price) };
};

/**
 * CR-015: run an INSERT that needs a fresh pay code, trying another code on the
 * (rare) collision with the UNIQUE index. Returns the code that was stored.
 * A free game (staff chose "Free game") is inserted once with no code → null.
 *
 * @param {(payCode: string|null) => Promise<unknown>} insert
 */
export const insertWithPayCode = async (insert, { conn, free = false } = {}) => {
  if (free) {
    await insert(null);
    return null;
  }
  for (let attempt = 0; ; attempt += 1) {
    const payCode = randomPayCode();
    // Staff look a code up on the Payments page: never reuse a clip's code
    if (conn && attempt < 4) {
      const [taken] = await conn.execute(`SELECT 1 FROM clips WHERE payCode = ? LIMIT 1`, [
        payCode,
      ]);
      if (taken.length > 0) continue;
    }
    try {
      await insert(payCode);
      return payCode;
    } catch (err) {
      if (err.code !== "ER_DUP_ENTRY" || attempt >= 4) throw err;
    }
  }
};

/** A game can be paid for while it is waiting, running or saved — not once it failed or was cancelled. */
const GAME_PAYABLE = ["Waiting", "Scheduled", "Recording", "Processing", "Ready"];

/**
 * CR-015: record the cash a player paid for a game; its videos open.
 *
 * @param {import("mysql2/promise").PoolConnection} conn - inside a transaction
 * @param {Object} options
 * @param {string} options.sessionId
 * @param {number} options.amount - what staff typed
 * @param {string} options.accountId - the staff account taking the cash
 * @param {string} [options.note]
 * @returns {Promise<{ ok: true, paymentId: string, sessionId: string, amount: number }
 *   | { ok: false, status: number, message: string }>}
 */
export const recordGamePayment = async (conn, { sessionId, amount, accountId, note }) => {
  const [rows] = await conn.execute(
    `SELECT sessionId, venueId, status, paymentStatus FROM recording_sessions
     WHERE sessionId = ? LIMIT 1 FOR UPDATE`,
    [sessionId]
  );
  if (rows.length === 0) {
    return { ok: false, status: 404, message: "Game not found" };
  }
  const game = rows[0];
  if (game.paymentStatus !== "Unpaid") {
    return {
      ok: false,
      status: 409,
      message:
        game.paymentStatus === "Paid" ? "This game is already paid" : "This game is free — no payment needed",
    };
  }
  if (!GAME_PAYABLE.includes(game.status)) {
    return {
      ok: false,
      status: 409,
      message: `This game ${game.status === "Cancelled" ? "was cancelled" : "could not be saved"} — don't take payment`,
    };
  }

  const now = getCurrentTimestampLocal();
  const [uuidRow] = await conn.execute(`SELECT UUID() as id`);
  const paymentId = uuidRow[0].id;
  await conn.execute(
    `INSERT INTO payments
       (paymentId, sessionId, venueId, amount, method, receivedByAccountId, note, status,
        paidAt, dateCreated, dateUpdated)
     VALUES (?, ?, ?, ?, 'CASH', ?, ?, 'Paid', ?, ?, ?)`,
    [paymentId, game.sessionId, game.venueId, amount, accountId || null, note || null, now, now, now]
  );
  await conn.execute(
    `UPDATE recording_sessions SET paymentStatus = 'Paid', dateUpdated = ? WHERE sessionId = ?`,
    [now, game.sessionId]
  );

  return { ok: true, paymentId, sessionId: game.sessionId, amount: Number(amount) };
};

/** CR-015: may the player watch and download this game's videos? */
export const gameUnlocked = (row) => row.paymentStatus !== "Unpaid";
