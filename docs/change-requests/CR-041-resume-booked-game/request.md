# CR-041 · Resume a booked game after it was ended early

> **Status:** In progress · **Requested:** 2026-11-24 · **Requested by:** bryanken00 · **Size:** M
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [PLAN-003](../../plans/PLAN-003-court-booking/plan.md) (booking check-in), [CR-028](../CR-028-game-page-device-controls/request.md) (End game on the game page), [CR-034](../CR-034-court-qr-booking-only/request.md) (check in by booking code)

## Requested change

> I have a booking, then I accidentally cancelled my recording. How to resume? Can we add resume?

When a booked game is ended before the booking's time is up, the players can start recording
again for the rest of the time they booked.

## Today

Checking a booking in starts its game, which records until the booked end. If anyone presses
**End game** early (on the game page, the courtside device or in Admin), the recording stops and
the booking counts as played. Typing the booking code at the court QR again says *"This booking
has already been played"*, and Admin has no button for it, so the rest of the paid time can't be
recorded.

Every End game button already asks *"End the game?"* first (game page, courtside device, Admin), so
no confirmation needs adding.

## Why

Players pay for the court time. An accidental tap on End game shouldn't lose the rest of their
recording.

## Scope

**In**

- The ended game's page shows **Resume recording** while the booking still has time left. It starts
  a new recording for the same booking that runs until the booked end, and the page moves to it.
- Typing the booking code at the court QR again does the same (instead of "already played").
- Admin → Bookings → the booking: **Resume recording** while the booking still has time left.
- The earlier game's page links to the resumed one ("Recording continues in a new game").
- The player gets the usual "your game has started" email with the new game's link.

**Out**

- Joining the two parts into one video: each part keeps its own Google Drive video.
- The courtside device: it stays on the game it was paired to; pair it again for the new game.
- Resuming after the booked time is over (that is a new booking or Extend).

## Acceptance criteria

- End a booked game early → its page shows **Resume recording … until <booked end>**. Pressing it
  starts recording again and opens the new game's page.
- After the booked end, no Resume button shows, and the booking code says the time is over.
- At the court QR, the booking code of an ended-early booking starts recording again.
- In Admin → Bookings, an ended-early booking shows **Resume recording**, which starts it again.
- The first game's video is still there, and its page says the recording continues in a new game.
- Pressing Resume twice (or on two phones) starts only one new recording.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Player game page (`/session/:shareToken`), Admin → Bookings detail sheet. Court QR check-in reply. |
| Data | **Migration `039_booking_many_games.sql`**: a booking could have only one game (`uq_sessions_bookingId`); it becomes a plain index so a resumed game (a new `recording_sessions` row with the same `bookingId`) can exist. `bookings.sessionId` moves to the newest game and the booking goes back to `CheckedIn`; every booking → game query already goes through `bookings.sessionId`. Run `npm run db:migrate` on the server when deploying. |
| Build / rollout | No app build, no recorder-box update (the box just records another game). |
| Permissions | Admin uses the existing Bookings **write** (Check in). The player's Resume is under CR-028's rule: anyone holding the game link can use it. |
| Existing users | Additive. A booking code that used to say "already played" now restarts the recording while booked time is left. |
| Size | M: one shared back-end rule, one migration, one new public route, two screens, tests. |

## Open questions

- [x] Resume as a new game or reopen the same one? **New game for the rest of the slot** (bryanken00, 2026-11-24).
- [x] Add a confirm to End game? **Already there** on all three End game buttons; nothing to add.

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-24 | Asked directly ("can we add resume?"); chose "new game, rest of slot" |
