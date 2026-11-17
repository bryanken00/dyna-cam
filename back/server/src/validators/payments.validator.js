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

// POST / — record a cash payment, by pay code or by clip
export const createPaymentSchema = z
  .object({
    payCode: emptyToUndefined(payCode.optional()),
    clipId: emptyToUndefined(z.string().max(50).optional()),
    note: optionalString(255),
  })
  .refine((body) => Boolean(body.payCode) !== Boolean(body.clipId), {
    message: "Give the pay code or the clip, not both",
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
