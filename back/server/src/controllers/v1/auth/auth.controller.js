import express from "express";
import crypto from "node:crypto";
import passport from "passport";

import { sendMail } from "../../../lib/mailer/mailer.js";
import { passwordResetEmail } from "../../../lib/mailer/templates.js";
import { recordAudit } from "../../../middlewares/auditTrail.middleware.js";
import { csrfProtection, csrfTokenHandler } from "../../../middlewares/csrf.middleware.js";
import { authLimiter, passwordResetLimiter } from "../../../middlewares/rateLimiter.js";
import APIError, { ERROR_CODES } from "../../../utils/APIError.js";
import { catchAsync, validateBody } from "../../../utils/catchAsync.js";
import {
  addMinutesLocal,
  getCurrentTimestampLocal,
  toTimestampLocal,
} from "../../../utils/dateUtils.js";
import { signUploadUrl } from "../../../utils/file/signedUrl.js";
import { canAccessUpload } from "../../../utils/file/uploads.js";
import {
  compareDummyPassword,
  comparePassword,
  hashPassword,
} from "../../../utils/hashing/argonHash.js";
import { generateTokenPair, verifyRefreshToken } from "../../../utils/jwt.js";
import {
  clearFailedLogins,
  isLocked,
  LOCKOUT,
  recordFailedLogin,
} from "../../../utils/loginLockout.js";
import { passwordProblem } from "../../../utils/passwordPolicy.js";
import { legacySanitizedPassword } from "../../../utils/security.js";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  refreshTokenSchema,
  resetPasswordSchema,
  updateProfileSchema,
} from "../../../validators/auth.validator.js";

const router = express.Router();

// How long a password-reset link is valid (minutes)
const RESET_TOKEN_TTL_MIN = 30;

// The public origin used to build links in emails (falls back to the first
// FRONTEND_URL entry, then localhost).
const appUrl = () =>
  (process.env.APP_URL || process.env.FRONTEND_URL || "http://localhost:4020")
    .split(",")[0]
    .trim()
    .replace(/\/$/, "");

// The `/me` routes need a valid JWT (but are reachable during a pending
// forced password change, so the account can change it)
const requireAuth = passport.authenticate("jwt", { session: false });

/**
 * Write one row to the audit trail under module "auth". Most auth routes run
 * before there is a req.user, so the actor is passed in.
 */
const auditAuth = (req, action, accountId, description, metadata) =>
  recordAudit(req, { action, module: "auth", description, metadata, actor: { accountId } });

/**
 * Check a password against the account's stored hash.
 *
 * Older versions passed passwords through the HTML sanitizer before hashing,
 * so a password containing &, < > or repeated spaces was stored in an altered
 * form. If the real password does not match, that altered form is tried once;
 * on a match the hash is replaced with one of the real password, so each
 * account needs this only one time.
 */
const verifyPassword = async (db, password, credential) => {
  if (await comparePassword(password, credential.password)) return true;

  const legacy = legacySanitizedPassword(password);
  if (legacy === null || !(await comparePassword(legacy, credential.password))) return false;

  await db.query(`UPDATE credentials SET password = ? WHERE accountId = ?`, [
    await hashPassword(password),
    credential.accountId,
  ]);
  return true;
};

/**
 * Start a session: sign a token pair and record its refresh token so it can be
 * rotated and revoked. Stored in Manila local (toTimestampLocal converts the
 * JWT's UTC exp).
 * @returns {Object} the `data` fields every session response carries
 */
const issueSession = async (db, credential) => {
  const { accessToken, refreshToken } = generateTokenPair({
    userId: credential.accountId,
    accountId: credential.accountId,
    email: credential.email,
    type: credential.type,
  });

  const now = getCurrentTimestampLocal();
  await db.query(
    `INSERT INTO refresh_tokens (jti, accountId, expiresAt, dateCreated, dateUpdated)
     VALUES (?, ?, ?, ?, ?)`,
    [refreshToken.jti, credential.accountId, toTimestampLocal(refreshToken.expiresAt), now, now]
  );

  return {
    token: accessToken.token,
    accessToken: {
      token: accessToken.token,
      expiresAt: accessToken.expiresAt,
      expiresIn: accessToken.expiresIn,
    },
    refreshToken: {
      token: refreshToken.token,
      expiresAt: refreshToken.expiresAt,
      expiresIn: refreshToken.expiresIn,
    },
  };
};

