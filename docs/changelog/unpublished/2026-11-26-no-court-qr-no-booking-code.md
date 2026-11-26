---
type: removed
impact: major
audience: user
ref: CR-045
---

Courts no longer have a QR sign for the camera, and players no longer need a booking code. To start
recording, a player opens their booking (from **My games** or the link in their confirmation email)
and taps **I'm at the court — start recording**. Booking emails explain this and no longer show a
code. **Find my booking** is gone: signed-in players find all their bookings in My games. An old
court QR sign now opens a page that points players to their booking.

## Dev notes

- back/: removed `POST /api/v1/public/courts/:qrToken/check-in` and `POST /api/v1/public/bookings/find`
  (and `RATE_LIMIT_PUBLIC_CHECKIN_POINTS`, `RATE_LIMIT_COURT_CHECKIN_POINTS`,
  `RATE_LIMIT_PUBLIC_FIND_POINTS` are no longer read). `GET /public/courts/:qrToken` is unchanged
  (old signs). The booking page's check-in now says "Recording resumed" when it resumes an
  ended-early booking (CR-041).
- back/: booking emails no longer show the booking code; the code stays in the database, in Admin
  and on Xendit invoices.
- front/: `/booking` redirects to `/me/games`; `/court/:qrToken` is a notice; Admin → court setup
  has no QR sign section, the venue's court menu has no Print QR sign / Copy player link, and the
  printable court sign page is gone. Printed court QR signs can come down.
- app/, edge/: no change.
