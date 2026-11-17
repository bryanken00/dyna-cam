import { createAxiosInstanceWithInterceptor, userTypeAuth } from "../axios";

const api = createAxiosInstanceWithInterceptor("data", userTypeAuth.admin);

/**
 * Pairing keys (PLAN-002). `kind` is "apps" (staff phones — paired_apps) or
 * "recorders" (recorder boxes — venues/devices); each has its own permission.
 */

// { pairingCodes: [{ pairingCodeId, venueId, venueName, name, expiresAt, dateCreated }] }
export const getPairingCodesApi = async (kind) => {
  const response = await api.get(`/api/v1/admin/pairing-codes/${kind}`);
  return response.data;
};

// { venueId, name } → 201 { pairingCodeId, code (6 digits — shown only now), expiresAt }
export const createPairingCodeApi = async (kind, data) => {
  const response = await api.post(`/api/v1/admin/pairing-codes/${kind}`, data);
  return response.data;
};

export const cancelPairingCodeApi = async (kind, pairingCodeId) => {
  const response = await api.delete(
    `/api/v1/admin/pairing-codes/${kind}/${pairingCodeId}`,
  );
  return response.data;
};
