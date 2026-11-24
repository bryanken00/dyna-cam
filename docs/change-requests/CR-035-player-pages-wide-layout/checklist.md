# CR-035 · My booking, game page and venue list use the full screen on desktop — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered

## Build

- [x] My booking (`pages/Public/Booking`): `PublicLayout wide`; two columns from `lg`
- [x] Game page (`pages/Public/Session`): `PublicLayout wide`; live view + videos left, the rest right, from `lg`
- [x] Venue list (`pages/Public/Venues`): `PublicLayout wide`; venue rows left, sidebar right
      (Already booked? + How booking works, the latter wide screens only) from `lg`

## Acceptance

- [x] My booking: two columns on a computer
- [x] Game page: two columns on a computer
- [x] Venue list: venues left, Already booked? + how booking works right, on a computer
- [x] Phone width: each page unchanged

## Wrap-up

- [x] `cd front && npm run lint && npm run build` passes
- [x] Changelog entry added (`ref: CR-035`)
- [x] Requester shown the result and signed off
- [x] `request.md` status set to `Done`
