import { z } from "zod";
import { emptyToUndefined, optionalString, queryEnum, queryInt } from "./_helpers.js";

/** The 6-digit key as typed: spaces and dashes are ignored. */
const pairingCode = z
  .string()
  .transform((value) => value.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Enter the 6-digit pairing key"));

// POST /admin/pairing-codes/apps and /recorders
export const createPairingCodeSchema = z.object({
  venueId: z.string().min(1, "Venue is required").max(50),
  name: z.string().trim().min(1, "Name is required").max(100),
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

// PUT /admin/paired-apps/:pairedAppId
export const updatePairedAppSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
});

// GET /admin/paired-apps
export const listPairedAppsQuerySchema = z.object({
  page: queryInt(1),
  pageSize: queryInt(20, { max: 100 }),
  venueId: emptyToUndefined(z.string().max(50).optional()),
  status: queryEnum(["Active", "Revoked", "Deleted"]),
});

// Paired app: GET /app/courts/:courtId/clips
export const recentClipsQuerySchema = z.object({
  limit: queryInt(10, { max: 30 }),
});

// Paired app: GET /app/payments/lookup and POST /app/payments
const payCode = z
  .string()
  .transform((value) => value.replace(/\s+/g, "").toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{4,12}$/, "Enter the code shown on the player's clip"));
export const appPayCodeQuerySchema = z.object({ payCode });
export const appCreatePaymentSchema = z.object({ payCode, note: optionalString(255) });
