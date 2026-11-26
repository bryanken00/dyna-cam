import express from "express";

import { csrfProtection, csrfTokenHandler } from "../../../middlewares/csrf.middleware.js";
import { noIdempotencyCache } from "../../../middlewares/idempotency.middleware.js";
import { requirePlatformAdmin } from "../../../middlewares/platformAuth.middleware.js";
import { authLimiter } from "../../../middlewares/rateLimiter.js";
import APIError, { ERROR_CODES } from "../../../utils/APIError.js";
import { catchAsync, validateBody } from "../../../utils/catchAsync.js";
import {
  addMinutesLocal,
  getCurrentTimestampLocal,
  toTimestampLocal,
} from "../../../utils/dateUtils.js";
import {
  compareDummyPassword,
  comparePassword,
  hashPassword,
} from "../../../utils/hashing/argonHash.js";
import { LOCKOUT } from "../../../utils/loginLockout.js";
import { passwordProblem } from "../../../utils/passwordPolicy.js";
import { recordPlatformAudit } from "../../../utils/platformAudit.js";
import { platformTokenPair, verifyPlatformToken } from "../../../utils/platformTokens.js";
import {
  changePasswordSchema,
  loginSchema,
  logoutSchema,
  refreshTokenSchema,
} from "../../../validators/auth.validator.js";

/**
 * PLAN-008 phase B: the back office's sign-in — DGSports' super admins
 * (`platform_admins`), separate from staff sign-in (/api/v1/admin/auth). The same
 * rules as staff: per-IP rate limit, per-account lockout (LOCKOUT), Argon2, rotating
 * refresh tokens with reuse detection, and a temporary password that must be changed
 * before anything else (requirePlatformPasswordChanged on the other routes).
 */
const router = express.Router();

/** The admin as the back office shows it. */
const adminView = (a) => ({
  platformAdminId: a.platformAdminId,
  firstName: a.firstName,
  lastName: a.lastName,
  email: a.email,
  mustChangePassword: Boolean(a.mustChangePassword),
});

/** Sign a token pair and record its refresh token (Manila local). */
const issueSession = async (db, platformAdminId) => {
  const { accessToken, refreshToken } = platformTokenPair(platformAdminId);
  const now = getCurrentTimestampLocal();
  await db.query(
    `INSERT INTO platform_admin_refresh_tokens (jti, platformAdminId, expiresAt, dateCreated, dateUpdated)
     VALUES (?, ?, ?, ?, ?)`,
    [refreshToken.jti, platformAdminId, toTimestampLocal(refreshToken.expiresAt), now, now]
  );
  return {
    token: accessToken.token,
    accessToken: { token: accessToken.token, expiresAt: accessToken.expiresAt },
    refreshToken: { token: refreshToken.token, expiresAt: refreshToken.expiresAt },
  };
};

const isLocked = (admin) => Boolean(admin.lockedUntil) && admin.lockedUntil > getCurrentTimestampLocal();

/** One wrong password; locks on the attempt that reaches the limit (as utils/loginLockout.js). */
const recordFailedLogin = async (db, admin) => {
  const { maxAttempts, lockMinutes } = LOCKOUT;
  await db.query(
    `UPDATE platform_admins
     SET lockedUntil = IF(failedLoginAttempts + 1 >= ?, ?, lockedUntil),
         failedLoginAttempts = IF(failedLoginAttempts + 1 >= ?, 0, failedLoginAttempts + 1)
     WHERE platformAdminId = ?`,
    [maxAttempts, addMinutesLocal(lockMinutes), maxAttempts, admin.platformAdminId]
  );
  return admin.failedLoginAttempts + 1 >= maxAttempts;
};

/** GET /csrf-token — the token the back office sends on POST/PUT (as staff sign-in). */
router.get("/csrf-token", authLimiter, csrfTokenHandler);

