// Player pages — no login. The plain axiosInstance sends no Authorization
// header; the court's QR token is the credential. GETs need no CSRF token. The
// POST is not CSRF-checked by the API today (csrfProtection only guards
// /admin/auth/*); if that ever changes, this instance's response interceptor
// already handles a first-time visitor: on 403 CSRF_VALIDATION_FAILED it
// fetches /api/v1/admin/auth/csrf-token (which sets the cookie) and retries
// once with the same Idempotency-Key.
import axiosInstance from "../axios";

// An old court QR sign's page (CR-045: nothing starts from it — recording starts from
// the player's booking) → { court: { name, venueName, venueLogoUrl, bookingToken, … } }
export const getPublicCourtApi = async (qrToken) => {
  const response = await axiosInstance.get(`/api/v1/public/courts/${qrToken}`);
  return response.data;
};

