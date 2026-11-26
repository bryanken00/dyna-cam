import { z } from "zod";
import { optionalPhone, optionalString, queryInt } from "./_helpers.js";

/** PLAN-006: validators for player sign-in (controllers/v1/auth/google, controllers/v1/player). */

// GET /auth/google/start?return=<player page> — checked again by safeReturnPath()
export const googleStartQuerySchema = z
  .object({
    return: z.string().max(300).optional(),
    // PLAN-009: the mobile app — back to dgsports://signed-in, with a PKCE-style challenge
    app: z.enum(["1"]).optional(),
    challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Invalid challenge").optional(),
  })
  .refine((q) => !q.app || q.challenge, { message: "The app sends a challenge", path: ["challenge"] });

// POST /player/session — the single-use code from the sign-in redirect (randomToken(32))
export const playerSessionSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/, "This sign-in link isn't valid"),
  // PLAN-009: the mobile app's secret for a code it started (RFC 7636 verifier characters)
  verifier: z
    .string()
    .regex(/^[A-Za-z0-9._~-]{43,128}$/, "This sign-in link isn't valid")
    .optional(),
});

// POST /player/session/refresh, /player/session/logout
export const playerRefreshSchema = z.object({
  refreshToken: z.string().min(20).max(2048),
});

// GET /player/games?page=&limit=
export const playerGamesQuerySchema = z.object({
  page: queryInt(1, { min: 1, max: 1000 }),
  limit: queryInt(10, { min: 1, max: 50 }),
});

// PATCH /player/me — the player's profile: first sign-in (pre-filled from Google) or later edits
const namePart = (label) =>
  z.string().trim().min(1, `Enter your ${label}`).max(50, `Keep your ${label} under 50 characters`);
export const playerProfileSchema = z.object({
  firstName: namePart("first name"),
  middleName: optionalString(50),
  lastName: namePart("last name"),
  phone: optionalPhone(),
});
