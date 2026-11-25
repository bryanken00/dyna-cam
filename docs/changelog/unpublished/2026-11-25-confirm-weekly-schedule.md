---
type: improved
impact: major
audience: user
ref: CR-043
---

Players now book online one week at a time. Each week, staff confirm next week's hours and prices
(Setup → the venue → Booking rules, or straight from the Dashboard), and only then can players book
it. Until it's confirmed, the Dashboard shows a reminder that turns to a warning when fewer than 3
days are left, and red if a week starts without being confirmed. While nobody has booked next
week yet, staff can undo its confirmation. Staff can always book at the front desk, and bookings
already made are kept.

## Dev notes

- back/: run `npm run db:migrate` — migration `040_schedule_confirmed_until.sql` adds
  `venues.scheduleConfirmedUntil` and sets every venue to the end of next week, so nothing closes
  on deploy.
- back/: `utils/scheduleWeeks.js` (Monday–Sunday weeks, Manila time); the player's window is
  capped in `utils/bookings.js` (`windowProblem`) and `public/booking.controller.js`
  (`bookableDates`); new `POST /admin/booking-settings/:venueId/confirm-week` (bookings write) and
  `GET /admin/booking-settings/schedule-reminders` (bookings read) and
  `POST /admin/booking-settings/:venueId/unconfirm-week` (bookings write; 409 once next week has
  a live booking); `GET /:venueId` returns `settings.schedule` with `nextWeekBookings`; issuing a booking link confirms a never-confirmed venue through next week.
- front/: `components/ScheduleWeekNotice.jsx` on the Dashboard and in Booking rules; the booking
  page says "Online booking isn't open yet" when no date is open.
- back/: demo data leaves the first venue's next week unconfirmed so the reminder shows.
