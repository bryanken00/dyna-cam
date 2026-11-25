# CR-043 · Confirm each week's schedule before it opens for booking

> **Status:** In progress · **Requested:** 2026-11-25 · **Requested by:** bryanken00 · **Size:** M
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [PLAN-003](../../plans/PLAN-003-court-booking/plan.md) (court booking: rules, hours, rates)

## Requested change

> Can we do this schedules are for the week only? You need to confirm before sched for the next
> week? on dashboard add Notify for this. then changing color warning if less than 3days

A venue's opening hours and prices count for **one week at a time**. Before players can book
next week online, staff look at the schedule (and change it if needed) and press **Confirm**.
The Dashboard reminds them while next week isn't confirmed, and the reminder turns to a warning
when fewer than 3 days are left.

Decided with the requester (2026-11-25):

- **Confirm = one click.** The venue keeps one weekly set of hours and prices (Setup → venue →
  Booking rules, hours and prices). Confirming opens next week with that schedule. A one-off
  change (a holiday, an event) is still a court closure.
- **A week nobody confirmed stays closed online.** Players can't book it until staff confirm. Staff
  can still book at the desk. Bookings already made are kept.

## Today

Players can book any day from today up to the venue's **Book up to … days ahead** (14 by
default), using the weekly hours and prices. Nothing asks staff to check the schedule first.

## Why

The venue wants to look over every week's hours and prices before players can book it, so a
change (a tournament, new prices) is never missed, and wants a clear reminder to do it.

## Scope

**In**

- A week runs **Monday to Sunday**, in the venue's time (Asia/Manila).
- Each venue remembers the last date its schedule is confirmed through (always a Sunday).
- **Confirm next week** (Setup → venue → Booking rules, and on the Dashboard): confirms the
  schedule through the end of next week. If this week wasn't confirmed either, it opens too.
  Only next week can be confirmed. The week after can be confirmed from its Monday before.
- **Players** (booking page, Move): can pick a date only up to the confirmed date, and still no
  further than *Book up to … days ahead*. When nothing more is open, the booking page says
  bookings for that week aren't open yet and shows the venue's phone.
- **Staff** booking at the desk are not limited by it, as with the other online-only rules.
- **Dashboard notice** for each venue with online booking on whose next week isn't confirmed
  (bookings permission; the Confirm button needs bookings write):
  - Monday to Thursday: a plain notice, "Confirm next week's schedule · Dec 1–7 · 5 days left".
  - **Fewer than 3 days before next week starts** (from Friday): warning colour.
  - **This week isn't confirmed** (online booking is closed now): red.
- Turning online booking on for a venue that has never confirmed confirms this week and next, so
  a new booking link works at once.
- At switch-over, every venue counts as confirmed through the end of next week, so nothing
  players can book today closes when this ships.

**Out**

- A different set of hours or prices per week. Use closures for one-offs.
- Emails or texts about confirming. The reminder is on the Dashboard only.
- Confirming more than one week ahead.

## Acceptance criteria

- Setup → venue → Booking rules shows "Confirmed through Sun, Nov 30" and a **Confirm next week**
  button. Pressing it changes the date to the next Sunday, and the button says next week is done.
- With next week not confirmed, a player can't pick any day of next week on the booking page,
  and moving a booking into next week is refused.
- After confirming, the player can pick next week's days, up to *Book up to … days ahead*.
- Staff can still book next week at the desk before it's confirmed.
- The Dashboard shows the notice while next week isn't confirmed: normal Monday to Thursday,
  warning colour from Friday, red once a week has started unconfirmed. Confirm on the notice
  clears it.
- Someone without the bookings permission doesn't see the notice.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Dashboard (new notice); Setup → venue → Booking rules (confirmed-through date, Confirm button); player booking page (dates stop at the confirmed week, "not open yet" message) |
| Data | `venues.scheduleConfirmedUntil DATE NULL` — new migration `040`, backfilled to the end of next week for every venue |
| Build / rollout | None beyond the usual: run `npm run db:migrate` on the server, rebuild the front end |
| Permissions | None new: `bookings` read sees the notice, `bookings` write confirms |
| Existing users | **Behaviour changes for staff and players:** online booking past the confirmed week closes until staff confirm it each week. A release note must say so (`major`). |
| Size | M — one column, one endpoint, the window check in three places, the Dashboard notice and the Setup button |

## Open questions

- [x] What does Confirm do? — One click; one weekly schedule (2026-11-25).
- [x] An unconfirmed week? — Closed online; the desk can still book (2026-11-25).

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-25 | asked directly; both choices above picked by the requester |
