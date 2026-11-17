/**
 * API — Paired staff phone (PLAN-002)
 * All functions return response.data — the envelope `{ success, message, data }`.
 * Shapes: back/server/src/controllers/v1/pairing/pairing.controller.js and
 * back/server/src/controllers/v1/app/app.controller.js.
 *
 * Every /app/* call goes through the paired instance (`Authorization: App
 * <token>`), which also handles "this phone was unpaired" — see axios.js.
 * Everything is scoped to the phone's venue by the API; another venue's
 * court or clip is a 404.
 */
import { axiosPair, createPairedAxiosInstance } from "./axios";

const axiosPaired = createPairedAxiosInstance();

const BASE = "/api/v1/app";

/**
 * Redeem a 6-digit key from the web portal. No login — the key is the
 * credential, once. Spaces and dashes in `code` are fine.
 * payload: { code, platform, appVersion }
 * 201 data: { token, pairedApp: { pairedAppId, name }, venue: { venueId, name } }
 * 400 wrong or expired key · 429 too many tries / pairing paused
 *
 * ⚠️ The response holds the phone's token — never log it.
 */
export const pairAppApi = async (payload) => {
  const response = await axiosPair.post("/api/v1/pair/app", payload);
  return response.data;
};

/**
 * data: { pairedApp: { pairedAppId, name }, venue: { venueId, name, logoUrl,
 *         clipPrice }, clipSeconds }
 */
export const getPairedMeApi = async () => {
  const response = await axiosPaired.get(`${BASE}/me`);
  return response.data;
};

/**
 * The venue's active courts.
 * data: { courts: [{ courtId, name, hasCamera, recorderOnline, canRecord }] }
 */
export const getPairedCourtsApi = async () => {
  const response = await axiosPaired.get(`${BASE}/courts`);
  return response.data;
};

/**
 * Record — save the court's last 60 seconds (a STAFF clip).
 * 201 data: { clipId, shareUrl, merged: false }
 * 200 data: { clipId, shareUrl, merged: true } — joined a save made seconds ago
 * 503 code CAMERA_OFFLINE · 404 court not found (or not this venue's)
 */
export const recordClipApi = async (courtId) => {
  const response = await axiosPaired.post(`${BASE}/courts/${courtId}/clips`);
  return response.data;
};

/**
 * A court's recent clips, newest first (limit ≤ 30).
 * data: { clips: [AppClip] } where AppClip = { clipId, courtId, courtName,
 *   source, requestedAt, durationSeconds, status ("Pending" while saving |
 *   "Ready" | "Failed" | "Expired"), shareUrl, thumbnailUrl, price,
 *   paymentStatus, payCode (only while Unpaid) }
 */
export const getCourtRecentClipsApi = async (courtId, limit = 10) => {
  const response = await axiosPaired.get(`${BASE}/courts/${courtId}/clips`, {
    params: { limit },
  });
  return response.data;
};

/** data: { clip: AppClip } — polled by the QR screen while it's saving */
export const getPairedClipApi = async (clipId) => {
  const response = await axiosPaired.get(`${BASE}/clips/${clipId}`);
  return response.data;
};

/**
 * This venue's clip with that pay code (case and spaces ignored).
 * data: { clip: AppClip } — payCode always included here. 404 if none.
 */
export const lookupPairedPaymentApi = async (payCode) => {
  const response = await axiosPaired.get(`${BASE}/payments/lookup`, {
    params: { payCode },
  });
  return response.data;
};

/**
 * Record cash for it. payload: { payCode, note? }
 * 201 data: { paymentId, clipId, amount } · 404 · 409 paid / free / expired
 */
export const createPairedPaymentApi = async (payload) => {
  const response = await axiosPaired.post(`${BASE}/payments`, payload);
  return response.data;
};

/**
 * "Unpair this phone" — revokes this phone's own pairing on the server, so the
 * token is dead everywhere, not just forgotten here. 200 data: {}
 */
export const unpairPairedAppApi = async () => {
  const response = await axiosPaired.post(`${BASE}/unpair`);
  return response.data;
};
