# CR-030 · A way in for players to book a court — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered (none block the build; the opt-out is left open)

## Build

- [x] API `GET /public/venues`: Active venues with a booking link and at least one Active court →
      name, address, phone, signed logo, booking token, court count, today's hours; no business IDs
- [x] API `POST /public/bookings/find` `{ bookingCode, contact }`: code plus the booking's phone
      (any accepted format) or email → `{ manageToken }`; one 404 message for every miss;
      rate-limited per IP (`RATE_LIMIT_PUBLIC_FIND_POINTS`)
- [x] API `GET /public/courts/:qrToken` adds `bookingToken` (null when the venue's booking is off)
- [x] Tests for all three (listing rules, find by phone / email / wrong contact / deleted, court link);
      the rate limit in its own file (`tests/booking-find-limit.test.js`)
- [x] Front services + React Query hooks for the two new endpoints
- [x] `/book` page: venues with a text filter, each card opening `/book/:bookingToken`, and a
      Find my booking link
- [x] `/booking` page: Find my booking form → `/booking/:manageToken`
- [x] Home page: Book a court in the top bar and as the hero's main button
- [x] Court QR page: Book this court ahead when `bookingToken` is set
- [x] Booking page's "link not valid" state links to Find my booking; the public top bar's name
      links home

## Acceptance

- [ ] Home → Book a court lists only venues taking online bookings; a venue opens its booking page
- [ ] Court QR page shows Book this court ahead only when its venue takes online bookings
- [x] Find my booking works with code + phone and code + email; a miss shows one message (API tests)
- [x] Too many tries are refused (API test)

## Wrap-up

- [x] `cd back && npm run lint && npm test` passes (446/446)
- [x] `cd front && npm run lint && npm run build` passes
- [x] Changelog entry added (`ref: CR-030`)
- [ ] Requester shown the result and signed off
- [ ] `request.md` status set to `Done`
