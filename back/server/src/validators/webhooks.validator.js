import { z } from "zod";

/**
 * Validators for payment-provider webhooks (controllers/v1/webhooks/). Only the
 * IDs are read from a webhook body; everything that matters is then read back
 * from the provider's API, so the rest of the body is let through unchecked.
 */

const providerId = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid ID");

// POST /webhooks/xendit — an invoice callback ({ id, external_id, status, … })
// or a refund event ({ event: "refund.succeeded" | "refund.failed", data: { id | refund_id } })
export const xenditWebhookSchema = z
  .object({
    id: providerId.optional(),
    event: z.string().trim().max(60).optional(),
    data: z
      .object({
        id: providerId.optional(),
        refund_id: providerId.optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()
  .refine((body) => body.id || body.data?.id || body.data?.refund_id, {
    message: "No invoice or refund ID",
  });
