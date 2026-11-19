---
type: added
impact: minor
audience: user
ref: CR-013
---

Players can now save the last few minutes of their game from the courtside device: slide to pick
how much — in 15-second steps from 1 minute up to the time played so far — and tap Save. Each save becomes its own
video — one per camera on two-camera courts — on the game's page, ready in a few minutes. It's
free with the game, up to 5 saves per game. Saves are made one at a time — a new one shows "In
queue" until its turn — and each can be deleted. The whole-game video still arrives after End game.

## Dev notes

- back/: run `npm run db:migrate` (migration `020_session_captures.sql`: `session_captures`,
  `session_videos.captureId` and a new unique key). Optional `.env`: `CAPTURE_MAX_PER_GAME` (5).
- back/: `POST /api/v1/app/session/captures { seconds }`, `DELETE /app/session/captures/:captureId`; `GET /app/session`, the public game page
  and Admin session detail list `captures`; `/device/jobs` gives a save's own window. Whole-game
  logic (settling, counts, retry, upload %) ignores saves.
- edge/: no change — a save is an ordinary game job over a shorter window (boxes need CR-006).
- app/: game screen "Save the last …" (JavaScript only, next app update).
- front/: "Your saves" on the player's game page; saves in Admin → Sessions.
