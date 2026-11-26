---
type: added
impact: minor
audience: user
ref: CR-049
---

Venues can now stay open past midnight. In the venue's booking settings a day can close the next
morning, for example open 6 AM and close 1 AM (next day), or even round the clock. Players book
those late hours as part of the evening: on Thursday's page the last hour shows as "12 AM · Fri",
and 11 PM plus 12 AM on one court is one game. Each late hour costs the price set for its real day
and time, and the booking settings warn about open hours that have no price. On the booking page,
an hour that can't be booked now says why: Taken, Closed, Past, or Not open.

## Dev notes

- back/: no migration — `venue_hours.closesAt` (TIME) holds `25:00:00`. Booking settings accept a
  closing time up to 24 h after opening and refuse a next day that opens before the late hours end.
- back/: `courtTimeline.withinHours()` also checks the previous day's late window;
  `firstBookableDate()` (last night's date while its late hours run) is the booking page's `today`,
  the availability / create / move date check and the TV board's day. Availability lists late hours
  as `"24:00"`, `"25:00"`… with `nextDay: true`; `toStartLocal()` and the `startTime()` validator
  accept `00:00`–`47:00`. The Admin day and the board run to the day's closing. Unavailable slots
  carry `reason` (`past`, `taken`, `closed`, `noPrice`, `pricier`).
- front/: Setup closing choices "(next day)" up to 24 h after opening, with the same checks; an
  unpriced-hours warning on the rules card; `CourtSlotPicker` shows "12 AM · Fri"; the Book summary
  names the day of a time past midnight; `CourtDayGrid` draws hours past 24 (a late cell opens New
  booking on the next date). Helpers: `formatSlotHour`, `hourMinutes`, `closeHourOptions`.
- app/, edge/: no change.
