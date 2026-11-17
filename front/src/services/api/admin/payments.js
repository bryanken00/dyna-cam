import { createAxiosInstanceWithInterceptor, userTypeAuth } from "../axios";

const api = createAxiosInstanceWithInterceptor("data", userTypeAuth.admin);

// { payments, totals: { today, thisMonth, countToday }, pagination }
export const getPaymentsApi = async (filters = {}) => {
  const response = await api.get("/api/v1/admin/payments", { params: filters });
  return response.data;
};

// { venues: [{ venueId, name, status }] } — the venue filter, under the payments permission
export const getPaymentOptionsApi = async () => {
  const response = await api.get("/api/v1/admin/payments/options");
  return response.data;
};

// { clip: { clipId, venueName, courtName, requestedAt, price, paymentStatus,
//           payCode, status, thumbnailUrl } } · 404 no clip has that code
export const lookupPaymentApi = async (payCode) => {
  const response = await api.get("/api/v1/admin/payments/lookup", {
    params: { payCode },
  });
  return response.data;
};

// { payCode, note? } or { clipId, note? } — cash taken at the desk; the clip unlocks
export const createPaymentApi = async (paymentData) => {
  const response = await api.post("/api/v1/admin/payments", paymentData);
  return response.data;
};

// The clip locks again
export const refundPaymentApi = async ({ paymentId, note }) => {
  const response = await api.post(
    `/api/v1/admin/payments/${paymentId}/refund`,
    note ? { note } : {},
  );
  return response.data;
};
