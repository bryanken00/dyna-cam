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

// The clip locks again
export const refundPaymentApi = async ({ paymentId, note }) => {
  const response = await api.post(
    `/api/v1/admin/payments/${paymentId}/refund`,
    note ? { note } : {},
  );
  return response.data;
};
