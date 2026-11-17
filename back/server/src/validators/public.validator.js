import { z } from "zod";

/** Validators for the no-login player routes (controllers/v1/public/). */

// Tokens come from utils/crypto/tokens.js (base64url). Rejecting anything else
// up front keeps junk out of the queries and the logs.
const token = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, "Invalid link");

// /courts/:qrToken
export const courtTokenParamsSchema = z.object({ qrToken: token });

// /clips/:shareToken
export const clipTokenParamsSchema = z.object({ shareToken: token });

// /sessions/:shareToken
export const sessionTokenParamsSchema = z.object({ shareToken: token });

// /stream-setup/:code — the player's own live stream (PLAN-002 Phase G)
export const streamSetupParamsSchema = z.object({ code: token });

/** A stream key as pasted: no spaces, no slashes (it goes after the platform's server URL). */
const streamKey = z
  .string()
  .trim()
  .min(8, "Paste the whole stream key")
  .max(200, "That stream key is too long")
  .regex(/^[A-Za-z0-9_.~:?=&%+-]+$/, "Paste only the stream key, without spaces or slashes");

/** A full RTMP(S) address with its key, for platforms other than Facebook and YouTube. */
const rtmpAddress = z
  .string()
  .trim()
  .max(500, "That address is too long")
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return ["rtmp:", "rtmps:"].includes(parsed.protocol) && parsed.hostname && parsed.pathname.length > 1;
    } catch {
      return false;
    }
  }, "Enter the full address starting with rtmp:// or rtmps://, including the stream key");

/** What the stream shows on a 2-camera court (PLAN-002 Phase H). */
const layout = z.enum(["CAM1", "CAM2", "STACKED"]).optional();

// PUT /stream-setup/:code — a stream key (and optionally a layout)…
export const saveStreamSchema = z.discriminatedUnion("platform", [
  z.object({ platform: z.literal("FACEBOOK"), streamKey, layout }),
  z.object({ platform: z.literal("YOUTUBE"), streamKey, layout }),
  z.object({ platform: z.literal("OTHER"), url: rtmpAddress, layout }),
]);

// …or only a new layout for the stream already saved
export const streamLayoutSchema = z.object({ layout: z.enum(["CAM1", "CAM2", "STACKED"]) });
