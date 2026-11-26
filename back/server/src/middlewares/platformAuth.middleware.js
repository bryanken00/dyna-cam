import APIError, { ERROR_CODES } from "../utils/APIError.js";
import { verifyPlatformToken } from "../utils/platformTokens.js";

/**
 * PLAN-008 phase B: a signed-in super admin, for /api/v1/backoffice/*. The back
 * office sends `Authorization: Bearer <access token>` from utils/platformTokens.js —
 * its own audience, so a staff or player token never passes here and this token
 * never passes the staff passport check.
 *
 * `req.platformAdmin` = { platformAdminId, firstName, lastName, email, mustChangePassword }
 *
 *   no / bad / staff token, Inactive or Deleted admin   401 TOKEN_INVALID
 *   expired                                             401 TOKEN_EXPIRED (the page refreshes)
 */
const refuse = (res, err) =>
  res.status(err.status || 401).json({ success: false, message: err.message, code: err.code });

export const requirePlatformAdmin = async (req, res, next) => {
  try {
    const [scheme, token] = (req.get("authorization") || "").split(" ");
    if (scheme !== "Bearer" || !token) {
      return refuse(res, new APIError("Sign in to the back office", 401, ERROR_CODES.TOKEN_INVALID));
    }

    let decoded;
    try {
      decoded = verifyPlatformToken(token, "access");
    } catch (err) {
      if (err instanceof APIError) return refuse(res, err);
      throw err;
    }

    const rows = await req.db.query(
      `SELECT platformAdminId, firstName, lastName, email, mustChangePassword
       FROM platform_admins
       WHERE platformAdminId = ? AND status = 'Active'
       LIMIT 1`,
      [decoded.sub]
    );
    if (rows.length === 0) {
      return refuse(res, new APIError("Sign in again", 401, ERROR_CODES.TOKEN_INVALID));
    }
    req.platformAdmin = { ...rows[0], mustChangePassword: Boolean(rows[0].mustChangePassword) };
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * After requirePlatformAdmin: a super admin with a temporary password (the seeded
 * one, or one reset) may only use the auth routes until they choose their own.
 */
export const requirePlatformPasswordChanged = (req, res, next) => {
  if (req.platformAdmin?.mustChangePassword) {
    return res.status(403).json({
      success: false,
      message: "You must change your password before continuing",
      code: ERROR_CODES.PASSWORD_CHANGE_REQUIRED,
    });
  }
  next();
};

export default requirePlatformAdmin;
