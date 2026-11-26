# CR-048 · Remove the weekly schedule confirmation and the days-ahead limit

> **Status:** In progress · **Requested:** 2026-11-26 · **Requested by:** bryanken00 · **Size:** S
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [CR-043](../CR-043-confirm-weekly-schedule/request.md) (what this takes back), [PLAN-003](../../plans/PLAN-003-court-booking/plan.md) (court booking)

## Requested change

> Remove confirmation "Confirmed through Sun, Dec 6" revert what we change before. the user can book
> anytime anyday

Staff no longer confirm each week's schedule, and there's no limit on how far ahead players book:
players can book online any day the venue is open, from today on (revised 2026-11-26 — "I said
remove the limit").

## Today

Since CR-043, players can book online only up to the last week staff confirmed:
- **Setup → venue → Booking rules** shows "Confirmed through Sun, Dec 6", with **Confirm next week**
  and **Undo confirmation**.
- **The Dashboard** shows a reminder while next week isn't confirmed. It turns to a warning from
  Friday, and red once a week has started unconfirmed.
- **The booking page** says bookings for a week aren't open yet until it's confirmed.
- **A move** into an unconfirmed week is refused.

## Why

The weekly confirmation is an extra step the venue doesn't want: players should be able to book
any open day without waiting for staff.

## Scope

**In**

- Players book and move online on any open day from today on, with the venue's weekly hours and
  prices. No last date.
- Remove the venue's **Book up to … days ahead** setting (Booking settings and the rules card). The
  booking page picks a date one week at a time (‹ ›) with a **Calendar** button for a month view.
- Remove the "Confirmed through …" card, **Confirm next week** and **Undo confirmation** from Setup
  → venue → Booking rules.
- Remove the Dashboard's "Confirm next week's schedule" notice.
- Remove the booking page's "bookings for that week aren't open yet" message.
- Turning on a venue's booking link no longer confirms anything.

**Out**

- Opening hours, prices and court closures: these stay as they are.
- Bookings already made: none change.

## Acceptance criteria

- Setup → venue → Booking rules has no "Confirmed through …" card and no Confirm or Undo buttons;
  its description no longer mentions confirmed weeks.
- The Dashboard has no confirm-schedule notice.
- Booking settings and the rules card have no **Book up to** any more.
- A player can pick any open day, months ahead — a week at a time with ‹ ›, or from the
  **Calendar** — with nothing confirmed.
- A player can move a booking to any open day.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Setup → venue → Booking rules; Dashboard; `/book/…` (more days open); a booking's Move |
| Data | No migration. `venues.scheduleConfirmedUntil` (040) and `venues.bookingDaysAhead` (030) stay in the table, unused. |
| Build / rollout | None (web + API only). |
| Permissions | None. The confirm / undo / reminders endpoints go away with their pages. |
| Existing users | Players can book any day ahead (no 14-day limit). Staff lose the Book up to setting. Staff lose Confirm / Undo and the Dashboard notice. CR-043 never reached a release (its changelog entry is still unpublished), so the release notes simply drop it. |
| Size | S: remove `utils/scheduleWeeks.js` and its uses, three endpoints, one component, and their tests. |

## Open questions

- [x] **Keep *Book up to … days ahead*?** No — removed too (bryanken00, 2026-11-26: "I said remove
      the limit").

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-26 | asked directly ("make a new branch and implement this now") |

## Revisions

- 2026-11-26: Created.
- 2026-11-26: The days-ahead limit is removed as well ("I said remove the limit"): no Book up to
  setting, no last date; the date strips show a month at a time with More dates.
- 2026-11-26: The long date strip became a week picker (‹ ›, Monday to Sunday) with a **Calendar**
  button that opens a month view (bryanken00 picked it over a month grid or a week strip alone).
