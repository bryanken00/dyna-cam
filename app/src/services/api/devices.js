/**
 * API — Recorder boxes (permission venues / devices). Read-only in the app.
 * All functions return response.data — the envelope `{ success, message, data }`.
 * Shapes: back/server/src/controllers/v1/admin/devices.controller.js.
 */
import { createAxiosInstanceWithInterceptor } from "./axios";

const axiosDefault = createAxiosInstanceWithInterceptor("data");

const BASE = "/api/v1/admin/devices";

/**
 * params: { page, pageSize (≤100), search, venueId, status }
 * data: { devices: [{ deviceId, venueId, venueName, name, status, lastSeenAt,
 *         lastSeenSecondsAgo, agentVersion, online, cameras: [{ courtId,
 *         courtName, status, message }] }], pagination: { total, … } }
 */
export const getDevicesApi = async (params = {}) => {
  const response = await axiosDefault.get(BASE, { params });
  return response.data;
};
