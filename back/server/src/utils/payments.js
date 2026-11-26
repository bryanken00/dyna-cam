import { randomPayCode } from "./crypto/tokens.js";

/**
 * Pay codes and the paid/unpaid rule for clips and games. CR-046 removed
 * recording cash for them (no payment at the counter); migration 042 made the
 * last unpaid ones Free, and new games start Free (CR-039).
 */

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


/** CR-015: may the player watch and download this game's videos? */
export const gameUnlocked = (row) => row.paymentStatus !== "Unpaid";
