/**
 * API — Recording sessions (permission clips)
 * All functions return response.data — the envelope `{ success, message, data }`.
 * Shapes: back/server/src/controllers/v1/admin/sessions.controller.js.
 */
import { createAxiosInstanceWithInterceptor } from "./axios";

const axiosDefault = createAxiosInstanceWithInterceptor("data");

const BASE = "/api/v1/admin/sessions";

/**
 * params: { page, pageSize (≤100), venueId, courtId, status, search, sortOrder }
 * data: { sessions: [{ sessionId, venueId, venueName, courtId, courtName,
 *         startAt, endAt, playerName, phone, status, failureReason,
 *         durationMinutes, partsTotal, partsReady, shareUrl }], pagination }
 */
export const getSessionsApi = async (params = {}) => {
  const response = await axiosDefault.get(BASE, { params });
  return response.data;
};

/**
 * data: { session: { …list row, parts: [{ clipId, partIndex, windowStartAt,
 *         windowEndAt, durationSeconds, status, failureReason, expiresAt,
 *         videoUrl, downloadUrl, thumbnailUrl }] } }
 */
export const getSessionApi = async (sessionId) => {
  const response = await axiosDefault.get(`${BASE}/${sessionId}`);
  return response.data;
};

/**
 * payload: { courtId, startAt: "YYYY-MM-DD HH:mm" (Manila), durationMinutes
 *            (5–180), playerName?, phone? }
 * data: { sessionId, startAt, endAt, shareUrl }
 */
export const createSessionApi = async (payload) => {
  const response = await axiosDefault.post(BASE, payload);
  return response.data;
};

/** Only a session that hasn't started (409 otherwise). */
export const cancelSessionApi = async (sessionId) => {
  const response = await axiosDefault.post(`${BASE}/${sessionId}/cancel`);
  return response.data;
};

/** Finish a running session now. data: { endAt } */
export const endSessionApi = async (sessionId) => {
  const response = await axiosDefault.post(`${BASE}/${sessionId}/end`);
  return response.data;
};
