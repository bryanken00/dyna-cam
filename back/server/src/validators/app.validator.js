import { z } from "zod";

/** Validators for the paired session device API (controllers/v1/app/). */

const gameOffset = z.coerce
  .number()
  .int("Whole seconds")
  .min(0, "Pick a time in the game")
  .max(6 * 3600, "That's longer than a game")
  .optional();

// POST /session/captures — CR-013: save the last `seconds` of the game, or —
// CR-029 — the stretch fromSeconds → toSeconds (seconds into the game)
export const captureSchema = z
  .object({
    seconds: z.coerce
      .number()
      .int("Whole seconds")
      .min(60, "Save at least one minute")
      .max(4 * 3600, "That's longer than a game")
      .optional(),
    fromSeconds: gameOffset,
    toSeconds: gameOffset,
  })
  .refine(
    (body) =>
      body.seconds !== undefined || (body.fromSeconds !== undefined && body.toSeconds !== undefined),
    { message: "Pick how much of the game to save", path: ["seconds"] }
  )
  .refine(
    (body) =>
      body.fromSeconds === undefined ||
      body.toSeconds === undefined ||
      body.toSeconds - body.fromSeconds >= 60,
    { message: "Save at least one minute", path: ["toSeconds"] }
  );

// DELETE /session/captures/:captureId
export const captureParamsSchema = z.object({
  captureId: z.string().trim().min(1).max(50),
});
