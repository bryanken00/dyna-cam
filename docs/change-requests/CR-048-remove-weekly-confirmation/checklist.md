# CR-048 · Remove the weekly schedule confirmation and the days-ahead limit — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered (the days-ahead limit goes too)

## Build — API (`back/`)

- [x] `utils/bookings.js` `onlineRules` / `playerMoveRules`: no confirmed-week check; stop selecting
      `scheduleConfirmedUntil`
- [x] `public/booking.controller.js` `bookableDates`: the last date is today + `bookingDaysAhead` only
      (page, availability, move); stop selecting `scheduleConfirmedUntil`
- [x] `admin/booking-settings.controller.js`: remove `confirm-week`, `unconfirm-week`,
      `schedule-reminders` and their routes; the GET drops the schedule fields; turning on the link
      confirms nothing
- [x] Delete `utils/scheduleWeeks.js`
- [x] No days-ahead limit: `onlineRules` / `playerMoveRules` / `dateProblem` refuse only the past; the
      page and move replies drop `lastDate`; Booking settings ignores and stops returning
      `bookingDaysAhead`; the demo seed stops setting it
- [x] Demo data (`scripts/seed-demo-data.js`): stop setting `scheduleConfirmedUntil`
- [x] Tests: delete `schedule-weeks.test.js`; drop the confirm calls / expectations from other tests
- [x] `npm run lint` · `npm test` (483 pass — the 15 schedule-weeks tests are gone; 0 lint errors)

## Build — web (`front/`)

- [x] Delete `components/ScheduleWeekNotice.jsx`; remove the notice from the Dashboard (hooks + page)
- [x] Setup → Booking rules: remove the confirmed-week card, Confirm and Undo (`bookingHooks.jsx`,
      `BookingRulesSection.jsx`, `index.jsx`) and the "one confirmed week at a time" wording
- [x] Services: remove the confirm / undo / reminders API and request hooks
- [x] `/book/…`: remove the "bookings for that week aren't open yet" message
- [x] Book up to removed from Booking settings and the rules card
- [x] `BookingDatePicker` replaces `BookingDateStrip` on `/book/…` and Move: a week (Mon–Sun) with
      ‹ ›, the month label, and a **Calendar** popover (month grid); past and closed days can't be
      picked; the week follows the picked date
- [x] `npm run lint` · `npm run build` (0 lint errors)

## Acceptance

- [ ] No confirmed-week card, Confirm or Undo in Setup → Booking rules
- [ ] No confirm-schedule notice on the Dashboard
- [ ] No Book up to in Booking settings or the rules card
- [ ] A player can pick any open day months ahead (‹ › or Calendar), with nothing confirmed
- [ ] The week picker fits a phone screen (no sideways scrolling)
- [ ] A move to any open day works

## Wrap-up

- [x] No migration (`scheduleConfirmedUntil` and `bookingDaysAhead` stay, unused)
- [x] CR-043 marked as taken back by CR-048; its unpublished changelog entry removed
- [x] Changelog entry added (`ref: CR-048`)
- [x] CLAUDE.md: drop the CR-043 note
- [ ] Requester shown the result and signed off
- [ ] `request.md` status set to `Done`
