import { z } from "zod";
import { emptyToUndefined, optionalString, queryEnum, queryInt } from "./_helpers.js";

const optionalDate = () =>
  emptyToUndefined(
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date")
      .optional()
  );

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
