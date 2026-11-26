/**
 * PLAN-009 Near me — distances on the phone only (the player's location never
 * reaches the API, as on the web's /book, CR-050).
 */

const EARTH_KM = 6371;
const rad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in km between two { latitude, longitude } points. */
export const distanceKm = (a, b) => {
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
};

/** "850 m" · "4.2 km" · "37 km" */
export const formatDistance = (km) => {
  if (!Number.isFinite(km)) return "";
  if (km < 1) return `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
};

/** True when the venue has a pin. */
export const hasPin = (v) => Number.isFinite(v?.latitude) && Number.isFinite(v?.longitude);
