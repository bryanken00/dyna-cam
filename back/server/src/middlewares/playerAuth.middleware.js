import APIError, { ERROR_CODES } from "../utils/APIError.js";
import { verifyPlayerToken } from "../utils/playerTokens.js";

/**
 * PLAN-006: a player signed in with Google, for /api/v1/player/* and booking
 * online. The player pages send `Authorization: Player <access token>`
 * (utils/playerTokens.js — its own audience, so a staff token never passes
 * here and a player token never passes the staff check).
 *
 * `req.player` = the Active player's row (names, email, photo, phone, profileCompletedAt).
 *
 *   no token                 401 PLAYER_SIGN_IN_REQUIRED
 *   expired                  401 TOKEN_EXPIRED   (the page refreshes and tries again)
 *   bad, Blocked or Deleted  401 TOKEN_INVALID   (the page signs out)
 */
const refuse = (res, err) =>
  res.status(err.status || 401).json({ success: false, message: err.message, code: err.code });

export const requirePlayer = async (req, res, next) => {
  try {
    const [scheme, token] = (req.get("authorization") || "").split(" ");
    if (scheme !== "Player" || !token) {
      return refuse(
        res,
        new APIError("Sign in with Google to continue", 401, ERROR_CODES.PLAYER_SIGN_IN_REQUIRED)
      );
    }

    let decoded;
    try {
      decoded = verifyPlayerToken(token, "access");
    } catch (err) {
      if (err instanceof APIError) return refuse(res, err);
      throw err;
    }

    const rows = await req.db.query(
      `SELECT playerId, email, firstName, middleName, lastName, name, photoUrl, phone,
              profileCompletedAt
       FROM players
       WHERE playerId = ? AND status = 'Active'
       LIMIT 1`,
      [decoded.sub]
    );
    if (rows.length === 0) {
      return refuse(res, new APIError("Sign in again", 401, ERROR_CODES.TOKEN_INVALID));
    }
    req.player = rows[0];
    next();
  } catch (err) {
    next(err);
  }
};

export default requirePlayer;
