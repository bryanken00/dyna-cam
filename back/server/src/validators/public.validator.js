import { z } from "zod";
import { optionalEmail, optionalPhone, optionalString } from "./_helpers.js";
import { bookingDate, bookingLength, startTime } from "./bookings.validator.js";

/** Validators for the no-login player routes (controllers/v1/public/). */

// Tokens come from utils/crypto/tokens.js (base64url). Rejecting anything else
// up front keeps junk out of the queries and the logs.
const token = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, "Invalid link");

// /courts/:qrToken
export const courtTokenParamsSchema = z.object({ qrToken: token });

// POST /courts/:qrToken/games — CR-027: the player's own game. The game time has
// the same bounds as Admin's New game; no payment and no save limit here (the
// game is free and allows PLAYER_MAX_CAPTURES saves).
export const startGameSchema = z.object({
  durationMinutes: z.coerce
    .number()
    .int("Use whole minutes")
    .min(5, "A game is at least 5 minutes")
    .max(180, "A game is at most 3 hours"),
  playerName: optionalString(100),
  phone: optionalPhone(),
  email: optionalEmail(255),
});

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
  playerName: z.string().trim().min(1, "Enter your name").max(100),
  phone: optionalPhone(),
  // Required online: it's how the player gets their booking link back
  email: z.string().trim().email("Enter a valid email").max(255),
  // Phase F adds "Online" (Xendit)
  // Phase F: Online = a Xendit checkout (refused with 409 while online payment is off)
  payMethod: z.enum(["Desk", "Online"]),
});

// POST /courts/:qrToken/check-in — PLAN-003 Phase D: the booking code the
// player was given ("k7q m2p" works), checked in at that court's QR
export const checkInCodeSchema = z.object({
  bookingCode: z
    .string()
    .transform((v) => v.replace(/\s+/g, "").toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{4,12}$/, "Enter the code from your booking")),
});
