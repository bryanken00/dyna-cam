import { z } from "zod";
import {
  emptyToUndefined,
  localDateTime,
  optionalString,
  queryEnumDefault,
  queryInt,
} from "./_helpers.js";

/**
 * PLAN-003 Phase A: closures (blackouts) — a court, or the whole venue
 * (no courtId), can't be booked or played on between startAt and endAt.
 */

const window = {
  // Absent / "" / null = the whole venue
  courtId: emptyToUndefined(z.string().max(50).optional()),
  startAt: localDateTime(),
  endAt: localDateTime(),
  reason: optionalString(255),
  // Cancel the live bookings in the way instead of refusing (409 lists them)
  cancelConflicts: z.boolean().optional().default(false),
};

const endAfterStart = {
  check: (body) => body.endAt > body.startAt,
  issue: { message: "The closure must end after it starts", path: ["endAt"] },
};

// POST /
export const createClosureSchema = z
  .object({
    venueId: z.string().trim().min(1, "Venue is required").max(50),
    ...window,
  })
  .refine(endAfterStart.check, endAfterStart.issue);

// PUT /:closureId — the venue can't change
export const updateClosureSchema = z.object(window).refine(endAfterStart.check, endAfterStart.issue);

// GET /
export const listClosuresQuerySchema = z.object({
  venueId: z.string().trim().min(1, "Venue is required").max(50),
  // upcoming = not ended yet (the default); past = ended
  when: queryEnumDefault(["upcoming", "past", "all"], "upcoming"),
  page: queryInt(1),
  pageSize: queryInt(20, { max: 100 }),
});
