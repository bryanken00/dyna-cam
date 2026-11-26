# CR-049 · Opening hours past midnight — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered (2026-11-26: up to 24 h after opening; real-time pricing; late
      hours on the evening's day)

## Build — API (`back/`)

- [x] Validator (`booking-settings.validator.js`): `closesAt` after `opensAt` and at most 24 hours
      later (up to `47:00`); a day may not open before the previous day's late hours end (Sunday →
      Monday wraps)
- [x] `courtTimeline.js`: `loadVenueHours` keeps `closesAt` past 1440 minutes; `withinHours`
      accepts a window inside the day's hours or inside the previous day's late hours
- [x] `bookingAvailability.js`: a date's slots run to its `closesAt` (late hours carry their real
      date/time, marked `nextDay`); a date doesn't repeat the previous day's late hours
- [x] Admin bookings day grid and TV board (`board.controller.js`): the day runs to its closing
      (next morning); the board's "today" is last night while its late hours run
      (`firstBookableDate`, also the booking page's `today`, availability and move)
- [x] Booking settings GET returns `closesAt` like `"25:00"` (TIME column); the unpriced-hours
      warning is worked out on the rules card from the hours and rates
- [x] Tests: save 06:00–25:00; overlap with the next day refused; book Monday 12 AM → Tuesday
      00:00–01:00; 11 PM + 12 AM join into one game; priced by Tuesday's rate; no rate → refused;
      staff booking follows the hours (`late-hours.test.js`, 6 tests)
- [x] `npm run lint` · `npm test` (489 pass; 0 lint errors)

## Build — web (`front/`)

- [x] Setup → Opening hours: Closes adds "(next day)" times up to 24 h after Opens; zod refine matches
      the API (open < close, no overlap with the next day); the rules card shows "(next day)"
- [x] Setup: the unpriced-hours warning (rules card)
- [x] Booking page / Move: an hour that can't be picked says why — Taken, Closed, Past or Not open
      (no price) — from the availability's `reason`, instead of "Taken" for all
- [x] Setup: clashing choices are disabled — a day's Opens before the day before's late hours
      end, and a day's next-morning Closes past the next day's opening (the error stays as a backstop)
- [x] `CourtSlotPicker` / Book page: after-midnight hours labelled "· Tue", picked into the right
      date and time; the summary shows "Mon 11 PM – Tue 1 AM"
- [x] Admin bookings grid: the late hours (now line, a late cell opens New booking on the next
      date); New booking / Move pick real dates and times as before
- [x] TV board: the late hours
- [x] `npm run lint` · `npm run build` (0 lint errors)

## Acceptance

- [ ] Monday 6 AM – 1 AM (next day) saves and shows on the rules card
- [ ] Tuesday opening at 12 AM is refused while Monday runs to 1 AM
- [ ] Monday's booking page offers 12 AM (Tue); booking it makes Tue 12 AM – 1 AM
- [ ] 11 PM + 12 AM on one court → one game, 11 PM – 1 AM
- [ ] The 12 AM hour uses Tuesday's rate; with none it can't be booked and Setup warned
- [ ] Staff booking and move follow the same hours
- [ ] Admin grid and TV board show Monday's late hours

## Wrap-up

- [x] No migration (`closesAt` TIME holds `25:00:00`)
- [x] Changelog entry added (`ref: CR-049`)
- [ ] Requester shown the result and signed off
- [ ] `request.md` status set to `Done`