/**
 * GET /csrf-token
 * Get CSRF token for authentication requests
 *
 * Returns a CSRF token that must be included in POST requests (login, refresh, logout)
 * via the X-CSRF-Token header.
 *
 * Security features:
 * - Rate limiting (auth limiter)
 * - Token is valid for 1 hour (configured in csrf middleware)
 */
router.get("/csrf-token", authLimiter, csrfTokenHandler);

/**
 * POST /login
 * Authenticate user and return access + refresh tokens
 *
 * Security features:
 * - Rate limiting per IP (10 attempts per 15 minutes)
 * - Lockout per account (utils/loginLockout.js)
 * - CSRF protection
 * - Argon2id password hashing
 * - Constant-time comparison to prevent timing attacks
 * - Sign-in, failed sign-in and lockout are written to the audit trail
 */
router.post(
  "/login",
  authLimiter,
  csrfProtection,
  validateBody(loginSchema),
  catchAsync(async (req, res) => {
    const { email, password } = req.body;

    // 1. Find credentials by email
    const credentials = await req.db.query(
      `SELECT
        c.accountId,
        c.email,
        c.password,
        c.type,
        c.status as credentialStatus,
        c.mustChangePassword,
        c.failedLoginAttempts,
        c.lockedUntil
      FROM credentials c
      WHERE c.email = ? AND c.status != 'Deleted'
      LIMIT 1`,
      [email]
    );

    // 2. Check if user exists (use constant-time behavior to prevent enumeration)
    if (credentials.length === 0) {
      // Perform a dummy hash comparison to prevent timing attacks
      await compareDummyPassword(password);

      throw new APIError("Invalid email or password", 401, ERROR_CODES.INVALID_CREDENTIALS);
    }

    const credential = credentials[0];

    // 3. Check if credential is active
    if (credential.credentialStatus !== "Active") {
      throw new APIError(
        "Account has been deactivated. Please contact service provider.",
        401,
        ERROR_CODES.INVALID_CREDENTIALS
      );
    }

    // 3b. Too many wrong passwords recently — refuse without checking this one
    const lockedMessage =
      `Too many failed sign-in attempts. Try again in ${LOCKOUT.lockMinutes} minutes, ` +
      "or reset your password.";
    if (isLocked(credential)) {
      throw new APIError(lockedMessage, 423, ERROR_CODES.ACCOUNT_LOCKED);
    }

    // 4. Verify password using Argon2 (salt is embedded in the encoded hash)
    const isPasswordValid = await verifyPassword(req.db, password, credential);

    if (!isPasswordValid) {
      const nowLocked = await recordFailedLogin(req.db, credential);
      await auditAuth(
        req,
        nowLocked ? "ACCOUNT_LOCKED" : "LOGIN_FAILED",
        credential.accountId,
        nowLocked
          ? `Sign-in locked for ${LOCKOUT.lockMinutes} minutes after ${LOCKOUT.maxAttempts} wrong passwords`
          : "Wrong password"
      );

      if (nowLocked) {
        throw new APIError(lockedMessage, 423, ERROR_CODES.ACCOUNT_LOCKED);
      }
      throw new APIError("Invalid email or password", 401, ERROR_CODES.INVALID_CREDENTIALS);
    }

    // 5. Get the user's profile
    const userRows = await req.db.query(
      `SELECT u.accountId, u.firstName, u.lastName, u.roleId, u.status, r.roleName
       FROM users u
       LEFT JOIN roles r ON r.roleId = u.roleId
       WHERE u.accountId = ? AND u.status = 'Active'
       LIMIT 1`,
      [credential.accountId]
    );
    if (userRows.length === 0) {
      throw new APIError("Account not found or deactivated", 401, ERROR_CODES.INVALID_CREDENTIALS);
    }
    const user = { ...userRows[0], email: credential.email, type: credential.type };

    // The client sends the user straight to the change-password form when
    // this is true; until then the API refuses everything but the auth routes
    user.mustChangePassword = Boolean(credential.mustChangePassword);

    // 6. The password was right — forget earlier wrong attempts
    await clearFailedLogins(req.db, credential);

    // 7. Generate the token pair and persist its refresh token
    const session = await issueSession(req.db, credential);

    // 8. Record the sign-in
    await auditAuth(req, "LOGIN", user.accountId, "Signed in");
    req.logger?.info("User logged in successfully", {
      accountId: credential.accountId,
      email: credential.email,
    });

    // 9. Return tokens
    return res.sendSuccess("Login successful", { user, ...session }, 200);
  })
);

