import { createAxiosInstanceWithInterceptor, userTypeAuth } from "../axios";

const api = createAxiosInstanceWithInterceptor("data", userTypeAuth.admin);

// { sessions: [{ …, devicesCount }], pagination }
export const getSessionsApi = async (filters = {}) => {
  const response = await api.get("/api/v1/admin/sessions", { params: filters });
  return response.data;
};

// { session: { …, parts: [...], devices: [...], pairingCodes: [...] } }
//   devices: [{ pairedAppId, name, platform, appVersion, lastSeenAt,
//               lastSeenSecondsAgo, status: "Active"|"Revoked" }]
//   pairingCodes: live keys only, never the digits —
//               [{ pairingCodeId, name, expiresAt, expiresInSeconds }]
//   stream: the player's own live stream (Phase G), never the key —
//           { platform, status, message, maskedUrl, layout, updatedAt } | null
export const getSessionByIdApi = async (sessionId) => {
  const response = await api.get(`/api/v1/admin/sessions/${sessionId}`);
  return response.data;
};

// { courtId, startNow?: true, startAt?: "YYYY-MM-DD HH:mm" (Manila, unless startNow),
//   durationMinutes, playerName?, phone?, free?, maxCaptures? }
// CR-016: New game sends startNow + durationMinutes — it records at once.
// → 201 { sessionId, status, startAt, endAt, payCode, shareUrl } · 409 court busy
export const createSessionApi = async (sessionData) => {
  const response = await api.post("/api/v1/admin/sessions", sessionData);
  return response.data;
};

// Only before it starts — 409 otherwise
export const cancelSessionApi = async (sessionId) => {
  const response = await api.post(`/api/v1/admin/sessions/${sessionId}/cancel`);
  return response.data;
};

// CR-016: Add time to a recording game — { minutes } → { session }
// 400 past 6 h in all · 409 if it isn't recording
export const extendSessionApi = async ({ sessionId, minutes }) => {
  const response = await api.post(`/api/v1/admin/sessions/${sessionId}/extend`, {
    minutes,
  });
  return response.data;
};

// Finish a recording session now — 409 if it isn't recording
export const endSessionApi = async (sessionId) => {
  const response = await api.post(`/api/v1/admin/sessions/${sessionId}/end`);
  return response.data;
};

/* ── Session devices (PLAN-002 Phase E) ─────────────────────────────────── */

// { name } → 201 { pairingCodeId, code (6 digits — shown only now), expiresAt,
// expiresInSeconds }. Works 10 min or until the session ends, whichever is
// first · 409 when the session isn't Scheduled or Recording
export const createSessionPairingCodeApi = async (sessionId, data) => {
  const response = await api.post(
    `/api/v1/admin/sessions/${sessionId}/pairing-codes`,
    data,
  );
  return response.data;
};

// Cancel a key nobody has used yet
export const cancelSessionPairingCodeApi = async (sessionId, pairingCodeId) => {
  const response = await api.delete(
    `/api/v1/admin/sessions/${sessionId}/pairing-codes/${pairingCodeId}`,
  );
  return response.data;
};

// The device goes back to "Pair this device" on its next call
export const unpairSessionDeviceApi = async (sessionId, pairedAppId) => {
  const response = await api.post(
    `/api/v1/admin/sessions/${sessionId}/devices/${pairedAppId}/unpair`,
  );
  return response.data;
};

// CR-003: join a camera's whole-game video again after it failed (camera 0, 1 or 2)
export const retrySessionVideoApi = async ({ sessionId, camera }) => {
  const response = await api.post(
    `/api/v1/admin/sessions/${sessionId}/videos/${camera}/retry`,
  );
  return response.data;
};

// Stop the player's own live stream (Phase G)
export const stopSessionStreamApi = async (sessionId) => {
  const response = await api.post(`/api/v1/admin/sessions/${sessionId}/stream/stop`);
  return response.data;
};
