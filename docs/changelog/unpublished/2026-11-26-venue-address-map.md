---
type: improved
impact: minor
audience: user
ref: CR-050
---

A venue's address is now picked from the Philippine address list — Region, Province, City or
Municipality and Barangay, plus an optional street — and staff pin the venue on a map (click or drag
the pin; "Open in Google Maps" checks the spot). Players get a **Get directions** link to Google Maps
on the booking page, the venue list and the booking confirmation email, and a **Near me** button on
the venue list sorts the venues by distance from them (their location stays on their phone). Venues saved before keep
their typed address until someone edits them.

## Dev notes

- back/: run `npm run db:migrate` — `048_venue_location.sql` adds `regionCode`, `provinceCode`,
  `cityMunCode`, `barangayCode`, `street`, `latitude`, `longitude` to `venues` (all NULL); `address`
  stays as the built text. Venue create / update / get carry them (pin = both or neither);
  `utils/maps.js` `directionsUrl()` (a keyless Google Maps URL) on the public venue replies and the
  confirmation emails.
- front/: `leaflet` + `react-leaflet` (OpenStreetMap tiles, no key; centring on the picked place uses
  OpenStreetMap's Nominatim search with the place name only); `components/VenueLocationPicker.jsx`;
  `utils/psgc.js` loads `src/assets/address` on demand (barangays in their own chunk).
- back/: `npm run db:data` now runs `db:setup` first (migrations, permissions, super admin), then
  the demo seed, which now builds 15 companies and 28 venues (`scripts/_demo-venues.js`), every
  venue with a real PSGC address and a pin.
- app/, edge/: no change.
