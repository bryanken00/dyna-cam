# CR-034 · Court QR is booking-code only (no walk-in games)

> **Status:** Done · **Requested:** 2026-11-24 · **Requested by:** bryanken00 · **Size:** M
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [CR-027](../CR-027-player-start-game-qr/request.md) (player starts a game from the QR — removed here), [PLAN-003](../../plans/PLAN-003-court-booking/plan.md) (court booking, Phase D check-in)

## Requested change

> Can we make here, that this not a field anymore? just input your booking code here

Scanning a court's QR sign only asks for a booking code. The "how long you'll play" and "who's
playing" fields and Start game go away. A game without a booking can't be started from the QR at
all (decided: "Remove walk-ins fully").

## Today

The court's QR page lets anyone start a free game with up to 5 saves: pick a game time, add a
name, phone and email if they like, tap Start game. Only while a booking holds the court does the
page ask for the booking's code instead.

## Why

Court time is sold through bookings now. A free game started from the QR skips the booking and
its payment.

## Scope

**In**

- The court QR page always shows a **Booking code** box and **Check in and start**, plus
  **Book this court** when the venue takes online bookings, Watch live, and the notices (a game
  is on, the camera is offline, the court is booked now).
- Starting a game from the QR without a booking is refused by the server too, not only hidden.
- Wording that tells players to scan and start a game themselves: the printed court sign, the
  court setup page's QR section, and the home page's "how it works" steps.

**Out**

- Staff's New game in Admin → Sessions (unchanged).
- Checking in from a booking's own page (unchanged).
- Games already started from the QR before this change: they keep working and still show as
  started by "Player (QR)".

## Acceptance criteria

- Scanning a court's QR shows only the booking code box (no game time, no name / phone / email,
  no Start game).
- Entering a valid code during the booking's check-in time starts the booked game and opens it.
- A wrong code, or a booking that isn't due yet, shows the reason and starts nothing.
- A player without a booking is pointed to **Book this court** (or the front desk).
- The printed court sign says to scan and enter your booking code.
- Staff can still start a game from Admin → Sessions → New game.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Court QR page; printed court sign; court setup QR section text; home page steps |
| Data | none — no migration. The `startedByPlayer` column stays for past games |
| Build / rollout | Reprint court signs (new instruction line; the QR itself is unchanged) |
| Permissions | none |
| Existing users | **Breaking:** players can no longer start a free game from the QR without a booking; `POST /api/v1/public/courts/:qrToken/games` is gone |
| Size | M — remove one endpoint and its tests, rework the court page, copy in three places |

## Open questions

- [x] Walk-ins without a booking → removed fully; they book the court (online or at the desk)
      first. (bryanken00, 2026-11-24)

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-24 | asked directly; chose "Remove walk-ins fully" |