/**
 * POST /refresh
 * Refresh access token using refresh token
 *
 * Security features:
 * - Rate limiting
 * - CSRF protection
 * - Refresh token rotation: the presented token must exist server-side and is
 *   revoked in the same transaction that records its replacement
 * - Reuse detection: presenting an already-revoked token revokes ALL of the
 *   account's refresh tokens (assume the token was stolen)
 */
router.post(
  "/refresh",
  authLimiter,
  csrfProtection,
  validateBody(refreshTokenSchema),
  catchAsync(async (req, res) => {
    const { refreshToken } = req.body;

    // 1. Verify refresh token signature/expiry
    let decoded;
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch {
      throw new APIError("Invalid or expired refresh token", 401, ERROR_CODES.TOKEN_INVALID);
    }

    const now = getCurrentTimestampLocal();
    let conn;
    let tokens;
    try {
      conn = await req.db.beginTransaction();

      // 2. The token must exist server-side — lock the row for rotation
      const [rows] = await conn.execute(
        `SELECT jti, accountId, expiresAt, revokedAt
         FROM refresh_tokens
         WHERE jti = ?
         LIMIT 1 FOR UPDATE`,
        [decoded.jti]
      );

      if (rows.length === 0) {
        await req.db.rollback(conn);
        throw new APIError("Invalid or expired refresh token", 401, ERROR_CODES.TOKEN_INVALID);
      }

      const stored = rows[0];

      // 3. Reuse detection: a revoked token being presented again means the
      //    token was leaked — kill every active session for this account.
      if (stored.revokedAt) {
        await conn.execute(
          `UPDATE refresh_tokens
           SET revokedAt = ?, dateUpdated = ?
           WHERE accountId = ? AND revokedAt IS NULL`,
          [now, now, stored.accountId]
        );
        await req.db.commit(conn);
        req.logger?.warn("Refresh token reuse detected — all sessions revoked", {
          accountId: stored.accountId,
          jti: decoded.jti,
        });
        await auditAuth(
          req,
          "TOKEN_REUSE",
          stored.accountId,
          "A revoked refresh token was presented — all sessions ended"
        );
        throw new APIError("Invalid or expired refresh token", 401, ERROR_CODES.TOKEN_INVALID);
      }

      // 4. Server-side expiry check. Both are Manila "YYYY-MM-DD HH:mm:ss"
      //    strings (dateStrings pool), so a lexicographic compare is chronological.
      if (stored.expiresAt <= now) {
        await req.db.rollback(conn);
        throw new APIError("Invalid or expired refresh token", 401, ERROR_CODES.TOKEN_INVALID);
      }

      // 5. Verify the account and its user row still exist and are active
      const [credentials] = await conn.execute(
        `SELECT c.accountId, c.email, c.type, c.status
         FROM credentials c
         INNER JOIN users u ON u.accountId = c.accountId
         WHERE c.accountId = ? AND c.status = 'Active' AND u.status = 'Active'
         LIMIT 1`,
        [decoded.accountId]
      );

      if (credentials.length === 0) {
        await req.db.rollback(conn);
        throw new APIError("Account not found or deactivated", 401, ERROR_CODES.TOKEN_INVALID);
      }

      const credential = credentials[0];

      // 6. Generate the new pair, revoke the old token, record the new one
      tokens = generateTokenPair({
        userId: credential.accountId,
        accountId: credential.accountId,
        email: credential.email,
        type: credential.type,
      });

      await conn.execute(
        `UPDATE refresh_tokens
         SET revokedAt = ?, replacedByJti = ?, dateUpdated = ?
         WHERE jti = ?`,
        [now, tokens.refreshToken.jti, now, decoded.jti]
      );

      await conn.execute(
        `INSERT INTO refresh_tokens (jti, accountId, expiresAt, dateCreated, dateUpdated)
         VALUES (?, ?, ?, ?, ?)`,
        [
          tokens.refreshToken.jti,
          credential.accountId,
          toTimestampLocal(tokens.refreshToken.expiresAt),
          now,
          now,
        ]
      );

      await req.db.commit(conn);
    } catch (err) {
      // Every APIError above is thrown after an explicit rollback/commit, so
      // only unexpected errors leave the transaction open.
      if (conn && !(err instanceof APIError)) {
        await req.db.rollback(conn);
      }
      throw err;
    }

    const { accessToken, refreshToken: newRefreshToken } = tokens;

    // 7. Return new tokens
    return res.sendSuccess(
      "Token refreshed successfully",
      {
        token: accessToken.token,
        accessToken: {
          token: accessToken.token,
          expiresAt: accessToken.expiresAt,
          expiresIn: accessToken.expiresIn,
        },
        refreshToken: {
          token: newRefreshToken.token,
          expiresAt: newRefreshToken.expiresAt,
          expiresIn: newRefreshToken.expiresIn,
        },
      },
      200
    );
  })
);

