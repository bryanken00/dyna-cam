# CR-050 · Venue address from the PH address list, with a map pin — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered

## Build — API (`back/`)

- [x] Migration `048_venue_location.sql`: `regionCode`, `provinceCode`, `cityMunCode`,
      `barangayCode` (VARCHAR, NULL), `street` (VARCHAR(255) NULL), `latitude` DECIMAL(9,6) NULL,
      `longitude` DECIMAL(9,6) NULL
- [x] `venues.validator.js`: the codes (digits), street, latitude (−90…90) / longitude (−180…180),
      both or neither; `address` stays (the built text)
- [x] `venues.controller.js`: create / update / get return the new fields (company scope unchanged)
- [x] Public: booking page, `/public/venues` and the booking page reply carry `directionsUrl`
      (`https://www.google.com/maps/dir/?api=1&destination=lat,lng`) when pinned
- [x] Booking confirmation emails (single and order): **Get directions** link when pinned
- [x] Tests: save / read the location; validation (half a pin, out of range); `directionsUrl` on the
      public replies only with a pin; another company's venue still 404
- [x] `npm run lint` · `npm test` (551 pass; `venue-location.test.js`)

## Build — web (`front/`)

- [x] `leaflet` + `react-leaflet`; a `VenueLocationPicker` component (OpenStreetMap tiles with
      attribution, click / drag pin, centre on the chosen place via Nominatim, lat / long fields,
      Clear pin, Open in Google Maps)
- [x] PSGC helpers: regions / provinces / cities small; barangays loaded on demand (dynamic import)
- [x] `VenueFormDrawer`: Region → Province → City → Barangay → Street (optional), built address,
      the map; edit pre-fills from the saved codes; an old free-text address shown as current
- [x] Get directions: `/book` list, `/book/:token`, `/booking/:token`
- [x] Near me on `/book`: the browser's location (Geolocation API, https only), venues sorted by
      distance with "2.4 km away"; `/public/venues` returns each venue's latitude / longitude; the
      player's location is never sent
- [x] Demo data: the three demo venues have their PSGC address (codes + street) and pins;
      `npm run db:data` now runs `db:setup` first, then the demo seed — 15 companies, 28 venues
      (`scripts/_demo-venues.js`: 13 more companies, 25 venues with real PSGC addresses and pins)
- [x] `npm run lint` · `npm run build` (0 errors; barangays in their own chunk, ~509 KB gzip, loaded on demand)

## Acceptance

- [ ] The cascading lists only offer entries inside the one above
- [ ] City pick moves the map; click / drag sets lat / long; Open in Google Maps works
- [ ] Save and reopen → same choices and pin
- [ ] An existing venue keeps its old address until edited
- [ ] Get directions on the booking page, `/book` and the confirmation email only with a pin
- [ ] Near me sorts `/book` by distance (on https / localhost); refusing location shows a message

## Wrap-up

- [x] Migration noted as pending for deploy (`npm run db:migrate`, 048)
- [x] Changelog entry added (`ref: CR-050`)
- [ ] Requester shown the result and signed off
- [ ] `request.md` status set to `Done`
