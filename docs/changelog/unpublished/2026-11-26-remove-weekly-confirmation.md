---
type: removed
impact: minor
audience: user
ref: CR-048
---

Players can now book a court any day ahead — there's no longer a limit of 14 days (or whatever the
venue set). Picking a date is easier too: the booking page shows one week at a time with arrows,
and a **Calendar** button to jump to any month. The venue's **Book up to … days ahead** setting is
gone.

## Dev notes

- Takes back CR-043 (weekly schedule confirmation) before it was released: its changelog entry is
  removed from this queue. `utils/scheduleWeeks.js` deleted;
  `POST /admin/booking-settings/:venueId/confirm-week`, `…/unconfirm-week` and
  `GET /admin/booking-settings/schedule-reminders` removed; the settings GET no longer returns
  `schedule`; turning the booking link on confirms nothing.
- back/: no days-ahead limit — online booking, availability and moves refuse only the past; the
  booking page and move replies no longer have `lastDate`; Booking settings ignores and no longer
  returns `bookingDaysAhead`.
- back/: no migration — `venues.scheduleConfirmedUntil` (040) and `venues.bookingDaysAhead` (030)
  stay, unused. The demo seed stops setting them.
- front/: `ScheduleWeekNotice` deleted (Dashboard notice, Setup card, Confirm / Undo); Book up to
  removed from Booking settings; `BookingDateStrip` replaced by `BookingDatePicker` (week with
  ‹ ›, a Calendar popover with a month grid; dayjs + the shadcn Popover, no new dependency) on
  `/book/…` and Move.
- app/, edge/: no change.
