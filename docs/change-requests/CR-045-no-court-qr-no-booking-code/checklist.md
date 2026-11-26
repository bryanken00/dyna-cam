# CR-045 · No court QR, no booking code for players — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [ ] Open question answered (booking code in Admin) — kept for now

## Build — API (`back/`)

- [x] Remove `POST /public/courts/:qrToken/check-in` (and its BUG-007 helper) from `public.controller.js`
- [x] `GET /public/courts/:qrToken`: left as it was (other tests and the notice use it; it shows no names or codes)
- [x] Remove `POST /public/bookings/find`, its schema and rate limiter
- [x] Emails (`lib/mailer/templates.js`, `utils/bookingEmails.js`): no booking code row; "how to start
      recording" replaces the QR text; pay-at-desk says to give your name
- [x] Tests: drop court-code check-in and Find my booking tests; check the removed routes 404 and
      the emails carry no code
- [x] `npm run lint` · `npm test` (497 pass; 0 lint errors)

## Build — web (`front/`)

- [x] Booking page: no code card, no QR hints; note on when / how to start recording
- [x] Court page (`/court/:qrToken`): a notice with My games and Book a court
- [x] Remove Find my booking (page, services); `/booking` → `/me/games`
- [x] `/book`: "Already booked?" → My games; How booking works step 3
- [x] Landing page: steps and venue feature text
- [x] Admin: remove the court QR sign section and the printable court sign (page, route, helpers)
- [x] `npm run lint` · `npm run build`

## Acceptance

- [ ] Booking page: no code, no QR; the start-recording button works on the day
- [ ] Emails: no code; confirmation explains starting the camera
- [ ] Old court QR link: notice only, nothing can start
- [ ] `/booking` → My games
- [ ] Admin court: no QR sign; staff can still check a booking in

## Wrap-up

- [x] Docs: root `CLAUDE.md` (court QR / Find my booking lines), cloud runbook go-live checklist
- [x] Changelog entry added (`ref: CR-045`, `impact: major`)
- [ ] Requester shown the result and signed off
- [ ] `request.md` status set to `Done`