/**
 * POST /logout
 * Invalidate refresh token
 *
 * Security features:
 * - CSRF protection
 * - Server-side refresh-token revocation (the presented token's jti is
 *   marked revoked, so it can never be used to mint new access tokens)
 *
 * Revocation is best-effort: logout always succeeds even if the token is
 * already expired/invalid — the client discards its copy either way.
 */
router.post(
  "/logout",
  csrfProtection,
  validateBody(logoutSchema),
  catchAsync(async (req, res) => {
    const { refreshToken } = req.body;

    if (refreshToken) {
      try {
        const decoded = verifyRefreshToken(refreshToken);
        const now = getCurrentTimestampLocal();
        await req.db.query(
          `UPDATE refresh_tokens
           SET revokedAt = ?, dateUpdated = ?
           WHERE jti = ? AND revokedAt IS NULL`,
          [now, now, decoded.jti]
        );
        req.logger?.info("User logged out — refresh token revoked", {
          accountId: decoded.accountId,
        });
        await auditAuth(req, "LOGOUT", decoded.accountId, "Signed out");
      } catch {
        // Expired/invalid token — nothing to revoke
        req.logger?.info("User logged out (token already invalid)");
      }
    } else {
      req.logger?.info("User logged out (no refresh token provided)");
    }

    return res.sendSuccess("Logout successful", null, 200);
  })
);

/**
 * POST /forgot-password
 * Start a password reset. Always returns 200 (no account enumeration).
 */
