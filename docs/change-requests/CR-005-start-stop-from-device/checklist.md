# CR-005 · Pairing starts the game, End game stops it — Checklist

> Request: [request.md](request.md)

## Before starting

- [ ] Approved (see request.md → Approval)
- [ ] Open questions answered

## Build

### API (`back/`)

- [ ] Migration: `recording_sessions.endAt` may be NULL while a game records; a `Waiting` status
      (created, no device yet); existing sessions unchanged
- [ ] `POST /admin/sessions`: New game (court, optional player name/phone), status `Waiting`;
      refuse a court with an open game (`Waiting` / `Recording` / `Processing` not yet ended)
- [ ] Pairing (`POST /pair/app`): the first device to pair a `Waiting` game sets
      `startAt = now`, status `Recording`
- [ ] `utils/sessions.js`: an open game's pieces are made up to "now"; End sets `endAt` and
      makes the last piece (`endSessionNow`); no end from the clock
- [ ] Admin End / Cancel rules (Cancel only while `Waiting`); recording time in the list/detail
- [ ] Device `/config` sessions: an open game's window with a rolling end, so the box keeps its
      footage (check the box needs no change)
- [ ] `/app/session`: no "starts in"; End game = today's stop endpoint
- [ ] Safety limit (if chosen): auto End after the venue's limit
- [ ] Tests: waiting game records nothing; pairing starts it; second device doesn't restart; End
      from device and Admin; Cancel only while waiting; one open game per court; old sessions

### App (`app/`)

- [ ] Session screen: **End game** (confirm) instead of Stop recording; drop the "Starts at" state
- [ ] Demo mode fixture
- [ ] `npx expo-doctor@latest && npx expo export --platform android --clear`

### Web (`front/`)

- [ ] Admin → Sessions: New game form (no times), Waiting / Recording states, recording time,
      long-running highlight, End / Cancel rules

## Acceptance

- [ ] New game: "Waiting for a device", nothing recorded
- [ ] Pairing starts recording at once (timer from 0:00)
- [ ] Only End game on the device; no stop/pause
- [ ] End game → one whole video per camera
- [ ] Admin End works; Cancel only before pairing
- [ ] No automatic end (unless a safety limit was chosen); long games highlighted
- [ ] Second game on a busy court refused

## Wrap-up

- [ ] `cd back && npm run lint && npm test` passes
- [ ] `cd front && npm run lint && npm run build` passes
- [ ] `cd app && npx expo-doctor@latest && npx expo export --platform android --clear` passes
- [ ] Recorder box confirmed unchanged (or updated and tested)
- [ ] Migration noted for deploy
- [ ] Changelog entry (`ref: CR-005`, impact `major`)
- [ ] Requester shown the result and signed off
- [ ] `request.md` status set to `Done`
