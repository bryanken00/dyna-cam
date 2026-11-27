import { z } from "zod";
import { emptyToUndefined, optionalPhone, optionalString, queryInt } from "./_helpers.js";
import { SKILL_LEVELS, SPORTS } from "../utils/venueFacts.js";

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

// PLAN-009 phase B: PUT /player/sports — one sport's answers; omitted / "" = not said
export const playerSportSchema = z.object({
  sport: z.enum(SPORTS),
  skillLevel: emptyToUndefined(z.enum(SKILL_LEVELS).optional()),
  // A DUPR ID is letters and digits (e.g. "ABC12D")
  duprId: emptyToUndefined(
    z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,20}$/, "Enter your DUPR ID as it shows in the DUPR app").optional()
  ),
  // DUPR ratings run 2.000–8.000, three decimals
  duprRating: emptyToUndefined(
    z.coerce
      .number({ invalid_type_error: "Enter your rating as a number, like 3.512" })
      .min(2, "DUPR ratings start at 2.000")
      .max(8, "DUPR ratings go up to 8.000")
      .transform((v) => Math.round(v * 1000) / 1000)
      .optional()
  ),
});

// PLAN-009 phase B: /player/follows/:venueKey — a venue's public key (utils/venueFacts.js)
export const venueKeyParamsSchema = z.object({
  venueKey: z.string().regex(/^[0-9a-f]{16}$/, "Venue not found"),
});
