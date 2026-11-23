// PLAN-003 Phase C: the player's booking pages — no login. The venue's online
// booking link (bookingToken) and a booking's own link (manageToken) are the
// credentials; the plain axiosInstance sends no Authorization header.
import axiosInstance from "../axios";

// The venue, its courts (by key), the dates and rules →
// { venue, courts: [{ key, name }], openDays, today, lastDate, rules, payOnline }
export const getBookingPageApi = async (bookingToken) => {
  const response = await axiosInstance.get(`/api/v1/public/book/${bookingToken}`);
  return response.data;
};

// Free hours per court for a date and length →
// { date, durationMinutes, hours, courts: [{ key, name, slots: [{ startTime, available, price }] }] }
export const getAvailabilityApi = async ({ bookingToken, date, durationMinutes }) => {
  const response = await axiosInstance.get(`/api/v1/public/book/${bookingToken}/availability`, {
    params: { date, durationMinutes },
  });
  return response.data;
};

// Book a slot. body: { courtKey, date, startTime, durationMinutes, playerName, phone?, email, payMethod }
// 201 { bookingCode, manageToken, manageUrl, checkoutUrl } — checkoutUrl (Phase F) when
// payMethod is "Online": the Xendit checkout to send the player to
export const createPublicBookingApi = async ({ bookingToken, body }) => {
  const response = await axiosInstance.post(`/api/v1/public/book/${bookingToken}/bookings`, body);
  return response.data;
};

// One booking → { booking }
export const getMyBookingApi = async (manageToken) => {
  const response = await axiosInstance.get(`/api/v1/public/bookings/${manageToken}`);
  return response.data;
};

// Phase D: check this booking in → 201 (or 200 if already in) { shareToken, shareUrl }
export const checkInBookingApi = async (manageToken) => {
  const response = await axiosInstance.post(`/api/v1/public/bookings/${manageToken}/check-in`);
  return response.data;
};

// Phase F: the booking's Xendit checkout → { paid, checkoutUrl } (paid: it turned out to be
// paid already, nothing to open)
export const payBookingOnlineApi = async (manageToken) => {
  const response = await axiosInstance.post(`/api/v1/public/bookings/${manageToken}/pay`);
  return response.data;
};
