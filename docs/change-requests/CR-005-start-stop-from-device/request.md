# CR-005 · Pairing the device starts the game, End game stops it

> **Status:** Done · **Requested:** 2026-11-18 · **Requested by:** bryanken00 · **Size:** M
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [PLAN-002](../../plans/PLAN-002-setup-menu-device-pairing/plan.md) (session device, pairing, booking), [CR-003](../CR-003-whole-game-video-per-camera/request.md) (whole video per camera), [CR-004](../CR-004-players-never-see-parts/request.md) (no 5-minute pieces for players)

## Requested change

> Remove the action that players can stop or start the recording. Once paired, auto start. Once
> End game, auto stop recording.

A game is no longer booked with a start time and a length:

1. Staff create a **game** for a court on the web (no times) and pair the session device.
2. **Pairing starts the recording.** No button for players to start, stop or pause it.
3. **End game** on the device stops the recording and the game is saved as **one video** (per
   camera on a two-camera court). Staff can also **End** it in Admin (CMS).
4. Nothing ends a game by itself.

## Today

- Staff **book** a session: court, a start time (or "Start now") and a length (5 min – 3 h), then
  pair a device with the 6-digit key.
- Recording starts **at the booked start time**, whether or not a device is paired, and stops at
  the booked end.
- The device shows a timer and **Stop recording**, which ends the game early. Staff can **End**
  or **Cancel** it in Admin.
- After the game: one whole video per camera (CR-003), "Saving your game… N of M minutes saved"
  (CR-004).

## Why

The recording should match the actual game: it begins when the device is set up on the court and
ends when the players say they're done, not at times guessed when booking.

## Suggestion

| | Today | Requested |
| --- | --- | --- |
| Staff, on the web | Book court + start time + length, then pair | **New game**: court (+ optional player name/phone), then **Pair a device**. No times. |
| Before a device is paired | Records anyway once the start time comes | **Waiting for a device** — nothing is recorded |
| Pairing the first device | The device shows the session (maybe already recording) | **Recording starts at that moment**; the device shows the timer and the QR |
| More devices paired later | Each shows the session | Same — they don't restart anything |
| Device buttons | Stop recording (= ends the game) | **End game** (with a confirmation) — the only control; no stop/start/pause |
| Staff | End / Cancel | **End** (stop and save) / **Cancel** (only before recording started) |
| Automatic end | At the booked end time | **None** |
| Result | One whole video per camera | Unchanged: one whole video per camera |

### Things to know

- **One game per court at a time.** "New game" on a court that has an open game is refused until
  that game ends.
- **A forgotten game keeps recording.** With no automatic end, a game nobody ends keeps recording
  and keeps filling the recorder box's disk (about 0.5–0.9 GB per camera per hour). The box
  protects itself (below `DISK_CRITICAL_MB` it stops keeping game footage so live recording goes
  on), but the start of a very long game would then be lost. Admin will show how long each game
  has been recording, and highlight long ones, so staff notice. See open questions for a safety
  limit.
- **Booking ahead goes away.** A time-slot booking can't start "on pairing", so New game replaces
  it.
- **Unpairing:** the device unpairs 10 minutes after End game, as today. If the paired device is
  unpaired mid-game (staff, or a lost phone), the game keeps recording until someone ends it — a
  new device can be paired to it.

## Scope

**In**

- Admin → Sessions: **New game** (court, optional player name/phone) instead of booking with
  times; Pair a device; **End**; **Cancel** before recording starts; recording time per game,
  long games highlighted.
- API: games without an end time while recording; recording starts when the first device pairs;
  5-minute pieces while it runs; End from the device or Admin; one open game per court.
- Session device: **End game** replaces Stop recording; no other recording control.
- Recorder box: keeps the open game's footage (expected to work with today's box — to confirm).

**Out**

- Any start/stop/pause for players.
- Booking courts ahead of time.
- 60-second replays (unchanged).

## Acceptance criteria

- A new game shows "Waiting for a device" in Admin, and nothing is recorded.
- Pairing the device starts the recording at once; its timer starts at 0:00.
- The device has no way to stop or pause except **End game**.
- **End game** on the device stops the recording and the player gets one whole video (per camera).
- **End** in Admin does the same; **Cancel** works only before a device was paired.
- A game nobody ends keeps recording (no automatic end), and Admin shows it as long-running.
- Staff can't create a second game on a court with an open game.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Web: Admin → Sessions (New game form, list/detail states, long-running highlight). App: session screen (End game instead of Stop recording; no "Starts at" state). Player's page: "Recording now" until End game (as in CR-004). |
| Data | Migration: a game's end time may be empty while recording; a "waiting for device" state. Existing booked sessions keep working. |
| Build / rollout | App: JavaScript only (over-the-air update). Recorder box: expected unchanged — confirmed in the build (an open game's footage window). Server: migration. |
| Permissions | None new. |
| Existing users | **Changes how staff work**: no more booking with a start time and length. Release impact `major` (replaces the PLAN-002 booking flow; nothing released yet). |
| Size | M: API (open game, start on pairing, end), Admin form and list, app button, tests — about 1–2 days. |

## Open questions

- [x] **Safety limit:** none — only End game / End stop a game (bryanken00: "no action. until
      end game on app. but still staff can end game on cms")
- [x] **Cancel** after recording started: not allowed; End saves it instead (recommended)
- [x] Highlight games recording **3 hours** or more in Admin (recommended)

## Revisions

- 2026-11-18: First version had players start, stop and resume recording in parts. Changed on
  request: no player controls — pairing starts the recording, End game stops it, one video.

## Design notes (as built)

- An open game's `endAt` is a rolling placeholder (`OPEN_GAME_AHEAD_HOURS` = 6 h ahead), moved
  forward whenever parts are made (box polls, pages, the hourly maintenance). Every rule that
  reads a session's window — the recorder box's footage window, pairing keys, streams — keeps
  working, so the recorder box needs **no update**. Admin, the app and the player's page never
  show it (`endAt: null` while open, `openEnded: true`).
- End game (`/app/session/stop`) and End (Admin) set the real end and `openEnded = 0`
  (`endSessionNow`); the last 5-minute piece is cut to it.
- The first `POST /pair/app` on a `Waiting` game sets `startAt` to that moment and `Recording`.
- The API still accepts a booking with times (startNow / startAt + durationMinutes) for older
  clients; Admin only offers New game.

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-18 | "ok implement this now" — no safety limit (as said earlier), the rest as recommended |
| Signed off — Done | bryanken00 | 2026-11-20 | Bulk sign-off by the requester ("check all CR and plan… mark all complete"); acceptance items ticked on that sign-off, not re-checked one by one |
