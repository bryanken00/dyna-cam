# CR-043 · Confirm each week's schedule before it opens for booking — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered

## Build

- [x] Migration `040_schedule_confirmed_until.sql`: `venues.scheduleConfirmedUntil DATE NULL`, backfilled to the end of next week
- [x] `utils/scheduleWeeks.js`: week maths (Monday–Sunday, Manila), the player's last bookable date, the notice level
- [x] Player window: `utils/bookings.js` `onlineRules` + `playerMoveRules`, `public/booking.controller.js` `bookableDates` (page, availability, move) — the confirmed date caps it
- [x] `POST /admin/booking-settings/:venueId/confirm-week` (bookings write) and the setting in `GET /:venueId`
- [x] `POST /:venueId/link` confirms this week and next when the venue never confirmed
- [x] `GET /admin/booking-settings/schedule-reminders` (bookings read): venues with online booking on whose next week isn't confirmed, with the level
- [x] Demo data (`scripts/seed-demo-data.js`) confirms its venues
- [x] Tests: confirm-week, the player window before/after, desk still books, reminders, 404 for a Deleted venue
- [x] Front: Booking rules section shows the date and Confirm next week
- [x] Front: Dashboard notice (plain / warning / red) with Confirm
- [x] Front: booking page message when no date is open

## Acceptance

- [ ] Setup shows the confirmed date; Confirm moves it to the next Sunday
- [x] Next week can't be booked or moved into online before it's confirmed (tested)
- [ ] After confirming, next week's days can be picked (up to the days-ahead rule)
- [x] The desk can book next week before it's confirmed (tested)
- [ ] Dashboard notice: plain Mon–Thu, warning from Friday, red when a week started unconfirmed; Confirm clears it
- [x] No notice without the bookings permission (tested: 403)

## Wrap-up

- [x] `cd back && npm run lint && npm test` passes
- [x] `cd front && npm run lint && npm run build` passes
- [x] Migration 040 noted as pending for deploy
- [x] Changelog entry added (`ref: CR-043`, major)
- [ ] Requester shown the result and signed off
- [ ] `request.md` status set to `Done`
