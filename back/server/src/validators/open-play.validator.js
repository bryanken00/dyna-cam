import { z } from "zod";
import {
  emptyToUndefined,
  optionalPhone,
  optionalString,
  queryEnum,
  queryEnumDefault,
  queryInt,
} from "./_helpers.js";
import { SKILL_LEVELS } from "../utils/venueFacts.js";

/** PLAN-009 phase C: Open Play (controllers/v1/admin/open-play, public/open-play, player/open-play). */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;

const level = () => emptyToUndefined(z.enum(SKILL_LEVELS).optional());
const date = (label) => z.string().regex(DATE, `Pick the ${label}`);
const time = (label) => z.string().regex(TIME, `Pick the ${label}`);

// Pesos, at most 2 decimals; 0 = free
const price = z.coerce
  .number({ invalid_type_error: "Enter the fee as a number" })
  .min(0, "The fee can't be negative")
  .max(100000, "The fee is too high")
  .refine((v) => Math.round(v * 100) === v * 100, "Use at most 2 decimals");

const sessionFields = {
  kind: z.enum(["OpenPlay", "Clinic"]).optional().default("OpenPlay"),
  title: z.string().trim().min(1, "Give the session a name").max(100),
  description: optionalString(500),
  // PLAN-009 phase F: a clinic's coach; a club whose members only may join
  coachName: optionalString(100),
  clubId: emptyToUndefined(z.string().max(50).optional()),
  date: date("date"),
  startTime: time("start time"),
  endTime: time("end time"),
  courtIds: z.array(z.string().min(1).max(50)).min(1, "Pick at least one court").max(30),
  minLevel: level(),
  maxLevel: level(),
  capacity: z.coerce
    .number({ invalid_type_error: "Enter how many players can join" })
    .int("Enter a whole number of players")
    .min(2, "At least 2 players")
    .max(200, "At most 200 players"),
  pricePerHead: price.default(0),
};

/** "18:00" < "21:00", and the end may be midnight ("24:00"). */
const endsAfterStart = (v) => v.endTime === "24:00" || v.endTime > v.startTime;
const END_MESSAGE = { message: "The session must end after it starts (same day)", path: ["endTime"] };

// POST /admin/open-play/sessions — one session, or (repeat) a weekly series
export const createPlaySessionSchema = z
  .object({
    venueId: z.string().min(1, "Pick a venue").max(50),
    ...sessionFields,
    repeat: z
      .object({
        daysOfWeek: z.array(z.coerce.number().int().min(0).max(6)).min(1, "Pick at least one day").max(7),
        endsOn: emptyToUndefined(date("last date").optional()),
      })
      .optional(),
  })
  .refine(endsAfterStart, END_MESSAGE)
  .refine((v) => !v.repeat?.endsOn || v.repeat.endsOn >= v.date, {
    message: "The last date must be on or after the first",
    path: ["repeat", "endsOn"],
  });

// PUT /admin/open-play/sessions/:playSessionId
export const updatePlaySessionSchema = z.object(sessionFields).refine(endsAfterStart, END_MESSAGE);

// GET /admin/open-play/sessions
export const listPlaySessionsQuerySchema = z.object({
  venueId: emptyToUndefined(z.string().max(50).optional()),
  when: queryEnumDefault(["upcoming", "past", "all"], "upcoming"),
  kind: queryEnum(["OpenPlay", "Clinic"]),
  page: queryInt(1),
  pageSize: queryInt(20, { max: 100 }),
});

// GET /admin/open-play/series
export const listPlaySeriesQuerySchema = z.object({
  venueId: emptyToUndefined(z.string().max(50).optional()),
});

// POST /admin/open-play/sessions/:playSessionId/cancel
export const cancelPlaySessionSchema = z.object({
  reason: optionalString(255),
});

// POST /admin/open-play/sessions/:playSessionId/walk-ins
export const addWalkInSchema = z.object({
  name: z.string().trim().min(1, "Enter the player's name").max(100),
  phone: optionalPhone(),
});

// GET /public/open-play?from=&days=
export const publicPlaySessionsQuerySchema = z.object({
  from: emptyToUndefined(date("date").optional()),
  days: queryInt(7, { min: 1, max: 31 }),
  kind: queryEnum(["OpenPlay", "Clinic"]),
});

// /public/open-play/:playToken, /player/play/sessions/:playToken/…
export const playTokenParamsSchema = z.object({
  playToken: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, "This session link isn't valid"),
});

// /player/play/signups/:signupCode/…
export const signupCodeParamsSchema = z.object({
  signupCode: z.string().regex(/^[A-Z0-9]{4,12}$/, "Spot not found"),
});

// GET /player/play/signups?when=
export const playerSignupsQuerySchema = z.object({
  when: queryEnumDefault(["upcoming", "past"], "upcoming"),
});

// ── PLAN-009 phase D: the queue ──────────────────────────────────────────────

const score = () =>
  emptyToUndefined(z.coerce.number({ invalid_type_error: "Enter the score as a number" }).int().min(0).max(99).optional());

// POST /admin/open-play/games/:playGameId/end — a score is optional
export const endPlayGameSchema = z.object({ scoreA: score(), scoreB: score() }).refine(
  (v) => (v.scoreA === undefined) === (v.scoreB === undefined),
  { message: "Enter both scores, or neither", path: ["scoreB"] }
);

// POST /admin/open-play/games/:playGameId/swap
export const swapPlayGameSchema = z.object({
  outSignupId: z.string().min(1).max(50),
  inSignupId: z.string().min(1).max(50),
});

// POST /admin/open-play/sessions/:playSessionId/queue/pause
export const pauseQueueSchema = z.object({ paused: z.boolean() });

// POST /admin/open-play/signups/:playSignupId/rest
export const restSpotSchema = z.object({ resting: z.boolean() });
