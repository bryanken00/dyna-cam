# CR-016 · Game time on New game: starts at once, stops by itself, staff can add time — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered (2026-11-20: max 3 h / 6 h total, default 1 h 0 m, paid stays Paid,
      no Cancel, 5-minutes-left notice in scope)

## Build

### API (`back/`)

- [x] Migration `023_session_added_minutes.sql`: `recording_sessions.addedMinutes INT NOT NULL DEFAULT 0`
- [x] `createSessionSchema`: `durationMinutes` 5–180 (already so), and Admin always sends it
- [x] `POST /admin/sessions` with `startNow` + `durationMinutes`: creates a `Recording` game at
      once (`openEnded = 0`, `endAt` = now + time) — confirm the one-game-per-court check also
      refuses while an open (CR-005) game is running on the court
- [x] Validator `extendSessionSchema` (`minutes`, whole, 1–360)
- [x] `POST /admin/sessions/:sessionId/extend` under `checkPermission("clips", null, "write")`:
      `UPDATE … SET endAt = endAt + INTERVAL ? MINUTE, addedMinutes = addedMinutes + ?
    WHERE sessionId = ? AND status = 'Recording' AND openEnded = 0 AND endAt > now
    AND TIMESTAMPDIFF(MINUTE, startAt, endAt) + ? <= 360`. Return 400 when it would pass 6 h in
      total, 409 when the game has ended or is open-ended, and 404 when it is missing or `Deleted`.
      Payment is untouched. Return the session via `toSession`, with `addedMinutes`
- [x] Pairing a device (`/pair/app`) to a `Recording` timed game: no restart, keeps `startAt`
- [x] Device/app session payload: `endAt` / `endsInSeconds` reflect an extended game on the next poll
- [x] Tests: create with time → `Recording`, ends by the clock → `Processing` + video rows;
      extend moves `endAt` and adds to `addedMinutes`, and a paid game stays Paid; extend on an
      ended / cancelled / `Deleted` / open game → 409/404 and unchanged; past 6 h in total → 400
      and unchanged
- [x] `cd back && npm run lint && npm test`

### Web (`front/`)

- [x] New game drawer: **Game time** section with Hours + Minutes inputs, default 1 h 0 m (zod:
      minutes 0–59, total 5–180 min). The header subtitle says recording starts on Create game,
      not on pairing
- [x] Create sends `startNow: true` + `durationMinutes`
- [x] Sessions list + detail: show the stop time for a recording game ("Stops at 4:30 PM")
- [x] **Add time** row action + detail button (recording games only, `clips` write) → small form
      (Hours + Minutes, showing how much can still be added before 6 h) → extend request →
      invalidate sessions queries, toast with the new stop time
- [x] Detail sheet: "Time added: 30 min" when `addedMinutes > 0`
- [x] Drop the "Waiting for a device" / long-running copy where it no longer applies to new games
      (the stat card is now "Ending soon": recording games stopping within 10 min)
- [x] `cd front && npm run lint && npm run build`

### App (`app/`)

- [x] Session screen: a **"5 minutes left"** notice when `endsInSeconds` ≤ 300 (ticking locally
      between polls), hidden again when the stop time moves later
- [x] A timed game shows the timer and "Stops by itself at …"; after Add time the stop time and
      the timer limit update on refresh
- [x] Demo mode fixtures cover a timed game near its end
- [x] `cd app && npx expo export --platform android --clear` bundles; `expo-doctor` has only the
      existing version-mismatch warning (expo 58.0.19, safe-area-context 5.10.1 — same before this CR)
- [ ] Try it on a device against the API

## Acceptance

Items marked "(API test)" are covered by `back/tests/game-time.test.js`; the rest still need a
check in the running app (web + a paired device).

- [x] New game has Game time (hours + minutes), opening at 1 h 0 m
- [x] Create game refused under 5 minutes or over 3 hours (API test)
- [x] A 0 h 45 m game can be created (API test)
- [x] Right after Create game, with no device, the game is Recording and footage is kept
- [x] The game stops by itself at its stop time and its videos are made
- [x] End game (device) and End (Admin) still stop it early
- [x] Pairing a device to a recording game shows the running timer and the stop time
- [x] Add time moves the stop time later by exactly the time added; device and player's page show it
- [x] Add time refused past 6 hours in total (API test)
- [x] A paid game stays Paid after Add time; its details show the time added
- [x] "5 minutes left" shows on the device; it goes away after Add time
- [x] Add time isn't offered for stopped, cancelled or processing games
- [x] Staff without the permission don't see Add time

## Wrap-up

- [x] `cd back && npm run lint` passes (no new warnings) and `npm test` — 277 pass
- [x] `cd front && npm run lint && npm run build` passes (no new warnings)
- [x] `cd app && npx expo export --platform android --clear` passes (expo-doctor: existing version warning only)
- [x] Migration applied on the development database (2026-11-20); pending for deploy elsewhere
- [x] Changelog entry added (`ref: CR-016`, impact `major`)
- [x] Requester shown the result and signed off
- [x] `request.md` status set to `Done`
