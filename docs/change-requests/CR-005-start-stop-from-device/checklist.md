# CR-005 · Pairing starts the game, End game stops it — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered

## Build

### API (`back/`)

- [x] Migration `017_open_games`: a `Waiting` status (created, no device yet) and `openEnded`;
      an open game's `endAt` is a rolling placeholder instead of empty (see request.md → Design
      notes); existing sessions unchanged
- [x] `POST /admin/sessions`: New game (court, optional player name/phone), status `Waiting`;
      refuse a court with an open game (`Waiting` / `Recording`, or a booking already started)
- [x] Pairing (`POST /pair/app`): the first device to pair a `Waiting` game sets
      `startAt = now`, status `Recording`
- [x] `utils/sessions.js`: an open game's pieces are made up to "now"; End sets `endAt` and
      makes the last piece (`endSessionNow`); no end from the clock
- [x] Admin End / Cancel rules (Cancel only while `Waiting`); recording time in the list/detail
- [x] Device `/config` sessions: an open game's window with a rolling end, so the box keeps its
      footage (check the box needs no change)
- [x] `/app/session`: no "starts in"; End game = today's stop endpoint
- [x] Safety limit: none chosen (only End game / End)
- [x] Tests: waiting game records nothing; pairing starts it; second device doesn't restart; End
      from device and Admin; Cancel only while waiting; one open game per court; old sessions

### App (`app/`)

- [x] Session screen: **End game** (confirm) instead of Stop recording; drop the "Starts at" state
- [x] Demo mode fixture
- [x] `npx expo export --platform android --clear`

### Web (`front/`)

- [x] Admin → Sessions: New game form (no times), Waiting / Recording states, recording time,
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

- [x] `cd back && npm run lint && npm test` passes
- [x] `cd front && npm run lint && npm run build` passes
- [x] `cd app && npx expo export --platform android --clear` passes (expo-doctor: the same 11
      out-of-date packages as before; no dependency changed)
- [x] Recorder box confirmed unchanged (or updated and tested)
- [x] Migration noted for deploy
- [x] Changelog entry (`ref: CR-005`, impact `major`)
- [ ] Requester shown the result and signed off
- [ ] `request.md` status set to `Done`