/** POST /login — { email, password } → a session (tokens + the admin). */
router.post(
  "/login",
  authLimiter,
  csrfProtection,
  validateBody(loginSchema),
  catchAsync(async (req, res) => {
    const email = req.body.email.trim().toLowerCase();
    const rows = await req.db.query(
      `SELECT platformAdminId, firstName, lastName, email, password, status, mustChangePassword,
              failedLoginAttempts, lockedUntil
       FROM platform_admins
       WHERE email = ? AND status != 'Deleted'
       LIMIT 1`,
      [email]
    );
    if (rows.length === 0) {
      await compareDummyPassword(req.body.password);
      await recordPlatformAudit(req, {
        action: "LOGIN_FAILED",
        platformAdminId: null,
        description: "Sign-in with an unknown email",
        metadata: { email },
      });
      throw new APIError("Invalid email or password", 401, ERROR_CODES.INVALID_CREDENTIALS);
    }
    const admin = rows[0];
    if (admin.status !== "Active") {
      await recordPlatformAudit(req, {
        action: "LOGIN_FAILED",
        platformAdminId: admin.platformAdminId,
        description: "Sign-in to a deactivated account",
      });
      throw new APIError("This back-office account is deactivated", 401, ERROR_CODES.INVALID_CREDENTIALS);
    }

    const lockedMessage =
      `Too many failed sign-in attempts. Try again in ${LOCKOUT.lockMinutes} minutes.`;
    if (isLocked(admin)) {
      throw new APIError(lockedMessage, 423, ERROR_CODES.ACCOUNT_LOCKED);
    }

    if (!(await comparePassword(req.body.password, admin.password))) {
      const nowLocked = await recordFailedLogin(req.db, admin);
      await recordPlatformAudit(req, {
        action: nowLocked ? "ACCOUNT_LOCKED" : "LOGIN_FAILED",
        platformAdminId: admin.platformAdminId,
        description: nowLocked
          ? `Sign-in locked for ${LOCKOUT.lockMinutes} minutes after ${LOCKOUT.maxAttempts} wrong passwords`
          : "Wrong password",
      });
      if (nowLocked) throw new APIError(lockedMessage, 423, ERROR_CODES.ACCOUNT_LOCKED);
      throw new APIError("Invalid email or password", 401, ERROR_CODES.INVALID_CREDENTIALS);
    }

    if (admin.failedLoginAttempts || admin.lockedUntil) {
      await req.db.query(
        `UPDATE platform_admins SET failedLoginAttempts = 0, lockedUntil = NULL WHERE platformAdminId = ?`,
        [admin.platformAdminId]
      );
    }

    const session = await issueSession(req.db, admin.platformAdminId);
    await recordPlatformAudit(req, { action: "LOGIN", platformAdminId: admin.platformAdminId, description: "Signed in" });
    noIdempotencyCache(res);
    return res.sendSuccess("Signed in", { ...session, admin: adminView(admin) });
  })
);

/** POST /refresh — { refreshToken } → a new pair (rotation; a reused token ends every session). */
router.post(
  "/refresh",
  authLimiter,
  csrfProtection,
  validateBody(refreshTokenSchema),
  catchAsync(async (req, res) => {
    let decoded;
    try {
      decoded = verifyPlatformToken(req.body.refreshToken, "refresh");
    } catch {
      throw new APIError("Invalid or expired refresh token", 401, ERROR_CODES.TOKEN_INVALID);
    }

    const now = getCurrentTimestampLocal();
    let conn;
    let platformAdminId;
    try {
      conn = await req.db.beginTransaction();
      const [rows] = await conn.execute(
        `SELECT t.jti, t.platformAdminId, t.expiresAt, t.revokedAt, a.status
         FROM platform_admin_refresh_tokens t
         INNER JOIN platform_admins a ON a.platformAdminId = t.platformAdminId
         WHERE t.jti = ?
         LIMIT 1 FOR UPDATE`,
        [decoded.jti]
      );
      const stored = rows[0];
      if (!stored || stored.platformAdminId !== decoded.sub) {
        await req.db.rollback(conn);
        throw new APIError("Invalid or expired refresh token", 401, ERROR_CODES.TOKEN_INVALID);
      }
      // Reuse of a rotated token: it leaked — end every session of this admin
      if (stored.revokedAt) {
        await conn.execute(
          `UPDATE platform_admin_refresh_tokens SET revokedAt = ?, dateUpdated = ?
           WHERE platformAdminId = ? AND revokedAt IS NULL`,
          [now, now, stored.platformAdminId]
        );
        await req.db.commit(conn);
        throw new APIError("Invalid or expired refresh token", 401, ERROR_CODES.TOKEN_INVALID);
      }
      if (stored.expiresAt <= now || stored.status !== "Active") {
        await req.db.rollback(conn);
        throw new APIError("Invalid or expired refresh token", 401, ERROR_CODES.TOKEN_INVALID);
      }
      await conn.execute(
        `UPDATE platform_admin_refresh_tokens SET revokedAt = ?, dateUpdated = ? WHERE jti = ?`,
        [now, now, stored.jti]
      );
      await req.db.commit(conn);
      platformAdminId = stored.platformAdminId;
    } catch (err) {
      if (conn) await req.db.rollback(conn);
      throw err;
    }

    const session = await issueSession(req.db, platformAdminId);
    noIdempotencyCache(res);
    return res.sendSuccess("Session refreshed", session);
  })
);

