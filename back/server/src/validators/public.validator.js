import { z } from "zod";
import { optionalPhone } from "./_helpers.js";
import { bookingDate, bookingLength, startTime } from "./bookings.validator.js";

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

// DELETE /sessions/:shareToken/captures/:number — CR-028: a save by its number on
// the page ("Save 2"); public routes carry no business IDs
export const captureNumberParamsSchema = z.object({
  shareToken: token,
  number: z.coerce.number().int().min(1).max(1000),
});
// GET /sessions/:shareToken/preview?from=&to= — CR-029: a stretch of the game
// (seconds into it) to replay before saving it
export const previewQuerySchema = z
  .object({
    from: z.coerce.number().int().min(0).max(6 * 3600),
    to: z.coerce.number().int().min(1).max(6 * 3600),
  })
  .refine((q) => q.to > q.from, { message: "Pick where the stretch ends", path: ["to"] });

// …?savedAt= — the save's savedAt as the page showed it, so a number that
// shifted (another phone deleted an earlier save) deletes nothing
export const captureSavedAtQuerySchema = z.object({
  savedAt: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, "Reload the page and try again"),
});

// /games/:payCode — CR-015: a game's code as typed on the device ("k7qm 2p" works)
export const gameCodeParamsSchema = z.object({
  payCode: z
    .string()
    .transform((value) => value.replace(/\s+/g, "").toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{4,12}$/, "Enter the game's code")),
});

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

/* ── PLAN-003 Phase C: the public booking page ──────────────────────────────
 * /book/:bookingToken is a venue's online booking link; /bookings/:manageToken
 * is one booking's own link. Courts are named by a key from the page's reply
 * (courtKey), never by their business ID.
 */

// /book/:bookingToken
export const bookingTokenParamsSchema = z.object({ bookingToken: token });

// /bookings/:manageToken
export const manageTokenParamsSchema = z.object({ manageToken: token });

const courtKey = z.string().regex(/^[a-f0-9]{16}$/, "Pick a court");

// GET /book/:bookingToken/availability?date=&durationMinutes=
export const availabilityQuerySchema = z.object({
  date: bookingDate(),
  durationMinutes: bookingLength(360),
});

// POST /book/:bookingToken/bookings
export const publicBookingSchema = z.object({
  courtKey,
  date: bookingDate(),
  startTime: startTime(),
  durationMinutes: bookingLength(360),
  // PLAN-006: the name and email are the signed-in player's (an old page's
  // playerName / email are dropped here, unknown keys being stripped)
  phone: optionalPhone(),
  // Phase F: Online = a Xendit checkout (refused with 409 while online payment is off)
  payMethod: z.enum(["Desk", "Online"]),
});

// GET /bookings/:manageToken/move-options?date= — PLAN-003 Phase H
export const moveOptionsQuerySchema = z.object({ date: bookingDate() });

// POST /bookings/:manageToken/move — PLAN-003 Phase H: a court (by its key from
// move-options; the booking's own court when left out), a date and a start
export const playerMoveSchema = z.object({
  courtKey: courtKey.optional(),
  date: bookingDate(),
  startTime: startTime(),
});


// CR-033: /payment-sandbox/:checkoutId — the built-in test checkout's ID
export const paymentSandboxParamsSchema = z.object({
  checkoutId: z.string().regex(/^sandbox_[A-Za-z0-9_-]{16,64}$/, "Invalid link"),
});

// CR-038: /board/:displayToken — a venue's TV court board link
export const displayTokenParamsSchema = z.object({ displayToken: token });
