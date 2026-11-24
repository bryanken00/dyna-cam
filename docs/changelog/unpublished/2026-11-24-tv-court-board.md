---
type: added
impact: minor
audience: user
ref: CR-038
---

Venues can put a **TV court board** on a screen: turn it on from the Bookings page (TV board) and
open its link on the TV to show today's courts — free, booked, in play or closed, with a live clock —
without showing anyone's name or booking code and without signing in on the TV.

## Dev notes

- back/: **migration 035** (`venues.displayToken`) — run `npm run db:migrate`.
- back/: `POST` / `DELETE /api/v1/admin/booking-settings/:venueId/display-link` (Bookings write);
  public `GET /api/v1/public/board/:displayToken` (no names, codes, reasons or IDs; tests in
  `tests/court-board.test.js`).
- front/: public page `/board/:displayToken`; a TV board menu on the Bookings toolbar; the day grid
  moved to `components/CourtDayGrid.jsx` with a `display` mode.
