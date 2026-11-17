import { addMinutesLocal, getCurrentTimestampLocal } from "./dateUtils.js";

/**
 * Per-account login lockout
 *
 * The auth rate limiter counts attempts per IP address, so an attacker who
 * spreads guesses over many addresses is never slowed down. This counts wrong
 * passwords per ACCOUNT: after `maxAttempts` in a row, sign-in is refused for
 * `lockMinutes`, whatever address the request comes from. The lock is
 * temporary, so it cannot be used to shut a user out for good.
 *
 * State lives on the credentials row (failedLoginAttempts, lockedUntil).
 *
 * Env:
 *   LOGIN_MAX_FAILED_ATTEMPTS   wrong passwords in a row before locking (default 5)
 *   LOGIN_LOCK_MINUTES          how long the lock lasts (default 15)
 */

const positiveInt = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const LOCKOUT = {
  maxAttempts: positiveInt(process.env.LOGIN_MAX_FAILED_ATTEMPTS, 5),
  lockMinutes: positiveInt(process.env.LOGIN_LOCK_MINUTES, 15),
};

/**
 * @param {{ lockedUntil: string|null }} credential
 * @returns {boolean} true while the lock is still running
 */
export const isLocked = (credential) =>
  // Both are Manila "YYYY-MM-DD HH:mm:ss" strings, so string order is time order
  Boolean(credential.lockedUntil) && credential.lockedUntil > getCurrentTimestampLocal();

/**
 * Count one wrong password. On the attempt that reaches the limit the account
 * is locked and the counter starts again from zero.
 *
 * One statement, so two wrong guesses arriving together are both counted.
 * `lockedUntil` is assigned first on purpose: MySQL evaluates SET left to
 * right, and both expressions must see the counter's value before this update.
 * `dateUpdated` is left alone — it records profile and password changes.
 *
 * @returns {Promise<boolean>} true when this attempt locked the account
 */
export const recordFailedLogin = async (db, credential) => {
  const { maxAttempts, lockMinutes } = LOCKOUT;

  await db.query(
    `UPDATE credentials
     SET lockedUntil = IF(failedLoginAttempts + 1 >= ?, ?, lockedUntil),
         failedLoginAttempts = IF(failedLoginAttempts + 1 >= ?, 0, failedLoginAttempts + 1)
     WHERE accountId = ?`,
    [maxAttempts, addMinutesLocal(lockMinutes), maxAttempts, credential.accountId]
  );

  return credential.failedLoginAttempts + 1 >= maxAttempts;
};

/** A correct password ends the count. */
export const clearFailedLogins = (db, credential) => {
  if (!credential.failedLoginAttempts && !credential.lockedUntil) return Promise.resolve();

  return db.query(
    `UPDATE credentials SET failedLoginAttempts = 0, lockedUntil = NULL WHERE accountId = ?`,
    [credential.accountId]
  );
};
