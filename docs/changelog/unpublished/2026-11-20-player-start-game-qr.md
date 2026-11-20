---
type: added
impact: minor
audience: user
ref: CR-027
---

Players can start their own game. They scan the court's QR sign, pick how long they'll play,
optionally add their name, phone and email, and tap Start game. The cameras record the whole game
straight away, it stops by itself when the time is up, and the player lands on their game's page
with the live view. These games are free (the court is paid with its reservation) and allow up to
5 saves. If the court already has a game, the page says until when. In Sessions, these games show
as started by "Player (QR)".

## Dev notes

- back/: run `npm run db:migrate` — `028_player_start_game.sql` adds
  `recording_sessions.startedByPlayer` (and a `courts.startToken` that `029` drops again).
- back/: `GET /api/v1/public/courts/:qrToken` now describes the court for starting a game
  (`busy`, `busyUntil`, `maxSaves`); `POST /api/v1/public/courts/:qrToken/games` starts one
  (no login, rate-limited per IP by the optional `RATE_LIMIT_PUBLIC_START_POINTS`, default 5/min).
- back/: Admin New game and the player's start share `utils/gameStart.js` (`bookCourt`).
- front/: `/court/:qrToken` is the Start a game page; `GameTimeFields` moved to `src/components/`.
- No app build or recorder-box update needed.
