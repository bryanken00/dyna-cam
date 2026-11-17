import { z } from "zod";
import { emptyToUndefined, optionalString, queryInt } from "./_helpers.js";

/** Validators for the recorder-box API (controllers/v1/device/). */

// POST /heartbeat
export const heartbeatSchema = z.object({
  agentVersion: optionalString(50),
  cameras: z
    .array(
      z.object({
        courtId: z.string().min(1).max(50),
        // PLAN-002 Phase H: which of the court's cameras (omitted = camera 1)
        camera: z.union([z.literal(1), z.literal(2)]).optional(),
        status: z.enum(["ok", "error", "starting"]),
        message: optionalString(255),
        // Phase 5 live stream for this court (omitted when not streaming)
        streamStatus: emptyToUndefined(z.enum(["off", "starting", "live", "error"]).optional()),
        streamMessage: optionalString(255),
        // PLAN-002: which saved camera address this report is about (from /config)
        cameraVersion: optionalString(32),
        // PLAN-002: what the recorder actually receives, from its latest segment
        video: z
          .object({
            codec: optionalString(30),
            width: z.number().int().min(0).max(10000).optional(),
            height: z.number().int().min(0).max(10000).optional(),
            fps: z.number().min(0).max(240).optional(),
          })
          .optional(),
        audio: z
          .object({
            codec: optionalString(30),
            sampleRate: z.number().int().min(0).max(384000).optional(),
          })
          .nullable()
          .optional(),
      })
    )
    .max(100)
    .optional()
    .default([]),
  // PLAN-002 Phase G: each player stream the box runs (or retries)
  sessionStreams: z
    .array(
      z.object({
        sessionId: z.string().min(1).max(50),
        status: z.enum(["starting", "live", "error"]),
        message: optionalString(255),
      })
    )
    .max(50)
    .optional()
    .default([]),
  // PLAN-002 Phase E: the box's LAN live view (edge/src/live.js) — its address
  // and the key the API signs live-view links with. null = live view off.
  live: z
    .object({
      url: z
        .string()
        .trim()
        .max(255)
        .regex(/^https?:\/\/[^\s/?#]+$/, "A base URL like http://192.168.1.50:8090"),
      key: z.string().regex(/^[0-9a-f]{64}$/, "A 64-character hex key"),
    })
    .nullable()
    .optional(),
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
