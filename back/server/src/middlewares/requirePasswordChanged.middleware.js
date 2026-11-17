import { ERROR_CODES } from "../utils/APIError.js";

/**
 * Forced password change guard
 *
 * Must be mounted AFTER the passport JWT middleware. An account whose
 * `credentials.mustChangePassword` flag is set (a password its holder did not
 * choose, e.g. the seeded Owner) gets a 403 on every route this guards.
 * The auth routes (`/auth/me`, `/auth/me/password`, logout, refresh) are not
 * guarded, so the account can still change its password — which clears the flag.
 *
 * The route index files bundle this with the JWT check as `requireAuth`, so a
 * route group registered the usual way is covered automatically.
 */
export const requirePasswordChanged = (req, res, next) => {
  if (req.user?.mustChangePassword) {
    return res.status(403).json({
      success: false,
      message: "You must change your password before continuing",
      code: ERROR_CODES.PASSWORD_CHANGE_REQUIRED,
    });
  }

  next();
};

export default requirePasswordChanged;
