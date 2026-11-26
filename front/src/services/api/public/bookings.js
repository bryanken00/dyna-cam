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

// Booking a slot needs a signed-in player (PLAN-006): createPlayerBookingApi in ./player.js

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

// Phase H: cancel before the venue's cut-off → { refunded, refundFailed } (pesos);
// 409 past the cut-off or paid in cash at the desk
export const cancelMyBookingApi = async (manageToken) => {
  const response = await axiosInstance.post(`/api/v1/public/bookings/${manageToken}/cancel`);
  return response.data;
};

// Phase H: times this booking can move to on a date →
// { date, today, lastDate, openDays, durationMinutes, maxPrice, hours,
//   courts: [{ key, name, slots: [{ startTime, available, price, current? }] }] }
export const getMoveOptionsApi = async ({ manageToken, date }) => {
  const response = await axiosInstance.get(`/api/v1/public/bookings/${manageToken}/move-options`, {
    params: { date },
  });
  return response.data;
};

// Phase H: move it (once) → { startAt, endAt }. body: { courtKey, date, startTime }
export const moveMyBookingApi = async ({ manageToken, body }) => {
  const response = await axiosInstance.post(`/api/v1/public/bookings/${manageToken}/move`, body);
  return response.data;
};

// CR-030: every venue taking online bookings (the public "Book a court" list) →
// { venues: [{ name, address, phone, logoUrl, bookingToken, courtCount,
//              todayHours: { opensAt, closesAt } | null }] }
export const getPublicVenuesApi = async () => {
  const response = await axiosInstance.get("/api/v1/public/venues");
  return response.data;
};

// CR-030: Find my booking — its code plus the phone or email it was booked with →
// { manageToken, manageUrl }; 404 when nothing matches, 429 after too many tries
export const findMyBookingApi = async ({ bookingCode, contact }) => {
  const response = await axiosInstance.post("/api/v1/public/bookings/find", {
    bookingCode,
    contact,
  });
  return response.data;
};
