/**
 * API — Courts (permission venues / courts)
 * All functions return response.data — the envelope `{ success, message, data }`.
 * Shapes: back/server/src/controllers/v1/admin/courts.controller.js.
 */
import { createAxiosInstanceWithInterceptor } from "./axios";

const axiosDefault = createAxiosInstanceWithInterceptor("data");

const BASE = "/api/v1/admin/courts";

/**
 * params: { page, pageSize (≤100), search, venueId, status }
 * data: { courts: [{ courtId, venueId, venueName, name, camera: { configured,
 *         display }, recorderOnline, qrUrl, buttonCode, stream: { enabled,
 *         configured, watchUrl }, status }], pagination: { total, … } }
 */
export const getCourtsApi = async (params = {}) => {
  const response = await axiosDefault.get(BASE, { params });
  return response.data;
};

/** data: { venues: [{ venueId, name, status }] } */
export const getCourtOptionsApi = async () => {
  const response = await axiosDefault.get(`${BASE}/options`);
  return response.data;
};

/** data: { court } — same shape as a list row */
export const getCourtApi = async (courtId) => {
  const response = await axiosDefault.get(`${BASE}/${courtId}`);
  return response.data;
};
