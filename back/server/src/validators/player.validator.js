import { z } from "zod";
import { optionalPhone, optionalString, queryInt } from "./_helpers.js";

/** PLAN-006: validators for player sign-in (controllers/v1/auth/google, controllers/v1/player). */

// GET /auth/google/start?return=<player page> — checked again by safeReturnPath()
export const googleStartQuerySchema = z.object({
  return: z.string().max(300).optional(),
});

// POST /player/session — the single-use code from the sign-in redirect (randomToken(32))
export const playerSessionSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/, "This sign-in link isn't valid"),
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
