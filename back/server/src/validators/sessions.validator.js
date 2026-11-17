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
export const createSessionSchema = z.object({
  courtId: z.string().min(1, "Court is required").max(50),
  startAt: localDateTime,
  durationMinutes: z.coerce
    .number()
    .int("Use whole minutes")
    .min(5, "A session is at least 5 minutes")
    .max(180, "A session is at most 3 hours"),
  playerName: optionalString(100),
  phone: optionalPhone(),
});

// GET /
export const listSessionsQuerySchema = z.object({
  page: queryInt(1),
  pageSize: queryInt(20, { max: 100 }),
  venueId: emptyToUndefined(z.string().max(50).optional()),
  courtId: emptyToUndefined(z.string().max(50).optional()),
  status: queryEnum(["Scheduled", "Recording", "Processing", "Ready", "Failed", "Cancelled"]),
  search: z.string().max(100).optional().default(""),
  sortOrder: queryEnumDefault(["ASC", "DESC"], "DESC"),
});
