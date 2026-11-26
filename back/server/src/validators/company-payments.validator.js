import { z } from "zod";

/**
 * PLAN-008 phase C: a company connects its own Xendit account (Admin → Online
 * payment). Both values are secrets: stored encrypted and never returned.
 */

// PUT /admin/company-payments
export const saveCompanyPaymentsSchema = z.object({
  secretKey: z
    .string()
    .trim()
    .min(20, "Paste the whole secret key")
    .max(200)
    .refine(
      (v) => v.startsWith("xnd_development_") || v.startsWith("xnd_production_"),
      "A Xendit secret key starts with xnd_development_ or xnd_production_"
    ),
  callbackToken: z.string().trim().min(10, "Paste the whole webhook verification token").max(200),
});
