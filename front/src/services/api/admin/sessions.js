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

// CR-018: fix (or clear, with "") the player's email → { session }
export const updateSessionEmailApi = async ({ sessionId, email }) => {
  const response = await api.patch(`/api/v1/admin/sessions/${sessionId}/email`, { email });
  return response.data;
};

// CR-018 (2026-11-20): upload the game's videos to the court's Drive again
// (failed / skipped / never ran) → { session } · 409 court not connected / nothing to upload
export const reuploadSessionDriveApi = async (sessionId) => {
  const response = await api.post(`/api/v1/admin/sessions/${sessionId}/drive-upload`);
  return response.data;
};

// CR-018: email the game's Google Drive link to the player now → { session }
// 409 no email / unpaid / not in Drive yet · 502 SendGrid refused
export const sendSessionDriveEmailApi = async (sessionId) => {
  const response = await api.post(`/api/v1/admin/sessions/${sessionId}/drive-email`);
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
