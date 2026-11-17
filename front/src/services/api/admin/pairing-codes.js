import { createAxiosInstanceWithInterceptor, userTypeAuth } from "../axios";

const api = createAxiosInstanceWithInterceptor("data", userTypeAuth.admin);

/**
 * Recorder box pairing keys (PLAN-002) — venues/devices permission. Keys that
 * pair a phone or tablet to a session live under sessions.js (Phase E).
 */

// { pairingCodes: [{ pairingCodeId, venueId, venueName, name, expiresAt, dateCreated }] }
export const getPairingCodesApi = async () => {
  const response = await api.get("/api/v1/admin/pairing-codes/recorders");
  return response.data;
};

// { venueId, name } → 201 { pairingCodeId, code (6 digits — shown only now), expiresAt }
export const createPairingCodeApi = async (data) => {
  const response = await api.post("/api/v1/admin/pairing-codes/recorders", data);
  return response.data;
};

export const cancelPairingCodeApi = async (pairingCodeId) => {
  const response = await api.delete(
    `/api/v1/admin/pairing-codes/recorders/${pairingCodeId}`,
  );
  return response.data;
};
