/**
 * CR-050: a venue's map pin → a Google Maps link. These URLs need no API key
 * (Google's "Maps URLs"); only the coordinates go in them.
 */

const pinOf = (latitude, longitude) => {
  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) return null;
  const lat = Number(latitude);
  const lng = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? `${lat},${lng}` : null;
};

/** Directions to the pin (the player's own location is the start), or null without a pin. */
export const directionsUrl = (latitude, longitude) => {
  const pin = pinOf(latitude, longitude);
  return pin ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(pin)}` : null;
};
