// Player pages — no login. The plain axiosInstance sends no Authorization
// header; the court's QR token is the credential. GETs need no CSRF token. The
// POST is not CSRF-checked by the API today (csrfProtection only guards
// /admin/auth/*); if that ever changes, this instance's response interceptor
// already handles a first-time visitor: on 403 CSRF_VALIDATION_FAILED it
// fetches /api/v1/admin/auth/csrf-token (which sets the cookie) and retries
// once with the same Idempotency-Key.
import axiosInstance from "../axios";

// The court's QR page (CR-034: check in with a booking code) →
// { court: { name, venueName, venueLogoUrl, cameraReady, liveWatchUrl, busy, busyUntil, maxSaves } }
export const getPublicCourtApi = async (qrToken) => {
  const response = await axiosInstance.get(`/api/v1/public/courts/${qrToken}`);
  return response.data;
};

// PLAN-003 Phase D: check a booking in at this court with its code.
// body: { bookingCode } → 201 (or 200 if already in) { shareToken, shareUrl }
export const checkInAtCourtApi = async ({ qrToken, bookingCode }) => {
  const response = await axiosInstance.post(`/api/v1/public/courts/${qrToken}/check-in`, {
    bookingCode,
  });
  return response.data;
};
