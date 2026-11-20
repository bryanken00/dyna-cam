# CR-016 · Game time on New game: starts at once, stops by itself, staff can add time

> **Status:** Done · **Requested:** 2026-11-20 · **Requested by:** bryanken00 · **Size:** M
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [CR-005](../CR-005-start-stop-from-device/request.md) (pairing starts the game, End game stops it — this CR replaces both rules), [CR-013](../CR-013-save-last-minutes/request.md) (Maximum saves on New game), [CR-015](../CR-015-pay-before-download/request.md) (pay at the front desk)

## Requested change

> Add here hour and mins. The new process even no app the recording must still auto start. then
> add auto stop based on hours and mins. Possible mins only if less than hour player ask. Also on
> this session module possible to add additional hours or mins on recording.

1. **New game** gets a **Game time**: hours + minutes (e.g. 1 h 30 m, or just 45 m when the
   player asks for less than an hour).
2. **Creating the game starts the recording right away.** No device has to be paired first —
   pairing the courtside device is still possible, it just doesn't start anything any more.
3. **The recording stops by itself** when the game time runs out, and the game's videos are made
   as they are today. **End game** on the device and **End** in Admin can still stop it early.
4. In **Admin → Sessions**, staff can **Add time** (hours and/or minutes) to a game that is still
   recording; its stop time moves later.

## Today

- **New game** asks for a court, an optional player name/phone, Maximum saves and Free game. It
  has no time.
- The game shows **Waiting for a device** and records nothing until the courtside device is
  paired; pairing starts the recording (CR-005).
- Nothing stops a game by itself — only End game on the device or End in Admin. A forgotten game
  keeps recording.
- There is no way to give a running game more time, because games have no length.

## Why

Courts are rented by time. The recording should follow the time the player paid for, start even
when no phone or tablet is set up at the court, and stop when the rental ends, without anyone
having to press End game. When a player extends their rental, staff add the time instead of
starting a new game.

## How it would work

| | Today (CR-005) | Requested |
| --- | --- | --- |
| New game | Court, player, Maximum saves, Free game | Same **+ Game time (hours, minutes)** |
| After Create game | "Waiting for a device", nothing recorded | **Recording** from that moment |
| Pairing the device | Starts the recording | Shows the game already recording (timer, QR, "Stops by itself at 4:30") |
| Stopping | Only End game / End | **By itself at the end of the game time**, or earlier with End game / End |
| Running long | Admin highlights games over 3 h | Not needed — every game has an end |
| More time | — | **Add time** in Admin → Sessions while recording |
| Cancel | Before a device is paired | Not available — the game records from the start; use **End** |

### Things to know

- **Game time examples:** 1 h 0 m (the default), 1 h 30 m, 2 h, or minutes only (0 h 45 m).
  Minutes are whole minutes. The shortest game is 5 minutes, and New game allows up to 3 hours.
- **Add time limit:** a game can be extended to **6 hours in total**.
- **Paid games:** adding time doesn't change the payment. The game stays Paid, staff collect the
  extra at the desk, and the game's details show how much time was added.
- **5 minutes left:** the courtside device shows a notice when 5 minutes of game time remain. The
  notice goes away if staff add time.
- **Mistakes:** because recording starts on Create game, a game created on the wrong court can't
  be cancelled — staff **End** it (a very short game). See open questions.
- **Videos for an extended game** cover the whole game, start to the new end — one video per
  camera as today.
- **The device:** its screen already says "Stops by itself at …" for a timed game; after Add
  time it shows the new time on its next refresh.

## Scope

**In**

- Admin → Sessions → New game: Game time (hours + minutes), required.
- Creating a game starts its recording at once and sets its stop time.
- Recording stops by itself at the stop time; the game's videos are made as today.
- Admin → Sessions: **Add time** (hours + minutes) on a recording game, with the new stop time
  shown in the list and the game's details.
- End game (device) and End (Admin) keep stopping a game early.
- Pairing a device to a game that is already recording.
- A "5 minutes left" notice on the courtside device.

**Out**

- Adding time from the courtside device or the player's page.
- Taking time away (shortening a game) — End stops it early.
- Re-opening a game that has already stopped.
- Booking a game to start later (still removed, as in CR-005).
- Charging for added time, or making a paid game Unpaid again.
- Cancel after Create game (End it instead).

## Acceptance criteria

- New game has a Game time with hours and minutes, set to 1 h 0 m when the form opens.
- Create game is refused with less than 5 minutes or more than 3 hours.
- A game of 0 h 45 m can be created (minutes only).
- Right after Create game, with no device paired, the game shows **Recording** in Admin and the
  camera footage is being kept.
