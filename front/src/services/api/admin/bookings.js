import { createAxiosInstanceWithInterceptor, userTypeAuth } from "../axios";

const api = createAxiosInstanceWithInterceptor("data", userTypeAuth.admin);

// PLAN-003: court bookings at the desk

export const getBookingsApi = async (filters = {}) => {
  const response = await api.get("/api/v1/admin/bookings", { params: filters });
  return response.data;
};

export const getBookingOptionsApi = async () => {
  const response = await api.get("/api/v1/admin/bookings/options");
  return response.data;
};

export const getBookingDayApi = async ({ venueId, date }) => {
  const response = await api.get("/api/v1/admin/bookings/day", { params: { venueId, date } });
  return response.data;
};

export const getBookingQuoteApi = async (params) => {
  const response = await api.get("/api/v1/admin/bookings/quote", { params });
  return response.data;
};

export const getBookingByIdApi = async (bookingId) => {
  const response = await api.get(`/api/v1/admin/bookings/${bookingId}`);
  return response.data;
};

export const createBookingApi = async (booking) => {
  const response = await api.post("/api/v1/admin/bookings", booking);
  return response.data;
};

export const moveBookingApi = async (bookingId, move) => {
  const response = await api.put(`/api/v1/admin/bookings/${bookingId}/move`, move);
  return response.data;
};

export const cancelBookingApi = async (bookingId, cancel) => {
  const response = await api.post(`/api/v1/admin/bookings/${bookingId}/cancel`, cancel);
  return response.data;
};

export const markNoShowApi = async (bookingId) => {
  const response = await api.post(`/api/v1/admin/bookings/${bookingId}/no-show`);
  return response.data;
};

export const recordBookingPaymentApi = async (bookingId, payment = {}) => {
  const response = await api.post(`/api/v1/admin/bookings/${bookingId}/payments`, payment);
  return response.data;
};

export const deleteBookingApi = async (bookingId) => {
  const response = await api.delete(`/api/v1/admin/bookings/${bookingId}`);
  return response.data;
};