router.post(
  "/forgot-password",
  passwordResetLimiter,
  csrfProtection,
  validateBody(forgotPasswordSchema),
  catchAsync(async (req, res) => {
    const { email } = req.body;
    const genericOk = () =>
      res.sendSuccess(
        "If an account exists for that email, a password reset link has been sent.",
        null,
        200
      );

    const credentials = await req.db.query(
      `SELECT c.accountId, u.firstName
       FROM credentials c
       LEFT JOIN users u ON u.accountId = c.accountId
       WHERE c.email = ? AND c.status = 'Active'
       LIMIT 1`,
      [email]
    );

    if (credentials.length === 0) {
      return genericOk(); // don't reveal whether the email exists
    }

    const { accountId, firstName } = credentials[0];

    // Single-use token: store only its SHA-256 hash; email the plaintext
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const now = getCurrentTimestampLocal();

    // Invalidate any earlier unused tokens for this account, then insert
    await req.db.query(
      `UPDATE password_reset_tokens SET usedAt = ? WHERE accountId = ? AND usedAt IS NULL`,
      [now, accountId]
    );
    await req.db.query(
      `INSERT INTO password_reset_tokens (tokenHash, accountId, expiresAt, dateCreated)
       VALUES (?, ?, ?, ?)`,
      [tokenHash, accountId, addMinutesLocal(RESET_TOKEN_TTL_MIN), now]
    );

    const resetUrl = `${appUrl()}/admin/reset-password?token=${token}`;
    const mail = passwordResetEmail({
      name: firstName,
      resetUrl,
      expiresMinutes: RESET_TOKEN_TTL_MIN,
    });
    // Best-effort: a mail failure must not turn this into an enumeration signal
    await sendMail({ to: email, subject: mail.subject, html: mail.html });

    req.logger?.info("Password reset requested", { accountId });
    await auditAuth(req, "PASSWORD_RESET_REQUEST", accountId, "Password reset link requested");
    return genericOk();
  })
);

/**
 * POST /reset-password
 * Complete a password reset with a valid, unused, unexpired token.
 */
router.post(
  "/reset-password",
  passwordResetLimiter,
  csrfProtection,
  validateBody(resetPasswordSchema),
  catchAsync(async (req, res) => {
    const { token, password } = req.body;
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const now = getCurrentTimestampLocal();

    let conn;
    let resetAccountId;
    try {
      conn = await req.db.beginTransaction();

      const [rows] = await conn.execute(
        `SELECT id, accountId, expiresAt, usedAt
         FROM password_reset_tokens
         WHERE tokenHash = ?
         LIMIT 1 FOR UPDATE`,
        [tokenHash]
      );

      if (
        rows.length === 0 ||
        rows[0].usedAt ||
        rows[0].expiresAt <= now // Manila strings compare chronologically
      ) {
        await req.db.rollback(conn);
        throw new APIError(
          "This password reset link is invalid or has expired.",
          400,
          ERROR_CODES.TOKEN_INVALID
        );
      }

      const { id, accountId } = rows[0];
      resetAccountId = accountId;

      // The token stays unused if the new password is refused, so the same
      // link can be submitted again with a better one
      const [accounts] = await conn.execute(
        `SELECT email FROM credentials WHERE accountId = ? LIMIT 1`,
        [accountId]
      );
      const problem = passwordProblem(password, { email: accounts[0]?.email });
      if (problem) {
        await req.db.rollback(conn);
        throw new APIError(problem, 400, ERROR_CODES.VALIDATION_FAILED);
      }

      const hash = await hashPassword(password);

      // A reset is the holder choosing a password, so it also clears a pending
      // forced change and any sign-in lock
      await conn.execute(
        `UPDATE credentials
         SET password = ?, mustChangePassword = 0, failedLoginAttempts = 0, lockedUntil = NULL,
             dateUpdated = ?
         WHERE accountId = ?`,
        [hash, now, accountId]
      );
      await conn.execute(`UPDATE password_reset_tokens SET usedAt = ? WHERE id = ?`, [now, id]);
      // Invalidate every existing session for this account
      await conn.execute(
        `UPDATE refresh_tokens SET revokedAt = ?, dateUpdated = ?
         WHERE accountId = ? AND revokedAt IS NULL`,
        [now, now, accountId]
      );

      await req.db.commit(conn);
    } catch (err) {
      if (conn && !(err instanceof APIError)) {
        await req.db.rollback(conn);
      }
      throw err;
    }

    await auditAuth(
      req,
      "PASSWORD_RESET",
      resetAccountId,
      "Password reset with an emailed link — all sessions ended"
    );

    return res.sendSuccess("Your password has been reset. You can now log in.", null, 200);
  })
);

