/**
 * API — the public venue list ("Book a court", CR-030 / CR-050). No login.
 * Returns response.data — the envelope `{ success, message, data }`.
 * Shape: back/server/src/controllers/v1/public/booking.controller.js GET /venues.
 */
import { axiosPublic } from "./axios";

/**
 * 200 data: { venues: [{ name, address, phone, logoUrl, directionsUrl,
 *   bookingToken, bookingUrl (the web booking page), courtCount, latitude, longitude, todayHours: { opensAt, closesAt } | null }],
 *   signInAvailable }
 */
export const getVenuesApi = async () => {
  const response = await axiosPublic.get("/api/v1/public/venues");
  return response.data;
};
