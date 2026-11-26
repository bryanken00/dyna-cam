import { z } from "zod";
import { emptyToUndefined } from "./_helpers.js";

/**
 * PLAN-003 Phase A: a venue's booking rules, opening hours and rates, saved
 * as one form. Times are on the hour ("17:00"); an end may be "24:00"
 * (midnight). The grid is whole hours for every venue. CR-049: a day's
 * closing may run into the next morning ("25:00" = 1 AM the next day), up to
 * 24 hours after it opens; the next day can't open before that.
 */

const ON_THE_HOUR = /^([01]\d|2[0-3]):00$/;
const END_ON_THE_HOUR = /^(([01]\d|2[0-3]):00|24:00)$/;
// CR-049: "24:00" … "47:00" — midnight and the next morning's hours
const CLOSE_ON_THE_HOUR = /^(([01]\d|2[0-3]):00|([23]\d|4[0-7]):00)$/;
const DAY_MINUTES = 24 * 60;

const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60;

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const startTime = z.string().trim().regex(ON_THE_HOUR, "Use a time on the hour, e.g. 17:00");
const endTime = z
  .string()
  .trim()
  .regex(END_ON_THE_HOUR, "Use a time on the hour, e.g. 22:00 (24:00 = midnight)");

const wholeNumber = (label, min, max) =>
  z.coerce
    .number()
    .int(`${label} must be a whole number`)
    .min(min, `${label} must be at least ${min}`)
    .max(max, `${label} must be at most ${max}`);

const dayOfWeek = z.coerce.number().int().min(0).max(6);

const hoursEntry = z
  .object({
    dayOfWeek,
    opensAt: startTime,
    closesAt: z
      .string()
      .trim()
      .regex(CLOSE_ON_THE_HOUR, "Use a time on the hour, e.g. 22:00 (25:00 = 1 AM the next day)"),
  })
  .refine((h) => toMinutes(h.opensAt) < toMinutes(h.closesAt), {
    message: "Closing time must be after opening time",
    path: ["closesAt"],
  })
  .refine((h) => toMinutes(h.closesAt) - toMinutes(h.opensAt) <= DAY_MINUTES, {
    message: "A day can be open at most 24 hours",
    path: ["closesAt"],
  });

/** CR-049: the first day whose late hours run into the next day's opening → [late, next], or null. */
const lateHoursClash = (hours) => {
  const byDay = new Map(hours.map((h, index) => [h.dayOfWeek, { ...h, index }]));
  for (const h of byDay.values()) {
    const lateUntil = toMinutes(h.closesAt) - DAY_MINUTES;
    const next = byDay.get((h.dayOfWeek + 1) % 7);
    if (lateUntil > 0 && next && toMinutes(next.opensAt) < lateUntil) return [h, next];
  }
  return null;
};

// Pesos, 2 decimals
const pricePerHour = z.coerce
  .number()
  .min(0, "The price can't be negative")
  .max(1000000, "The price is too high")
  .refine((value) => Math.round(value * 100) === value * 100, "Use at most 2 decimals");

const rateEntry = z
  .object({
    // Present = an existing rate being kept/edited; absent = a new one
    rateId: emptyToUndefined(z.string().max(50).optional()),
    name: z.string().trim().min(1, "Name the rate, e.g. Peak").max(50),
    // Absent / "" / null = every court at the venue
    courtId: emptyToUndefined(z.string().max(50).optional()),
    daysOfWeek: z
      .array(dayOfWeek)
      .min(1, "Pick at least one day")
      .max(7)
      .refine((days) => new Set(days).size === days.length, "A day is listed twice"),
    startTime,
    endTime,
    pricePerHour,
  })
  .refine((r) => toMinutes(r.startTime) < toMinutes(r.endTime), {
    message: "The end must be after the start",
    path: ["endTime"],
  });

/** Two rates for the same courts overlap on a shared day and hour. */
const overlappingRates = (rates) => {
  for (let i = 0; i < rates.length; i += 1) {
    for (let j = i + 1; j < rates.length; j += 1) {
      const a = rates[i];
      const b = rates[j];
      if ((a.courtId || null) !== (b.courtId || null)) continue;
      const sharedDay = a.daysOfWeek.some((d) => b.daysOfWeek.includes(d));
      const sharedHours =
        toMinutes(a.startTime) < toMinutes(b.endTime) &&
        toMinutes(b.startTime) < toMinutes(a.endTime);
      if (sharedDay && sharedHours) return [i, j];
    }
  }
  return null;
};

// PUT /:venueId
export const updateBookingSettingsSchema = z
  .object({
    // CR-047: no longest booking any more (a game runs as long as the venue is open) —
    // an older page may still send it; it's ignored
    maxBookingMinutes: z.unknown().optional(),
    // CR-048: no booking window any more (players book any day from today on) — ignored
    bookingDaysAhead: z.unknown().optional(),
    deskHoldMinutes: wholeNumber("The pay-at-desk deadline", 0, 1440),
    onlineHoldMinutes: wholeNumber("The online payment hold", 5, 60),
    cancelCutoffHours: wholeNumber("The cancel cut-off", 0, 168),
    checkInEarlyMinutes: wholeNumber("Early check-in", 0, 60),
    hours: z
      .array(hoursEntry)
      .max(7)
      .refine(
        (list) => new Set(list.map((h) => h.dayOfWeek)).size === list.length,
        "Each day can have one set of opening hours"
      ),
    rates: z.array(rateEntry).max(100),
  })
  .superRefine((body, ctx) => {
    const late = lateHoursClash(body.hours);
    if (late) {
      ctx.addIssue({
        code: "custom",
        path: ["hours", late[1].index, "opensAt"],
        message: `${DAY_NAMES[late[1].dayOfWeek]} can't open before ${DAY_NAMES[late[0].dayOfWeek]}'s hours end`,
      });
    }
    const clash = overlappingRates(body.rates);
    if (clash) {
      ctx.addIssue({
        code: "custom",
        path: ["rates", clash[1]],
        message: `"${body.rates[clash[1]].name}" overlaps "${body.rates[clash[0]].name}" on the same day and hours`,
      });
    }
  });
