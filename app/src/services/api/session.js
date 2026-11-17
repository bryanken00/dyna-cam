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
 *   elapsedSeconds, endsInSeconds, durationSeconds, partsReady, partsTotal,
 *   shareUrl, failureReason }. Times are Manila wall-clock strings; the
 *   "…Seconds" values are as of the response.
 */
import { createDeviceAxiosInstance } from "./axios";

const axiosDevice = createDeviceAxiosInstance();

const BASE = "/api/v1/app";

/**
 * data: { session: AppSession, live: { hlsUrl, expiresAt } | null,
 *         unpairInSeconds: number | null, device: { pairedAppId, name } }
 *
 * `live` is null unless the session is recording AND the venue's recorder box
 * is online with a LAN address. `hlsUrl` is a plain-HTTP link to the box,
 * signed and expiring (≈15 min) — ⚠️ never log it (its `sig` is a secret).
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
