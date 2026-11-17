import { z } from "zod";
import { optionalString } from "./_helpers.js";

/** The 6-digit key as typed: spaces and dashes are ignored. */
const pairingCode = z
  .string()
  .transform((value) => value.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Enter the 6-digit pairing key"));

// POST /admin/pairing-codes/recorders
export const createPairingCodeSchema = z.object({
  venueId: z.string().min(1, "Venue is required").max(50),
  name: z.string().trim().min(1, "Name is required").max(100),
});

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

// POST /pair/device
export const pairDeviceSchema = z.object({
  code: pairingCode,
  agentVersion: optionalString(50),
});