/**
 * GET /me — the authenticated user's profile
 */
router.get(
  "/me",
  requireAuth,
  catchAsync(async (req, res) => {
    return res.sendSuccess("User profile", { user: req.user });
  })
);

/**
 * PUT /me — update the authenticated user's own profile
 */
router.put(
  "/me",
  requireAuth,
  csrfProtection,
  validateBody(updateProfileSchema),
  catchAsync(async (req, res) => {
    const { accountId } = req.user;
    const { firstName, lastName, phone, imageUrl } = req.body;
    const now = getCurrentTimestampLocal();

    // The saved path comes back as a signed link, so it must be the caller's
    // own upload — otherwise this would hand out a link to someone else's file
    if (imageUrl && !canAccessUpload(req.user, imageUrl)) {
      throw new APIError("Invalid profile image", 400, ERROR_CODES.VALIDATION_FAILED);
    }

    await req.db.query(
      `UPDATE users
       SET firstName = ?, lastName = ?, phone = ?, imageUrl = ?, dateUpdated = ?
       WHERE accountId = ? AND status != 'Deleted'`,
      [firstName, lastName, phone || null, imageUrl || null, now, accountId]
    );

    await recordAudit(req, {
      action: "PROFILE_UPDATE",
      module: "auth",
      description: "Updated own profile",
      metadata: { body: { firstName, lastName, phone: phone || null } },
    });

    return res.sendSuccess("Profile updated successfully", {
      user: {
        ...req.user,
        firstName,
        lastName,
        phone: phone || null,
        imageUrl: signUploadUrl(imageUrl || null),
      },
    });
  })
);

/**
 * PUT /me/password — change the authenticated user's own password
 *
 * Ends every session of the account, then starts a new one for this device and
 * returns its tokens — the caller stays signed in, everything else is signed out.
 */
router.put(
  "/me/password",
  requireAuth,
  csrfProtection,
  validateBody(changePasswordSchema),
  catchAsync(async (req, res) => {
    const { accountId, email } = req.user;
    const { currentPassword, newPassword } = req.body;
    const now = getCurrentTimestampLocal();

    const creds = await req.db.query(
      `SELECT accountId, email, type, password FROM credentials
       WHERE accountId = ? AND status = 'Active' LIMIT 1`,
      [accountId]
    );
    if (creds.length === 0) {
      throw new APIError("Account not found", 404, ERROR_CODES.USER_NOT_FOUND);
    }

    const valid = await verifyPassword(req.db, currentPassword, creds[0]);
    if (!valid) {
      throw new APIError("Current password is incorrect", 401, ERROR_CODES.INVALID_CREDENTIALS);
    }

    // Re-entering the same password is not a change — and must not be a way
    // around a forced change
    if (newPassword === currentPassword) {
      throw new APIError(
        "New password must be different from the current password",
        400,
        ERROR_CODES.VALIDATION_FAILED
      );
    }

    const problem = passwordProblem(newPassword, { email });
    if (problem) {
      throw new APIError(problem, 400, ERROR_CODES.VALIDATION_FAILED);
    }

    const hash = await hashPassword(newPassword);
    await req.db.query(
      `UPDATE credentials
       SET password = ?, mustChangePassword = 0, failedLoginAttempts = 0, lockedUntil = NULL,
           dateUpdated = ?
       WHERE accountId = ?`,
      [hash, now, accountId]
    );
    // End every session of this account, on every device...
    await req.db.query(
      `UPDATE refresh_tokens SET revokedAt = ?, dateUpdated = ?
       WHERE accountId = ? AND revokedAt IS NULL`,
      [now, now, accountId]
    );
    // ...then start a fresh one for the device that made the change
    const session = await issueSession(req.db, creds[0]);

    await recordAudit(req, {
      action: "PASSWORD_CHANGE",
      module: "auth",
      description: "Changed own password — all other sessions ended",
    });

    return res.sendSuccess("Password changed successfully", session, 200);
  })
);

export default router;
