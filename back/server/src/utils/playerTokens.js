import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import APIError, { ERROR_CODES } from "./APIError.js";
import { getPrivateKey, getPublicKey, JWT_AUDIENCE, JWT_ISSUER } from "./jwt.js";

/**
 * PLAN-006: player session tokens — same signing keys as staff tokens, but their
 * own audience, so a player token is refused by the staff passport check
 * (audience AUDIENCE) and a staff token is refused here. The player app sends
 * them as `Authorization: Player <token>` (middlewares/playerAuth.middleware.js).
 *
 *   access   15 min                    { sub: playerId, typ: "player", type: "access" }
 *   refresh  30 days, rotated on use   { sub: playerId, typ: "player", type: "refresh", jti }
 */

export const PLAYER_AUDIENCE = `${JWT_AUDIENCE}-player`;
const ALGORITHM = "RS256";
const ACCESS_EXPIRES_IN = process.env.PLAYER_ACCESS_EXPIRES_IN || "15m";
const REFRESH_EXPIRES_IN = process.env.PLAYER_REFRESH_EXPIRES_IN || "30d";

const sign = (playerId, type, expiresIn) => {
  const jti = crypto.randomBytes(32).toString("hex");
  const token = jwt.sign({ sub: playerId, typ: "player", type, jti }, getPrivateKey(), {
    algorithm: ALGORITHM,
    expiresIn,
    issuer: JWT_ISSUER,
    audience: PLAYER_AUDIENCE,
  });
  const expiresAt = new Date(jwt.decode(token).exp * 1000);
  return { token, jti, expiresAt, expiresIn };
};

/** A new access + refresh pair for a player. */
export const playerTokenPair = (playerId) => ({
  accessToken: sign(playerId, "access", ACCESS_EXPIRES_IN),
  refreshToken: sign(playerId, "refresh", REFRESH_EXPIRES_IN),
});

/**
 * @param {string} token
 * @param {"access"|"refresh"} type
 * @returns {{ sub: string, jti: string }}
 * @throws {APIError} 401 TOKEN_EXPIRED / TOKEN_INVALID
 */
export const verifyPlayerToken = (token, type) => {
  let decoded;
  try {
    decoded = jwt.verify(token, getPublicKey(), {
      algorithms: [ALGORITHM],
      issuer: JWT_ISSUER,
      audience: PLAYER_AUDIENCE,
    });
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      throw new APIError("Your sign-in has expired", 401, ERROR_CODES.TOKEN_EXPIRED);
    }
    throw new APIError("Sign in again", 401, ERROR_CODES.TOKEN_INVALID);
  }
  if (decoded.typ !== "player" || decoded.type !== type || !decoded.sub) {
    throw new APIError("Sign in again", 401, ERROR_CODES.TOKEN_INVALID);
  }
  return decoded;
};

/** The reply shape for a new pair (POST /player/session, /session/refresh). */
export const sessionReply = ({ accessToken, refreshToken }) => ({
  accessToken: { token: accessToken.token, expiresAt: accessToken.expiresAt },
  refreshToken: { token: refreshToken.token, expiresAt: refreshToken.expiresAt },
});
