---
type: added
impact: minor
audience: user
ref: CR-041
---

If a booked game is ended early by mistake, players can record the rest of their booked time:
**Resume recording** on the game's page, or typing the booking code at the court QR again. Staff can
do the same from the booking in Admin → Bookings. The part already played keeps its own video, and
its page links to the new one.

## Dev notes

- back/: run `npm run db:migrate` — migration `039_booking_many_games.sql` lets one booking have
  several games (the unique key on `recording_sessions.bookingId` becomes a plain index).
- back/: new `POST /api/v1/public/sessions/:shareToken/resume`; `GET /public/sessions/:shareToken`
  returns `session.resume`; `checkInBooking()` resumes a `CheckedIn`/`Completed` booking whose game
  ended with at least 60 s of booked time left. The court QR check-in now accepts `Completed`
  bookings.
- front/: Resume card on the player's game page; **Resume recording** in the Admin booking sheet.
- No recorder box or app update needed.
