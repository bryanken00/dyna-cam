/**
 * API — Payments, cash at the front desk (permission payments)
 * All functions return response.data — the envelope `{ success, message, data }`.
 * Shapes: back/server/src/controllers/v1/admin/payments.controller.js.
 */
import { createAxiosInstanceWithInterceptor } from "./axios";

const axiosDefault = createAxiosInstanceWithInterceptor("data");

const BASE = "/api/v1/admin/payments";

/**
 * The clip a player wants to pay for. The API ignores case and spaces.
 * data: { clip: { clipId, venueId, venueName, courtName, source, requestedAt,
 *         price, paymentStatus, payCode, status, thumbnailUrl } }
 * 404 when no clip has that code.
 */
export const lookupPaymentApi = async (payCode) => {
  const response = await axiosDefault.get(`${BASE}/lookup`, {
    params: { payCode },
  });
  return response.data;
};

/**
 * Record a cash payment — the clip unlocks.
 * payload: { payCode } or { clipId } (not both), note?
 * data: { paymentId, clipId, amount }
 * 409 when already paid, free, expired or failed.
 */
export const createPaymentApi = async (payload) => {
  const response = await axiosDefault.post(BASE, payload);
  return response.data;
};
