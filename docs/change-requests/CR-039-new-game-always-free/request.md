# CR-039 · No New game in Sessions; a game started by staff is always free

> **Status:** Done · **Requested:** 2026-11-24 · **Requested by:** bryanken00 · **Size:** M
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [CR-015](../CR-015-pay-before-download/request.md) (pay before download), [CR-034](../CR-034-court-qr-booking-only/request.md) (games come from bookings)

## Requested change

> Remove free game checkbox. Make this always no payment here.

Admin → Sessions no longer has **New game**: games start from bookings (a walk-in gets a desk
booking, then Check in). A game created through the API staff used for New game is always
free — no pay code, the player's videos open as soon as they're ready.

> We should remove the new game here.

## Today

New game has a **Free game** checkbox, off by default. Off, the game is unpaid: it gets a pay
code, the court's device and the player's page show that code, and the videos stay locked until
staff record the payment (Admin → Sessions → Record payment). On, the game is free.

## Why

Court time is paid with the booking now (CR-034: a game starts from a booking, or from staff);
charging again per game at the desk isn't how the venue works.

## Scope

**In**

- Sessions: the **New game** button (header and empty list) and its form are removed; the page
  points to Bookings, where games start.
- The create-game API stays (decided: "hide the button only"), and every game it creates —
  recording now, scheduled, or waiting for the court's device — is free, whatever is sent.
- (First step, before the button went: the form's Payment section and Free game checkbox.)

**Out**

- Games already created unpaid: they keep their pay code, and staff can still record their
  payment as today (Record payment, Payments, Find a game on the court's device).
- Court booking payments (online and at the desk) — unchanged.

## Acceptance criteria

- Admin → Sessions has no New game button; it links to Bookings, and an empty list says games
  appear when a booking checks in.
- A game created through the API shows as Free, has no pay code, and its player's page shows the
  videos without asking for payment.
- An older unpaid game can still be marked paid.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Admin → Sessions (New game button and drawer removed) |
| Data | none — no migration |
| Build / rollout | none |
| Permissions | none |
| Existing users | **Breaking for staff:** Sessions can't start a game any more — walk-ins go through a desk booking and Check in; and no new game is "pay at the desk". Old unpaid games are unchanged. |
| Size | M — a small server and form change, but the payment tests built unpaid games through New game and need another way to make one |

## Revisions

- 2026-11-24: "We should remove the new game here" — New game removed from Sessions (button,
  empty-state button, drawer, the front's create service). Asked whether to remove the API too:
  "Hide the button only" — the API stays, always free.

## Open questions

- [x] Keep recording payment for games that are already unpaid → yes, unchanged.
- [x] Remove the create-game API too → no, hide the button only (bryanken00, 2026-11-24).

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-24 | asked directly |
