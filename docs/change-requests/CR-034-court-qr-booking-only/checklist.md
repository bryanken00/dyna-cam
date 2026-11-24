# CR-034 · Court QR is booking-code only (no walk-in games) — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered

## Build

- [x] API: remove `POST /public/courts/:qrToken/games` (handler, `startGameSchema`, its limiter
      and `RATE_LIMIT_PUBLIC_START_POINTS`)
- [x] API: `GET /public/courts/:qrToken` drops `freeUntil` (and its query)
- [x] Tests: player-start tests replaced by "the route is gone" + the court page still works;
      game-page / save-range helpers start their game through Admin's New game; the bookings
      test for walk-ins in booked time removed
- [x] Front: court page = booking code + Check in and start (+ Book this court, Watch live,
      notices); start-game service and hook removed
- [x] Front copy: court sign, court setup QR section, home page steps
- [x] Docs: root `CLAUDE.md` route summary

## Acceptance

- [x] QR page shows only the booking code box
- [x] Valid code in check-in time starts and opens the game
- [x] Wrong / not-yet code shows why and starts nothing
- [x] No booking → Book this court (or front desk)
- [x] Court sign says scan and enter your booking code
- [x] Admin New game still works

## Wrap-up

- [x] `cd back && npm run lint && npm test` passes
- [x] `cd front && npm run lint && npm run build` passes
- [x] Changelog entry added (`ref: CR-034`, `removed`, major)
- [x] Requester shown the result and signed off
- [x] `request.md` status set to `Done`
