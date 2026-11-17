/**
 * API — Clips (permission clips)
 * All functions return response.data — the envelope `{ success, message, data }`.
 * Shapes: back/server/src/controllers/v1/admin/clips.controller.js.
 *
 * videoUrl / downloadUrl / thumbnailUrl are signed RELATIVE links — prefix
 * them with `fileUrl()` from utils/dynaCam.js.
 */
import { createAxiosInstanceWithInterceptor } from "./axios";

const axiosDefault = createAxiosInstanceWithInterceptor("data");

const BASE = "/api/v1/admin/clips";

/**
 * params: { page, pageSize (≤100), venueId, courtId, source, status,
 *           paymentStatus, dateFrom, dateTo ("YYYY-MM-DD"), sortBy, sortOrder }
 * data: { clips: [{ clipId, venueId, venueName, courtId, courtName, source,
 *         sessionId, partIndex, requestedAt, durationSeconds, price,
 *         paymentStatus, payCode, sizeBytes, failureReason, expiresAt, status,
 *         shareUrl, videoUrl, downloadUrl, thumbnailUrl }], pagination }
 */
export const getClipsApi = async (params = {}) => {
  const response = await axiosDefault.get(BASE, { params });
  return response.data;
};

/**
 * data: { venues: [{ venueId, name }], courts: [{ courtId, name, venueId,
 *         venueName, active }] } — `active`: the court can record now
 */
export const getClipOptionsApi = async () => {
  const response = await axiosDefault.get(`${BASE}/options`);
  return response.data;
};

/** data: { clip } — same shape as a list row */
export const getClipApi = async (clipId) => {
  const response = await axiosDefault.get(`${BASE}/${clipId}`);
  return response.data;
};

/**
 * "Save clip now" — the court's last 60 seconds.
 * payload: { courtId }
 * 201 data: { clipId, shareUrl, merged: false }
 * 200 data: { clipId, shareUrl, merged: true } — joined a save made seconds ago
 * 503 code CAMERA_OFFLINE — nothing was saved
 */
export const createClipApi = async (payload) => {
  const response = await axiosDefault.post(BASE, payload);
  return response.data;
};
