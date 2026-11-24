# CR-041 · Resume a booked game after it was ended early — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered

## Build

- [x] Migration `039_booking_many_games.sql`: one booking may have several games (unique key → plain index).
- [x] `utils/bookingCheckIn.js`: `checkInBooking` resumes a `CheckedIn`/`Completed` booking whose game has ended while booked time is left (new game from max(now, last game's end) to the booked end; booking → `CheckedIn`, `sessionId` → the new game; `resumed: true`). A game still running → the same game, as before.
- [x] `utils/bookingCheckIn.js`: `resumeOffer()` for the game page (`canResume`, `until`, `continuedShareUrl`).
- [x] Court QR check-in finds `Completed` bookings too.
- [x] `POST /public/sessions/:shareToken/resume` (rate-limited, transaction, recorder must be online) → 201 `{ shareToken, shareUrl }`; GameStarted email.
- [x] `GET /public/sessions/:shareToken` returns `resume`.
- [x] Admin `POST /bookings/:id/check-in` says "Recording resumed" when it resumed.
- [x] Front: game page Resume card + "continues in a new game" link (hooks, service, request).
- [x] Front: Admin booking detail **Resume recording** button.
- [x] Tests: resume from the game page, court QR, Admin; double resume = one game; after the booked end → refused; running game → no resume.

## Acceptance

Covered by `back/tests/booking-resume.test.js` at the API; still to try in the deployed app:

- [ ] End a booked game early → Resume recording … until <end> → new game page, recording.
- [ ] After the booked end, no Resume, and the code says the time is over.
- [ ] Court QR code of an ended-early booking starts recording again.
- [ ] Admin → Bookings → Resume recording works.
- [ ] First game's video still there; its page links to the new game.
- [ ] Resume twice → one new game.

## Wrap-up

- [x] `cd back && npm run lint` passes
- [x] `cd back && npm test` passes
- [x] `cd front && npm run lint && npm run build` passes
- [ ] Migration 039 applied on the server (`cd back && npm run db:migrate`)
- [x] Changelog entry added (`ref: CR-041`)
- [ ] Requester shown the result and signed off
- [ ] `request.md` status set to `Done`