- The game stops by itself at its stop time, and its videos are made without anyone pressing End.
- End game on the device, or End in Admin, still stops it early.
- Pairing a device to a recording game shows the running timer and the stop time.
- **Add time** on a recording game moves its stop time later by exactly the time added; the
  device and the player's page show the new time.
- Add time is refused if it would take the game past 6 hours in total.
- Adding time to a paid game leaves it Paid, and its details show the time added.
- With 5 minutes left, the courtside device shows a notice. After Add time, the notice goes away.
- Add time is not offered for a game that has stopped, was cancelled, or is still being processed.
- Staff without permission to create games don't see Add time.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Web: Admin → Sessions — New game drawer (Game time field), list and detail (stop time, **Add time** action + small form). App: session screen already shows "Stops by itself at …" for a timed game. It needs a new **"5 minutes left" notice**, and it must pick up an extended stop time on refresh. Player's page: shows the stop time (existing timed-game display). |
| Data | **One small migration:** `recording_sessions.addedMinutes INT NOT NULL DEFAULT 0` so the game's details can show the time added. Everything else already exists: the timed-game path from PLAN-002 (startAt / endAt, `openEnded = 0`, Scheduled → Recording → Processing by the clock in `advanceSessions`) is still in the API; New game uses it with "start now". Add time moves `endAt`. |
| API | `POST /admin/sessions` — Admin sends `startNow: true` + `durationMinutes`; the validator's 3-hour cap is revisited (open question). New `POST /admin/sessions/:sessionId/extend` `{ minutes }` — only while `Recording` and before `endAt`, same `clips` write permission; tests for Deleted / ended / cancelled → 404/409 and unchanged. The open-game path (court only, starts on pairing) stays for older clients but Admin stops using it. |
| Build / rollout | **Recorder box: no update** — the box doesn't read the stop time; it gets the game's video job when the API ends the game, as today. **App: JavaScript only** (the 5-minutes-left notice, no new native module or permission), so it ships as an over-the-air update with no store build. Server + web deploy. |
| Permissions | None new — Add time uses the same permission as New game / End (`clips` write). |
| Existing users | **Changes how staff work:** recording starts on Create game instead of on pairing, and games stop by themselves. Release impact `major`. Games already open when this ships keep running until End game / End. |
| Size | M: form field, extend endpoint + tests, Add time action/form, list/detail display, the device's 5-minutes-left notice. About 1–2 days. |

## Open questions

- [x] **Longest game time:** New game up to **3 h**; with Add time, up to **6 h** in total
      (bryanken00, 2026-11-20)
- [x] **Default** Game time on New game: **1 h 0 m** (bryanken00, 2026-11-20)
- [x] **Paid game + Add time:** the game **stays Paid**, staff collect the extra at the desk, and
      the added time is shown on the game. No change to CR-015 (bryanken00, 2026-11-20)
- [x] **Created by mistake:** no Cancel. **Only End**, which leaves a very short game (bryanken00,
      2026-11-20)
- [x] **"5 minutes left"** notice on the courtside device: **include it in this CR**
      (bryanken00, 2026-11-20)

## Revisions

- 2026-11-20: Open questions answered: max 3 h on New game and 6 h in total, default 1 h 0 m,
  a paid game stays Paid after Add time, no Cancel after Create game, and the 5-minutes-left
  notice moved into scope.

## Design notes (as built)

- New game uses the API's existing timed path: `startNow: true` + `durationMinutes` now inserts the
  game as `Recording` straight away (`openEnded = 0`, `endAt` = now + game time), and
  `advanceSessions` moves it to `Processing` at `endAt`, as for any timed session. No device is
  needed; pairing one later doesn't restart anything.
- Add time is `POST /admin/sessions/:sessionId/extend` `{ minutes }`: moves `endAt` and adds to
  `addedMinutes` (migration 023), only while `Recording`, before `endAt`, and not for an open
  game. Over 6 h in all → 400; a later booking on the court → 409. Payment untouched.
- The courtside app already polls every 5 s and gets `endsInSeconds`, so an extended stop time
  shows within seconds. The "5 minutes left" notice is `Screens/Session/EndingSoonNotice.js`.
- The recorder box needs no update: it never reads the stop time, and gets the game's video job
  when the API ends the game.
- In the Sessions list, the "Waiting for a device" stat card became "Ending soon" (recording games
  stopping within 10 minutes).

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-20 | "ok implement this now" — open questions answered the same day |
| Signed off — Done | bryanken00 | 2026-11-20 | Bulk sign-off by the requester ("check all CR and plan… mark all complete"); acceptance items ticked on that sign-off, not re-checked one by one |
