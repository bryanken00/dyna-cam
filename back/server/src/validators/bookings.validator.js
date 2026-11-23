import { z } from "zod";
import {
  emptyToUndefined,
  optionalEmail,
  optionalPhone,
  optionalString,
  queryEnum,
  queryEnumDefault,
  queryInt,
} from "./_helpers.js";

/**
 * PLAN-003 Phase B: desk bookings in Admin. Times are venue (Manila) time; a
 * booking starts on the hour and lasts whole hours.
 */

const YMD = /^\d{4}-\d{2}-\d{2}$/;

const isRealDate = (value) => {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};

export const bookingDate = () =>
  z.string().trim().regex(YMD, "Use a YYYY-MM-DD date").refine(isRealDate, "That date doesn't exist");

export const startTime = () =>
  z
    .string()
    .trim()
    .regex(/^([01]\d|2[0-3]):00$/, "Bookings start on the hour, e.g. 17:00");

export const bookingLength = (max) =>
  z.coerce
    .number()
    .int("Bookings are whole hours")
    .min(60, "Book at least 1 hour")
    .max(max, `Book at most ${max / 60} hours`)
    .refine((v) => v % 60 === 0, "Bookings are whole hours");

const optionalDate = () => emptyToUndefined(bookingDate().optional());

export const BOOKING_STATUSES = [
  "Pending",
  "Confirmed",
  "CheckedIn",
  "Completed",
  "NoShow",
  "Cancelled",
  "Expired",
  "Deleted",
];

// POST /
export const createBookingSchema = z.object({
  courtId: z.string().trim().min(1, "Court is required").max(50),
  date: bookingDate(),
  startTime: startTime(),
  durationMinutes: bookingLength(360),
  playerName: z.string().trim().min(1, "Name is required").max(100),
  phone: optionalPhone(),
  email: optionalEmail(255),
  // Cash = paid now at the desk · Hold = pay at the desk later · Free = comp
  payment: z.enum(["Cash", "Hold", "Free"]),
  // A note on the cash payment
  note: optionalString(255),
  // Staff may book outside the venue's opening hours
  ignoreHours: z.boolean().optional().default(false),
});

// PUT /:bookingId/move — same length
export const moveBookingSchema = z.object({
  courtId: z.string().trim().min(1, "Court is required").max(50),
  date: bookingDate(),
  startTime: startTime(),
  // Work the price out again for the new time (only while unpaid)
  reprice: z.boolean().optional().default(false),
  ignoreHours: z.boolean().optional().default(false),
});

// POST /:bookingId/cancel
export const cancelBookingSchema = z.object({
  reason: z.string().trim().min(1, "Say why it's cancelled").max(255),
  // Refund what was paid (all of it)
  refund: z.boolean().optional().default(true),
});

// POST /:bookingId/payments
export const bookingPaymentSchema = z.object({
  note: optionalString(255),
});

// GET /
export const listBookingsQuerySchema = z.object({
  page: queryInt(1),
  pageSize: queryInt(20, { max: 100 }),
  search: z.string().max(100).optional().default(""),
  venueId: emptyToUndefined(z.string().max(50).optional()),
  courtId: emptyToUndefined(z.string().max(50).optional()),
  status: queryEnum(BOOKING_STATUSES),
  dateFrom: optionalDate(),
  dateTo: optionalDate(),
  sortOrder: queryEnumDefault(["ASC", "DESC"], "ASC"),
});

// GET /day
export const dayQuerySchema = z.object({
  venueId: z.string().trim().min(1, "Venue is required").max(50),
  date: bookingDate(),
});

// GET /quote
export const quoteQuerySchema = z.object({
  courtId: z.string().trim().min(1, "Court is required").max(50),
  date: bookingDate(),
  startTime: startTime(),
  durationMinutes: bookingLength(360),
  // Moving a booking: its own slot doesn't count as taken
  bookingId: emptyToUndefined(z.string().max(50).optional()),
});
