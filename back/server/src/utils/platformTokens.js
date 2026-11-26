import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import APIError, { ERROR_CODES } from "./APIError.js";
import { getPrivateKey, getPublicKey, JWT_AUDIENCE, JWT_ISSUER } from "./jwt.js";

/**
 * PLAN-008 phase B: back-office (super admin) session tokens — the same signing keys
 * as staff tokens, but their own audience, so a back-office token is refused by the
 * staff passport check (audience JWT_AUDIENCE) and a staff or player token is refused
 * here. Sent as `Authorization: Bearer <token>` to /api/v1/backoffice/*
 * (middlewares/platformAuth.middleware.js).
 *
 *   access   15 min                   { sub: platformAdminId, typ: "platform", type: "access" }
 *   refresh  7 days, rotated on use   { sub: platformAdminId, typ: "platform", type: "refresh", jti }
 */

export const PLATFORM_AUDIENCE = `${JWT_AUDIENCE}-backoffice`;
const ALGORITHM = "RS256";
const ACCESS_EXPIRES_IN = process.env.PLATFORM_ACCESS_EXPIRES_IN || "15m";
const REFRESH_EXPIRES_IN = process.env.PLATFORM_REFRESH_EXPIRES_IN || "7d";

const sign = (platformAdminId, type, expiresIn) => {
  const jti = crypto.randomBytes(32).toString("hex");
  const token = jwt.sign({ sub: platformAdminId, typ: "platform", type, jti }, getPrivateKey(), {
    algorithm: ALGORITHM,
    expiresIn,
    issuer: JWT_ISSUER,
    audience: PLATFORM_AUDIENCE,
  });
  const expiresAt = new Date(jwt.decode(token).exp * 1000);
  return { token, jti, expiresAt, expiresIn };
};

/** A new access + refresh pair for a super admin. */
export const platformTokenPair = (platformAdminId) => ({
  accessToken: sign(platformAdminId, "access", ACCESS_EXPIRES_IN),
  refreshToken: sign(platformAdminId, "refresh", REFRESH_EXPIRES_IN),
});

/**
 * @param {string} token
 * @param {"access"|"refresh"} type
 * @returns {{ sub: string, jti: string }}
 * @throws {APIError} 401 TOKEN_EXPIRED / TOKEN_INVALID
 */
export const verifyPlatformToken = (token, type) => {
  let decoded;
  try {
    decoded = jwt.verify(token, getPublicKey(), {
      algorithms: [ALGORITHM],
      issuer: JWT_ISSUER,
      audience: PLATFORM_AUDIENCE,
    });
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      throw new APIError("Your sign-in has expired", 401, ERROR_CODES.TOKEN_EXPIRED);
    }
    throw new APIError("Sign in again", 401, ERROR_CODES.TOKEN_INVALID);
  }
  if (decoded.typ !== "platform" || decoded.type !== type || !decoded.sub) {
    throw new APIError("Sign in again", 401, ERROR_CODES.TOKEN_INVALID);
  }
  return decoded;
};
