import { z } from "zod";
import { emptyToUndefined, optionalString, queryEnum, queryInt } from "./_helpers.js";
import { SKILL_LEVELS } from "../utils/venueFacts.js";

/** PLAN-009 phase E: tournaments (controllers/v1/admin/tournaments, public/tournaments, player/tournaments). */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const DATETIME = /^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d$/;
const level = () => emptyToUndefined(z.enum(SKILL_LEVELS).optional());
const MAX_DAYS = 14;

const tournamentFields = {
  name: z.string().trim().min(1, "Name the tournament").max(120),
  description: optionalString(1000),
  startDate: z.string().regex(DATE, "Pick the first day"),
  endDate: z.string().regex(DATE, "Pick the last day"),
  dailyStart: z.string().regex(TIME, "Pick when the courts are held from"),
  dailyEnd: z.string().regex(TIME, "Pick when the courts are held until"),
  registrationClosesAt: z.string().regex(DATETIME, "Pick when registration closes"),
  courtIds: z.array(z.string().min(1).max(50)).min(1, "Pick at least one court").max(30),
};

const tournamentRules = (schema) =>
  schema
    .refine((v) => v.endDate >= v.startDate, { message: "The last day can't be before the first", path: ["endDate"] })
    .refine(
      (v) => (Date.parse(v.endDate) - Date.parse(v.startDate)) / 86400000 < MAX_DAYS,
      { message: `A tournament runs at most ${MAX_DAYS} days`, path: ["endDate"] }
    )
    .refine((v) => v.dailyEnd === "24:00" || v.dailyEnd > v.dailyStart, {
      message: "The courts must be held until after they're held from",
      path: ["dailyEnd"],
    })
    .refine((v) => v.registrationClosesAt.slice(0, 10) <= v.endDate, {
      message: "Registration must close before the tournament ends",
      path: ["registrationClosesAt"],
    });

export const createTournamentSchema = tournamentRules(
  z.object({ venueId: z.string().min(1, "Pick a venue").max(50), ...tournamentFields })
);
export const updateTournamentSchema = tournamentRules(z.object(tournamentFields));

export const tournamentStatusSchema = z.object({ status: z.enum(["Open", "Closed", "Live", "Finished"]) });
export const cancelTournamentSchema = z.object({ reason: optionalString(255) });

export const listTournamentsQuerySchema = z.object({
  venueId: emptyToUndefined(z.string().max(50).optional()),
  status: queryEnum(["Draft", "Open", "Closed", "Live", "Finished", "Cancelled"]),
  page: queryInt(1),
  pageSize: queryInt(20, { max: 100 }),
});

const fee = z.coerce
  .number({ invalid_type_error: "Enter the fee as a number" })
  .min(0, "The fee can't be negative")
  .max(100000, "The fee is too high")
  .refine((v) => Math.round(v * 100) === v * 100, "Use at most 2 decimals");

export const divisionSchema = z
  .object({
    name: z.string().trim().min(1, "Name the division").max(100),
    teamSize: z.coerce.number().int().min(1).max(2).default(2),
    minLevel: level(),
    maxLevel: level(),
    capacity: z.coerce.number({ invalid_type_error: "Enter how many teams" }).int().min(2, "At least 2 teams").max(128),
    entryFee: fee.default(0),
    format: z.enum(["RoundRobin", "SingleElimination", "RoundRobinThenKnockout"]),
    groupSize: emptyToUndefined(z.coerce.number().int().min(3).max(8).optional()),
    advancePerGroup: emptyToUndefined(z.coerce.number().int().min(1).max(4).optional()),
    pointsToWin: z.coerce.number().int().min(7).max(21).default(11),
    winBy: z.coerce.number().int().min(1).max(2).default(2),
  })
  .refine((v) => v.format !== "RoundRobinThenKnockout" || (v.groupSize && v.advancePerGroup), {
    message: "Groups then knockout needs a group size and how many go through",
    path: ["groupSize"],
  })
  .refine((v) => !v.minLevel || !v.maxLevel || SKILL_LEVELS.indexOf(v.minLevel) <= SKILL_LEVELS.indexOf(v.maxLevel), {
    message: "The highest level can't be below the lowest",
    path: ["maxLevel"],
  });

// POST /admin/tournaments/divisions/:divisionId/teams — a team staff add (names only, free)
export const adminTeamSchema = z.object({
  name: z.string().trim().min(1, "Name the team").max(60),
  players: z.array(z.string().trim().min(1).max(100)).min(1, "Enter the players' names").max(2),
});

export const teamSeedSchema = z.object({
  seed: z.union([z.coerce.number().int().min(1).max(128), z.null(), z.literal("")]).transform((v) => (v === "" ? null : v)),
});

export const scheduleMatchSchema = z.object({
  courtId: z.union([z.string().min(1).max(50), z.null(), z.literal("")]).transform((v) => v || null),
  scheduledAt: z
    .union([z.string().regex(DATETIME, "Pick the time"), z.null(), z.literal("")])
    .transform((v) => (v ? `${v}:00` : null)),
});

export const scoreMatchSchema = z.object({
  scoreA: z.coerce.number().int().min(0).max(99),
  scoreB: z.coerce.number().int().min(0).max(99),
});

// ── players ─────────────────────────────────────────────────────────────────

export const publicTokenParamsSchema = z.object({
  publicToken: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, "This tournament link isn't valid"),
});
export const registerParamsSchema = z.object({
  publicToken: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, "This tournament link isn't valid"),
  divisionKey: z.string().regex(/^[0-9a-f]{16}$/, "Division not found"),
});
export const inviteParamsSchema = z.object({
  inviteToken: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, "This invite link isn't valid"),
});
export const teamCodeParamsSchema = z.object({
  teamCode: z.string().regex(/^[A-Z0-9]{4,12}$/, "Entry not found"),
});
export const registerTeamSchema = z.object({
  name: optionalString(60),
});
export const publicTournamentsQuerySchema = z.object({
  page: queryInt(1),
});
