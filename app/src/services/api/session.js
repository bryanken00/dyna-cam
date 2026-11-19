/**
 * API — The paired device's session (PLAN-002 Phase E)
 * All functions return response.data — the envelope `{ success, message, data }`.
 * Shapes: back/server/src/controllers/v1/app/app.controller.js.
 *
 * Every call goes through the device instance (`Authorization: App
 * <token>`), which also handles "this device was unpaired" — see axios.js.
 *
 * AppSession = { sessionId, courtId, courtName, venueName, startAt, endAt,
 *   status (Scheduled | Recording | Processing | Ready | Failed | Cancelled),
 *   startsInSeconds (> 0 only while Scheduled before its start),
 *   elapsedSeconds, endsInSeconds, durationSeconds, openEnded (CR-005),
 *   uploadPercent (CR-006: 0–100 while the game's file uploads, null before),
 *   shareUrl, failureReason }. Times are Manila wall-clock strings; the
 *   "…Seconds" values are as of the response.
 */
import { createDeviceAxiosInstance } from "./axios";

const axiosDevice = createDeviceAxiosInstance();

const BASE = "/api/v1/app";

/**
 * data: { session: AppSession, live: { hlsUrl, expiresAt } | null,
 *         unpairInSeconds: number | null, device: { pairedAppId, name },
 *         stream: Stream | null }
 *
 * Stream = the player's own live stream of this session (PLAN-002 Phase G):
 *   { platform: "FACEBOOK" | "YOUTUBE" | "OTHER", status: "waiting" (the
 *   session hasn't started recording) | "starting" | "live" | "error",
 *   message, maskedUrl, updatedAt }. null when nobody set one up.
 *
 * `live` is null unless the session is recording AND the venue's recorder box
 * is online with a LAN address. `hlsUrl` is a plain-HTTP link to the box,
 * signed and expiring (≈15 min) — ⚠️ never log it (its `sig` is a secret).
 * On a two-camera court `live.cameras` = [{ camera: 1, hlsUrl }, { camera: 2,
 * hlsUrl }] (CR-007: the Cam 1 | Cam 2 switch); `hlsUrl` is always camera 1.
 * `unpairInSeconds` is set once the session has ended: the 10-minute grace.
 */
export const getDeviceSessionApi = async () => {
  const response = await axiosDevice.get(`${BASE}/session`);
  return response.data;
};

/**
 * Stop recording now — the game so far is saved.
 * 200 data: { session: AppSession, unpairInSeconds } · 409 it isn't recording
 */
export const stopSessionApi = async () => {
  const response = await axiosDevice.post(`${BASE}/session/stop`);
  return response.data;
};

/** "Done": unpair this device on the server. 200. */
export const unpairDeviceApi = async () => {
  const response = await axiosDevice.post(`${BASE}/unpair`);
  return response.data;
};

// ── The player's own live stream (PLAN-002 Phase G) ─────────────────────────

/**
 * A fresh setup link for the player's phone: the device shows it as a QR,
 * the player opens it and pastes their Facebook / YouTube stream key.
 * Each call makes a new code and the previous one stops working (unless a
 * stream was already saved with it).
 * 201 data: { url, expiresAt, expiresInSeconds } · 409 the session has ended
 *
 * ⚠️ `url` carries the code, which is the credential for that page — never
 * log it.
 */
export const createStreamLinkApi = async () => {
  const response = await axiosDevice.post(`${BASE}/session/stream-link`);
  return response.data;
};

/** Stop the player's stream (the recording goes on). 200 data: { stream: null } */
export const stopStreamApi = async () => {
  const response = await axiosDevice.post(`${BASE}/session/stream/stop`);
  return response.data;
};
