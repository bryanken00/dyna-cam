import crypto from "node:crypto";
import { getCurrentTimestampLocal, moment } from "./dateUtils.js";

/**
 * 6-digit pairing keys (PLAN-002). A key is short, single-use and expires in
 * PAIRING_CODE_TTL_MINUTES; only a keyed hash is stored, so a database dump
 * doesn't hand out live keys. Redeeming one creates the paired phone / recorder
 * box and hands it a long-lived token once.
 *
 * Guessing is limited by the pairing routes (per-IP limits + a global cap on
 * failed attempts) — see controllers/v1/pairing/pairing.controller.js.
 */

export const PAIRING_CODE_TTL_MINUTES = 10;

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";

// Keyed with the same secret that protects camera URLs (never a known value in
// production — see utils/crypto/secretBox.js)
const hmacKey = crypto
  .createHash("sha256")
  .update(`pairing:${process.env.DEVICE_SECRET_KEY || process.env.DB_DATABASE || ""}`)
  .digest();

/** A fresh 6-digit key, e.g. "048213". */
export const newPairingCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");

/** The stored form of a key (digits only; spaces/dashes the user typed are dropped). */
export const hashPairingCode = (code) =>
  crypto.createHmac("sha256", hmacKey).update(String(code).replace(/\D/g, "")).digest("hex");

/**
 * Create a pairing key inside the caller's transaction. Never two Active,
 * unexpired keys with the same digits.
 * @returns {Promise<{ pairingCodeId: string, code: string, expiresAt: string }>}
 */
export const createPairingCode = async (conn, { kind, venueId, name, accountId }) => {
  const now = getCurrentTimestampLocal();
  const expiresAt = moment()
    .tz(TIMEZONE)
    .add(PAIRING_CODE_TTL_MINUTES, "minutes")
    .format("YYYY-MM-DD HH:mm:ss");

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = newPairingCode();
    const codeHash = hashPairingCode(code);
    const [clash] = await conn.execute(
      `SELECT id FROM pairing_codes
       WHERE codeHash = ? AND status = 'Active' AND expiresAt > ?
       LIMIT 1 FOR UPDATE`,
      [codeHash, now]
    );
    if (clash.length > 0) continue;

    const [uuidRow] = await conn.execute(`SELECT UUID() as id`);
    const pairingCodeId = uuidRow[0].id;
    await conn.execute(
      `INSERT INTO pairing_codes
         (pairingCodeId, kind, venueId, name, codeHash, expiresAt, createdByAccountId, status,
          dateCreated, dateUpdated)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?)`,
      [pairingCodeId, kind, venueId, name, codeHash, expiresAt, accountId || null, now, now]
    );
    return { pairingCodeId, code, expiresAt };
  }
  throw new Error("Could not create a unique pairing key");
};

/**
 * Find a live key of this kind and lock it (inside the caller's transaction).
 * @returns {Promise<Object|null>} the pairing_codes row, or null
 */
export const findLivePairingCode = async (conn, { code, kind }) => {
  const [rows] = await conn.execute(
    `SELECT pc.pairingCodeId, pc.venueId, pc.name, v.name AS venueName
     FROM pairing_codes pc
     JOIN venues v ON v.venueId = pc.venueId AND v.status != 'Deleted'
     WHERE pc.codeHash = ? AND pc.kind = ? AND pc.status = 'Active' AND pc.expiresAt > ?
     LIMIT 1 FOR UPDATE`,
    [hashPairingCode(code), kind, getCurrentTimestampLocal()]
  );
  return rows[0] || null;
};

/** Mark a key used by the phone / box it created (single use). */
export const markPairingCodeUsed = async (conn, pairingCodeId, resultId) => {
  const now = getCurrentTimestampLocal();
  await conn.execute(
    `UPDATE pairing_codes SET status = 'Used', usedAt = ?, resultId = ?, dateUpdated = ?
     WHERE pairingCodeId = ?`,
    [now, resultId, now, pairingCodeId]
  );
};
