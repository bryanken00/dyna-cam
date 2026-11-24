# CR-038 · A public TV court board for each venue — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered

## Build

- [x] Migration `035_venue_display_token.sql`: `venues.displayToken` (unique)
- [x] Admin `POST` / `DELETE /admin/booking-settings/:venueId/display-link` (Bookings write);
      `GET /admin/booking-settings/:venueId` returns `displayUrl`
- [x] Public `GET /public/board/:displayToken`: today's courts (hashed keys), bookings (Booked /
      In play / Played), games, closures — no names, codes, reasons or IDs
- [x] Tests `back/tests/court-board.test.js`: off by default, write-only, nothing private in the
      reply, staff game, new link / turn off retire the old, deleted venue, malformed link
- [x] Day grid moved to `components/CourtDayGrid.jsx` (Admin Bookings uses it as before) with a
      `display` mode: fits the screen, large type, no clicks, status + time only, court "now" line
- [x] Public page `pages/Public/Board` (`/board/:displayToken`): header, clock, legend, grid; Full
      screen; idle hides controls and cursor; wake lock; refresh every minute
- [x] Bookings toolbar: TV board menu for the picked venue (turn on, open, copy, new link, turn off)
      — moved from the venue page

## Acceptance

- [x] Turn on (Bookings) → link → today's courts
- [x] No names, codes or reasons (API test + page text check)
- [x] Booked / In play / Played / Closed with times
- [x] Clock and now line move; refreshes every minute
- [x] New link / turn off → old link not valid

## Wrap-up

- [x] `cd back && npm run lint && npm test` passes
- [x] `cd front && npm run lint && npm run build` passes
- [x] Migration applied (dev); pending for deploy
- [x] Changelog entry added (`ref: CR-038`)
- [x] Requester shown the result and signed off
- [x] `request.md` status set to `Done`