/** POST /logout — { refreshToken? } → that session ends. */
router.post(
  "/logout",
  csrfProtection,
  validateBody(logoutSchema),
  catchAsync(async (req, res) => {
    const { refreshToken } = req.body;
    if (refreshToken) {
      try {
        const decoded = verifyPlatformToken(refreshToken, "refresh");
        const now = getCurrentTimestampLocal();
        await req.db.query(
          `UPDATE platform_admin_refresh_tokens SET revokedAt = ?, dateUpdated = ?
           WHERE jti = ? AND revokedAt IS NULL`,
          [now, now, decoded.jti]
        );
        await recordPlatformAudit(req, { action: "LOGOUT", platformAdminId: decoded.sub, description: "Signed out" });
      } catch {
        // An invalid or expired token is already no session
      }
    }
    return res.sendSuccess("Signed out");
  })
);

/** GET /me — the signed-in admin (works while a password change is pending). */
router.get(
  "/me",
  requirePlatformAdmin,
  catchAsync((req, res) => res.sendSuccess("Me", { admin: adminView(req.platformAdmin) }))
);

/**
 * PUT /me/password — { currentPassword, newPassword }. Ends every session, then
 * starts a new one for this device (returned).
 */
router.put(
  "/me/password",
  requirePlatformAdmin,
  csrfProtection,
  validateBody(changePasswordSchema),
  catchAsync(async (req, res) => {
    const { platformAdminId, email } = req.platformAdmin;
    const { currentPassword, newPassword } = req.body;
    const rows = await req.db.query(
      `SELECT password FROM platform_admins WHERE platformAdminId = ? AND status = 'Active' LIMIT 1`,
      [platformAdminId]
    );
    if (rows.length === 0 || !(await comparePassword(currentPassword, rows[0].password))) {
      throw new APIError("Current password is incorrect", 401, ERROR_CODES.INVALID_CREDENTIALS);
    }
    if (newPassword === currentPassword) {
      throw new APIError(
        "New password must be different from the current password",
        400,
        ERROR_CODES.VALIDATION_FAILED
      );
    }
    const problem = passwordProblem(newPassword, { email });
    if (problem) throw new APIError(problem, 400, ERROR_CODES.VALIDATION_FAILED);

    const now = getCurrentTimestampLocal();
    await req.db.query(
      `UPDATE platform_admins
       SET password = ?, mustChangePassword = 0, failedLoginAttempts = 0, lockedUntil = NULL,
           dateUpdated = ?
       WHERE platformAdminId = ?`,
      [await hashPassword(newPassword), now, platformAdminId]
    );
    await req.db.query(
      `UPDATE platform_admin_refresh_tokens SET revokedAt = ?, dateUpdated = ?
       WHERE platformAdminId = ? AND revokedAt IS NULL`,
      [now, now, platformAdminId]
    );
    const session = await issueSession(req.db, platformAdminId);
    await recordPlatformAudit(req, {
      action: "PASSWORD_CHANGE",
      description: req.platformAdmin.mustChangePassword ? "Chose a password (first sign-in)" : "Changed the password",
    });
    noIdempotencyCache(res);
    return res.sendSuccess("Password changed", {
      ...session,
      admin: adminView({ ...req.platformAdmin, mustChangePassword: false }),
    });
  })
);

export default router;
