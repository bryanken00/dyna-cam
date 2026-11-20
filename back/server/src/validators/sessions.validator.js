import { z } from "zod";
import {
  emptyToUndefined,
  optionalPhone,
  optionalString,
  queryEnum,
  queryEnumDefault,
  queryInt,
} from "./_helpers.js";

/** A Manila local time as sent by the Admin portal: "YYYY-MM-DD HH:mm" (or :ss). */
const MINUTES = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/;
const SECONDS = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/;
const localDateTime = z
  .string()
  .trim()
  .refine(
    (value) => MINUTES.test(value) || SECONDS.test(value),
    "Use a YYYY-MM-DD HH:mm date and time"
  )
  .transform((value) => {
    const normalised = value.replace("T", " ");
    return normalised.length === 16 ? `${normalised}:00` : normalised;
  });

// POST /
// CR-016: Admin's New game sends startNow + durationMinutes (the game time) —
// it records at once and stops by itself at the end.
// CR-005: just a court (+ player) is an open game — it waits for a device,
// starts when the first one pairs, and ends only by End game / End (older
// clients). startAt + durationMinutes books ahead (PLAN-001/002).
export const createSessionSchema = z
  .object({
    courtId: z.string().min(1, "Court is required").max(50),
    startNow: z.boolean().optional(),
    startAt: emptyToUndefined(localDateTime.optional()),
    durationMinutes: emptyToUndefined(
      z.coerce
        .number()
        .int("Use whole minutes")
        .min(5, "A session is at least 5 minutes")
        .max(180, "A session is at most 3 hours")
        .optional()
    ),
    playerName: optionalString(100),
    phone: optionalPhone(),
    // CR-015: a free game — no payment at the desk, the player gets the videos at once
    free: z.boolean().optional(),
    // CR-013 revision: saves the courtside device may hold at once (default 5)
    maxCaptures: emptyToUndefined(
      z.coerce
        .number()
        .int("Use a whole number")
        .min(1, "Allow at least 1 save")
        .max(20, "At most 20 saves per game")
        .optional()
    ),
  })
  .refine((body) => !(body.startNow || body.startAt) || body.durationMinutes, {
    message: "Pick how long the session is",
    path: ["durationMinutes"],
  })
  .refine((body) => !body.durationMinutes || body.startNow || body.startAt, {
    message: "Pick a start date and time, or start now",
    path: ["startAt"],
  });

/** CR-016: a game may run at most this long in total, with the time added. */
export const GAME_MAX_TOTAL_MINUTES = 360;

// POST /:sessionId/extend — CR-016: Add time to a recording game
export const extendSessionSchema = z.object({
  minutes: z.coerce
    .number()
    .int("Use whole minutes")
    .min(1, "Add at least 1 minute")
    .max(GAME_MAX_TOTAL_MINUTES, "A game is at most 6 hours"),
});

// GET /
/** CR-003: POST /:sessionId/videos/:camera/retry — camera 0 (one / stacked), 1 or 2. */
export const sessionVideoParamsSchema = z.object({
  sessionId: z.string().trim().min(1).max(50),
  camera: z.coerce.number().int().min(0).max(2),
});

export const listSessionsQuerySchema = z.object({
  page: queryInt(1),
  pageSize: queryInt(20, { max: 100 }),
  venueId: emptyToUndefined(z.string().max(50).optional()),
  courtId: emptyToUndefined(z.string().max(50).optional()),
  status: queryEnum([
    "Waiting",
    "Scheduled",
    "Recording",
    "Processing",
    "Ready",
    "Failed",
    "Cancelled",
  ]),
  // CR-015: Unpaid / Paid / Free (a game from before payments)
  payment: queryEnum(["Unpaid", "Paid", "Free"]),
  search: z.string().max(100).optional().default(""),
  sortOrder: queryEnumDefault(["ASC", "DESC"], "DESC"),
});
