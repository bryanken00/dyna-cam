# CR-049 · Opening hours past midnight

> **Status:** In progress · **Requested:** 2026-11-26 · **Requested by:** bryanken00 · **Size:** M
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [PLAN-003](../../plans/PLAN-003-court-booking/plan.md) (opening hours, rates), [CR-047](../CR-047-pick-slots-multi-court/request.md) (tap hours), [CR-048](../CR-048-remove-weekly-confirmation/request.md) (week + calendar picker)

## Requested change

> How about like this? 6AM today and close 1AM tomorrow?

A venue can stay open past midnight: for example Monday opens at 6 AM and closes at 1 AM on
Tuesday. Players can book those late hours as part of Monday.

The requester's example (2026-11-26) — every day open 6 AM, closing 1 AM the next day:

| Date | 12 AM – 1 AM | 1 AM – 6 AM | 6 AM – 12 AM |
| --- | --- | --- | --- |
| Nov 26 | open (the end of Nov 25's day) | closed | open (Nov 26's day) |
| Nov 27 | open (the end of Nov 26's day) | closed | open (Nov 27's day) |
| Nov 28 | open (the end of Nov 27's day) | closed | … |

In Setup: every day **Opens 6 AM · Closes 1 AM (next day)**.

## Today

Each day's opening hours must open and close on the same day, ending at Midnight at the latest.
Picking 1 AM as Monday's closing time is refused with "Closes before it opens". A day has only one
opening window, so Tuesday can't add a 12 AM – 1 AM window either.

## Why

Venues run late-night games, and the last hour after midnight belongs to the evening crowd. It
should be bookable from the evening's day, not set up as a separate early-morning opening.

## Scope

**In**

- **Setup → venue → Booking rules → Edit → Opening hours:** the Closes list adds next-day
  choices, up to 24 hours after opening: Monday 6 AM – 1 AM (next day) means Monday 6 AM to
  Tuesday 1 AM; Monday 6 AM – 6 AM (next day) is open round the clock.
- **The next day's opening:** a day can't open before the previous day's late hours end. For
  example, if Monday closes at 1 AM, Tuesday can open at 1 AM at the earliest. Setup greys out the
  clashing times (Tuesday's earlier openings, and Monday's closings past Tuesday's opening) and
  refuses an overlap.
- **Booking page and Move:** Monday's hours run to 1 AM. The after-midnight hours show on Monday,
  labelled with the next day (for example "12 AM · Tue"), and are booked on their real date and
  time. They don't show again under Tuesday.
- **Neighbouring hours** join across midnight: 11 PM + 12 AM on a court is one game (CR-047).
- **The same rule everywhere opening hours count:**
  - staff bookings and moves (games aren't limited by opening hours, as before);
  - the Admin bookings day grid shows Monday's late hours;
  - the TV court board shows them as part of Monday.
- **Prices:** an after-midnight hour is priced like any hour, by the rate that covers its real day
  and time (for example Tuesday 12 AM – 1 AM). Setup warns when an open hour has no rate.

**Out**

- More than one opening window per day.
- A day open longer than 24 hours.
- Rates written as "Monday 6 PM – 1 AM": a rate still runs within one calendar day.

## Acceptance criteria

- Setup lets Monday open 6 AM and close 1 AM (next day). The rules card shows "6 AM – 1 AM (next
  day)".
- Setup refuses Tuesday opening at 12 AM while Monday runs until 1 AM.
- On Monday the booking page offers hours up to 12 AM, and 12 AM shows it's on Tuesday. Booking
  it makes a booking for Tuesday 12 AM – 1 AM.
- Tapping 11 PM and 12 AM on one court books one game, 11 PM – 1 AM.
- The 12 AM hour is priced by the rate that covers Tuesday at 12 AM. With no such rate, it can't be
  booked, and Setup warned about it.
- Staff booking and moving follow the same hours.
- The Admin bookings grid and the TV board show Monday's late hours.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Setup → Booking settings (Opening hours) and the rules card; `/book/…` and Move (court hours); Admin → Bookings (day grid, New booking, Move); TV court board |
| Data | No migration: `venue_hours.closesAt` is a `TIME`, which holds `25:00:00` (1 AM next day). |
| API | Validator: `closesAt` up to `30:00`, and no day overlapping the previous day's late hours. `courtTimeline.withinHours` also checks the previous day's late window. `bookingAvailability` lists the late hours on the evening's day. Admin grid, board and venues list read the late window. Pricing is unchanged (by real day and time). |
| Build / rollout | None (web + API). |
| Permissions | None. |
| Existing users | No change until a venue sets hours past midnight. |
| Size | M: one rule (the previous day's late window) applied in the timeline, availability, grid and board, plus the Setup form. |

## Open questions

Answered 2026-11-26 by bryanken00:

- [x] **Latest closing time:** up to 24 hours after opening — a day may run round the clock
      (6 AM – 6 AM next day).
- [x] **Prices after midnight:** by the hour's real day and time (the rate covering Tue 12 AM);
      rates still run within one calendar day. Setup warns about open hours with no rate.
- [x] **Where the late hours show:** only on the evening's day (Monday, labelled "· Tue"); Tuesday's
      page starts at its own opening.

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-26 | asked directly ("implement this now") |

## Revisions

- 2026-11-26: Created; answered; built. Games (Start a game) were never limited by opening hours,
  so that line was dropped from scope.
- 2026-11-26: Hours that can't be booked say why (bryanken00 asked why unpriced late hours said
  "Taken"): Taken, Closed, Past, or Not open (no price).
