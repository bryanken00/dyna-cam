import { createAxiosInstanceWithInterceptor, userTypeAuth } from "../axios";

const api = createAxiosInstanceWithInterceptor("data", userTypeAuth.admin);

// { pairedApps: [...], pagination }
export const getPairedAppsApi = async (filters = {}) => {
  const response = await api.get("/api/v1/admin/paired-apps", { params: filters });
  return response.data;
};

// { venues: [{ venueId, name, status }] }
export const getPairedAppOptionsApi = async () => {
  const response = await api.get("/api/v1/admin/paired-apps/options");
  return response.data;
};

export const updatePairedAppApi = async (pairedAppId, data) => {
  const response = await api.put(`/api/v1/admin/paired-apps/${pairedAppId}`, data);
  return response.data;
};

// The phone goes back to the pairing screen at its next request
export const revokePairedAppApi = async (pairedAppId) => {
  const response = await api.post(`/api/v1/admin/paired-apps/${pairedAppId}/revoke`);
  return response.data;
};

export const deletePairedAppApi = async (pairedAppId) => {
  const response = await api.delete(`/api/v1/admin/paired-apps/${pairedAppId}`);
  return response.data;
};
