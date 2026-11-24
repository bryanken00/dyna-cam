# CR-032 · Booking page uses the full screen on desktop

> **Status:** Done · **Requested:** 2026-11-24 · **Requested by:** bryanken00 · **Size:** S
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [PLAN-003](../../plans/PLAN-003-court-booking/plan.md) (court booking), [CR-030](../CR-030-player-booking-entry/request.md) (a way in for players)

## Requested change

> This must be full screen left side the dates, right side the "Who's booking"

On a computer screen, a venue's online booking page should use the whole width: picking the date,
length, court and start time on the left, and the booking summary with the player's details and
the Book button on the right.

## Today

The booking page is one narrow column in the middle of the screen, the same width as on a phone.
On a computer most of the screen is empty, and after picking a time the player has to scroll down
past every slot to reach the name and email fields and the Book button.

## Why

Players booking from a laptop or desktop see the times and the form side by side, without
scrolling between them.

## Scope

**In**

- The venue booking page (the page a venue's booking link opens) on wide screens: dates, length
  and court/start times on the left; the picked time, price, Who's booking, how to pay and the
  Book button on the right, staying in view while the left side scrolls.
- Before a time is picked, the right side says to pick one.
- The left and right cards are always the same height.
- More start times per row on the left when there's room.

**Out**

- Phones and small tablets: they keep today's single column.
- The other player pages (venue list, Find my booking, a booking's own page, court and game pages).
- Any change to what can be booked or how payment works.

## Acceptance criteria

- On a computer screen the booking page fills the width: dates, length and times on the left,
  the booking details and form on the right.
- Picking a time shows it, with its price, at the top of the right side; the form is there
  without scrolling.
- Before a time is picked, the right side says to pick one.
- The two cards start and end at the same height, before and after a time is picked.
- On a phone the page looks and works as before.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Public `/book/:bookingToken` page; the shared public page frame gains a wide option (other public pages unchanged); the shared slot grid can show more columns where a page asks for it |
| Data | none |
| Build / rollout | none (web only) |
| Permissions | none |
| Existing users | Layout only on wide screens; nothing behaves differently |
| Size | S — layout change on one page plus two small shared-component props |

## Revisions

- 2026-11-24: the two cards now match in height ("The Calendar and Who's booking, the card height
  not the same"); the right card stretches and its contents stay in view inside it.

## Open questions

- [x] None.

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-24 | asked directly |
