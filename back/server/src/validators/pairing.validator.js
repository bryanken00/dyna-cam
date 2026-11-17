import { z } from "zod";
import { optionalString } from "./_helpers.js";

/** The 6-digit key as typed: spaces and dashes are ignored. */
const pairingCode = z
  .string()
  .transform((value) => value.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Enter the 6-digit pairing key"));

// POST /admin/sessions/:sessionId/pairing-codes — a key for a session device
export const createSessionPairingCodeSchema = z.object({
  name: z.string().trim().min(1, "Name the device, e.g. Court 1 tablet").max(100),
});

// POST /pair/app
export const pairAppSchema = z.object({
  code: pairingCode,
  platform: optionalString(30),
  appVersion: optionalString(50),
});

// POST /pair/enroll — a recorder box set up from its .env (PLAN-002 Phase I)
export const enrollDeviceSchema = z.object({
  enrollKey: z.string().trim().min(1).max(500),
  venueId: z.string().trim().regex(/^[A-Za-z0-9-]{1,50}$/, "Invalid venue ID"),
  name: optionalString(100),
  agentVersion: optionalString(50),
});
