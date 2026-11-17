import { z } from "zod";
import { optionalString, queryInt } from "./_helpers.js";

/** Validators for the recorder-box API (controllers/v1/device/). */

// POST /heartbeat
export const heartbeatSchema = z.object({
  agentVersion: optionalString(50),
  cameras: z
    .array(
      z.object({
        courtId: z.string().min(1).max(50),
        status: z.enum(["ok", "error", "starting"]),
        message: optionalString(255),
      })
    )
    .max(100)
    .optional()
    .default([]),
});

// GET /jobs
export const jobsQuerySchema = z.object({
  // How long to hold the request open waiting for a job (long-poll). 0 = answer now.
  wait: queryInt(25, { min: 0, max: 30 }),
});

// POST /buttons/:buttonCode/press
export const buttonParamsSchema = z.object({
  buttonCode: z.string().regex(/^[A-Za-z0-9_-]{3,32}$/, "Invalid button code"),
});
export const buttonPressSchema = z.object({
  // When the button was pressed, by the box's (NTP) clock. Omitted = now.
  pressedAtMs: z.number().int().positive().optional(),
});

// POST /clips/:clipId/fail
export const failClipSchema = z.object({
  reason: z.string().trim().min(1, "Reason is required").max(255),
});
