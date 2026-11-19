/**
 * API — Pairing a device to a recording session (PLAN-002 Phase E)
 * Returns response.data — the envelope `{ success, message, data }`.
 * Shape: back/server/src/controllers/v1/pairing/pairing.controller.js.
 */
import { axiosPair } from "./axios";

/**
 * Redeem a 6-digit key made for a session on the web. No login — the key is
 * the credential, once. Spaces and dashes in `code` are fine.
 * payload: { code, platform, appVersion }
 * 201 data: { token, device: { pairedAppId, name }, session: AppSession }
 * 400 wrong / expired / used key — or one whose session already ended
 * 429 too many tries, or pairing paused
 *
 * ⚠️ The response holds the device's token — never log it.
 */
export const pairDeviceApi = async (payload) => {
  const response = await axiosPair.post("/api/v1/pair/app", payload);
  return response.data;
};

/**
 * CR-015 Find a game: look a game up by the code it showed (the one the
 * player takes to the front desk). No login. Spaces and lower case are fine.
 * 200 data: { game: { courtName, venueName, startAt, endAt, status,
 *   paymentStatus, paid, shareUrl } } — shareUrl only once it's paid
 * 404 no game has that code · 400 not a code · 429 too many tries
 */
export const findGameApi = async (payCode) => {
  const response = await axiosPair.get(
    `/api/v1/public/games/${encodeURIComponent(payCode)}`,
  );
  return response.data;
};
