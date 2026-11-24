# CR-038 · A public TV court board for each venue

> **Status:** Done · **Requested:** 2026-11-24 · **Requested by:** bryanken00 · **Size:** M
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [PLAN-003](../../plans/PLAN-003-court-booking/plan.md) (Bookings day view), [CR-031](../CR-031-booking-grid-sticky-now/request.md) (day grid)

## Requested change

> Can we add full screen mode here? That we can display on the screen/tv. On full screen the name
> and booking number is hidden.
>
> Make a public view for that booking list that we can display on TV — not here on CMS.

A public page, opened on a TV at the venue, showing today's courts — when each is booked, in
play, closed or free — the way Admin → Bookings → Day shows them, but never who booked or their
booking code, and without anyone signing in on the TV.

## Today

The day grid exists only in the Admin (Bookings → Day), behind a staff login, with each booking
showing the player's name and booking code.

## Why

Players at the venue can see at a glance which courts are free and when, without staff
answering the same question, without other players' names or codes on show, and without a
staff account left signed in on a TV.

## Scope

**In**

- A **TV court board link** per venue, turned on, opened, copied, replaced or turned off from
  **Admin → Bookings** (a TV board button in the toolbar, for the picked venue) — independent of
  the online booking link.
- The board (`/board/<link>`, no login): the DGSports logo, the venue, today's date and a live
  clock, a legend, then a row per court with the hours across the screen (no scrolling), large
  type, past hours shaded and a line at the current time; each court says what's on it now (in
  play / booked until …, free until …, closed).
- Blocks show only Booked / In play / Played / Closed and their times. **No names, no booking
  codes, no closure reasons, no IDs** — the API never sends them.
- It refreshes every minute, moves to the next day on its own, offers a Full screen button that
  fades away (with the cursor) when the mouse rests, and asks the device to keep the screen on.

**Out**

- A full-screen mode inside the Admin (asked first, then replaced by this request).
- Other days than today; the List view.

## Acceptance criteria

- On Bookings, staff turn on the TV board for the venue and get a link; opening it shows today's courts.
- No player name, booking code or closure reason appears on the board.
- Bookings and games appear as Booked / In play / Played with their times; closures as Closed.
- The clock and the now line move; a new booking appears within a minute.
- After Issue new link or Turn off, the old link says it isn't valid.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Admin → Bookings: TV board button / menu; new public page `/board/:displayToken` |
| Data | **Migration 035**: `venues.displayToken` (nullable, unique) |
| Build / rollout | run `npm run db:migrate` |
| Permissions | Issuing / turning off: Bookings write (as the booking link); the board: no login |
| Existing users | None — new link, off by default |
| Size | M — migration, two admin endpoints, one public endpoint, a page, tests |

## Revisions

- 2026-11-24: first built as a full-screen button inside Admin → Bookings; changed on request
  ("make a public view … not here on CMS") to a public board with its own link. The day grid's
  display mode was kept and shared (`components/CourtDayGrid.jsx`).
- 2026-11-24: "Can we move here the link?" — the TV board link's controls moved from the venue
  page to the Bookings toolbar (a TV board menu for the picked venue).

## Open questions

- [x] A separate link (not the booking link) — so the board works with online booking off and
      each can be replaced alone.

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-24 | asked directly |
