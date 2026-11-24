import { z } from "zod";
import { emptyToUndefined, optionalString, queryEnum, queryInt } from "./_helpers.js";

/** A pay code as the player reads it out: case and spaces don't matter. */
const payCode = z
  .string()
  .transform((value) => value.replace(/\s+/g, "").toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{4,12}$/, "Enter the code shown on the player's clip"));

const optionalDate = () =>
  emptyToUndefined(
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date")
      .optional()
  );

// GET /lookup?payCode=
export const lookupPaymentQuerySchema = z.object({ payCode });

/** CR-015: what the player paid for a game, as staff type it (pesos, up to 2 decimals). */
const amount = z.coerce
  .number({ error: "Enter the amount paid" })
  .min(0, "The amount can't be negative")
  .max(1000000, "That amount is too large")
  .refine((value) => Math.round(value * 100) === value * 100, "Use at most 2 decimals");

// POST / — record a cash payment: a clip by pay code or ID, or a game (CR-015)
// by its ID with the amount staff typed
export const createPaymentSchema = z
  .object({
    payCode: emptyToUndefined(payCode.optional()),
    clipId: emptyToUndefined(z.string().max(50).optional()),
    sessionId: emptyToUndefined(z.string().max(50).optional()),
    amount: emptyToUndefined(amount.optional()),
    note: optionalString(255),
  })
  .refine(
    (body) => [body.payCode, body.clipId, body.sessionId].filter(Boolean).length === 1,
    { message: "Give one of: the pay code, the clip, or the game" }
  )
  .refine((body) => !body.sessionId || body.amount !== undefined, {
    message: "Enter the amount paid",
    path: ["amount"],
  });

// POST /:paymentId/refund
export const refundPaymentSchema = z.object({
  note: optionalString(255),
});

// GET /
export const listPaymentsQuerySchema = z.object({
  page: queryInt(1),
  pageSize: queryInt(20, { max: 100 }),
  venueId: emptyToUndefined(z.string().max(50).optional()),
  status: queryEnum(["Paid", "Refunded"]),
  dateFrom: optionalDate(),
  dateTo: optionalDate(),
});

// GET /settlement — PLAN-003 Phase F: each venue's online (Xendit) money for a
// date range, the statement Dyna Cam settles with venues from
export const settlementQuerySchema = z
  .object({
    dateFrom: optionalDate(),
    dateTo: optionalDate(),
  })
  .refine((q) => !q.dateFrom || !q.dateTo || q.dateFrom <= q.dateTo, {
    message: "The start date must be before the end date",
    path: ["dateTo"],
  });
