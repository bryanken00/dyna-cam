import { z } from "zod";

/** Validators for the paired session device API (controllers/v1/app/). */

// POST /session/captures — CR-013: save the last `seconds` of the game
export const captureSchema = z.object({
  seconds: z.coerce
    .number()
    .int("Whole seconds")
    .min(60, "Save at least one minute")
    .max(4 * 3600, "That's longer than a game"),
});

// DELETE /session/captures/:captureId
export const captureParamsSchema = z.object({
  captureId: z.string().trim().min(1).max(50),
});
