# CR-027 · Players start their own game from the court QR — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered

## Build

First version (separate Start-a-game QR):

- [x] Migration `028_player_start_game.sql`: `courts.startToken` (unique, NULL) and `recording_sessions.startedByPlayer`
- [x] Shared "start a timed game now" helper (`utils/gameStart.js`) used by Admin New game and the player's page
- [x] Admin Sessions: started by "Player (QR)"

Revision (one court QR, no 60-second save):

- [x] Migration `029`: drop `courts.startToken` and `courts.buttonCode`
- [x] Public: `GET /public/courts/:qrToken` → court, busy?, 5 saves; `POST /public/courts/:qrToken/games` starts the game (rate-limited; free, 5 saves, records now); `POST …/clips` removed; `/public/start/*` removed
- [x] Admin courts: start-qr endpoints, `startUrl` and `buttonCode` removed
- [x] Device: `POST /device/buttons/:buttonCode/press` removed (404 → the box drops it); `requestClip` removed
- [x] API tests: player start reworked onto the court QR; button / QR-clip tests removed; tests that needed a clip make one directly
- [x] Front: `/court/:qrToken` is the Start a game page; `/start/*` page and services removed
- [x] Front: Setup › Court — Start-a-game QR and Button sections removed, QR sign wording; venue court list Button column removed; print sign wording
- [x] Front: landing page copy without "60 seconds"
- [x] Docs: CLAUDE.md files describe the court QR as Start a game; no court button

## Acceptance

Covered by `back/tests/player-start-game.test.js` at the API level; still to be clicked through in the running app.

- [ ] Court QR (old sign too) opens the Start a game form
- [ ] No "Save the last 60 seconds" anywhere; no Button section
- [ ] Start game records at once and opens the game page with the live view
- [ ] 5 saves, free, videos open when ready
- [ ] Stops by itself at the end of the game time
- [ ] Busy court: says so, nothing starts
- [ ] Old sign stops working after Issue new code
- [ ] Sessions shows Player (QR), Free, 5 saves

## Wrap-up

- [x] `cd back && npm run lint && npm test` passes
- [x] `cd front && npm run lint && npm run build` passes
- [x] Migration `029` noted as pending (`npm run db:migrate`; `028` is applied in dev, `029` is not)
- [x] Changelog updated (`ref: CR-027`, added/minor); queued entries for the never-published 60-second clips and court button corrected or removed
- [ ] Requester shown the result and signed off
- [ ] `request.md` status set to `Done`
