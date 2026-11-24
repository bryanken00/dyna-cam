---
type: removed
impact: major
audience: user
ref: CR-034
---

Scanning a court's QR sign now only asks for a booking code: players book the court first (online
or at the front desk), then scan and enter their code to start recording. Starting a free game from
the QR without a booking is no longer possible. Staff can still start a game from Admin → Sessions.
Reprint court signs to get the new instruction line (the QR code itself is unchanged).

## Dev notes

- back/: `POST /api/v1/public/courts/:qrToken/games` removed (handler, `startGameSchema`, its
  limiter); `RATE_LIMIT_PUBLIC_START_POINTS` is no longer read. `GET /public/courts/:qrToken` no
  longer returns `freeUntil`; `maxSaves` is now the booked game's limit. Past walk-in games keep
  `startedByPlayer = 1` and still show as "Player (QR)".
- back/tests: `player-start-game.test.js` → `court-qr-page.test.js`; game-page and save-range
  tests start their game through Admin's New game.
- front/: the court page is booking code + Check in and start + Book this court; the start-game
  service and hook are gone. New wording on the printed court sign, the court setup QR section and
  the home page's steps.
