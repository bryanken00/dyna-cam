---
type: added
impact: minor
audience: user
ref: PLAN-003
---

Players can book a court ahead from each venue's own booking link — pick a date, court and time,
then pay online (GCash, Maya or card) or at the front desk. They get an email with a booking code,
a reminder before they play, and their own booking page where they can pay, cancel for a full
refund or move the booking once until the venue's cut-off. At the court they scan the QR and enter
their code, and the camera records exactly their booked time. In Admin, the new Bookings page
shows each day's courts at a glance and handles walk-in and phone bookings, cash payments,
check-in, moves, cancellations and no-shows; each venue sets its opening hours, prices, booking
rules and closures. Players can no longer start a game on a court someone has booked, and
Payments shows each venue's online money for settling up.

## Dev notes

- back/: run `npm run db:migrate` — migrations `030_booking_settings` → `034_booking_cancel_email`
  (venue booking settings, `venue_hours`, `court_rates`, `court_closures`, `bookings`,
  `recording_sessions.bookingId`, `payments` online columns, the `bookings` permission granted to
  the Owner). Give staff roles the `bookings` permission to use Bookings.
- back/: online payment is off until `XENDIT_SECRET_KEY` and `XENDIT_CALLBACK_TOKEN` are set
  (see `.env.example`); in Xendit set the invoice-paid and refund webhooks to
  `<API>/api/v1/webhooks/xendit`. Before going live, confirm in Xendit test mode that refunding an
  invoice works on the account (PLAN-003 open question).
- back/: booking emails need `SENDGRID_API_KEY` (as other emails); `BOOKING_REMINDER_MINUTES`
  (default 120). Optional rate limits: `RATE_LIMIT_PUBLIC_BOOK_POINTS`, `RATE_LIMIT_PUBLIC_PAY_POINTS`,
  `RATE_LIMIT_PUBLIC_CHANGE_POINTS`, `RATE_LIMIT_PUBLIC_CHECKIN_POINTS`.
- back/: `jobs/bookingMaintenance.js` runs every minute (holds, no-shows, completion, reminders).
- front/: new pages `/book/:bookingToken`, `/booking/:manageToken`, Admin → Dyna Cam → Bookings;
  venue page sections for online booking, rules/hours/prices and closures.
- back/ (BUG-007, before release): checking in at the court QR with a real code that can't be
  used there now (too early, another day, over, cancelled, another court) says why (409) instead of
  the wrong-code 404; a code matching nothing at the venue still gets the wrong-code 404.
- front/ (BUG-008, before release): the Sessions page's "Started by Booking …" link opened Page not
  found — `BOOKINGS_PATH` is now `/admin/dyna-cam/bookings`.
- front/ (BUG-009, before release): copy buttons inside drawers and dialogs (e.g. Copy the player's link)
  copied nothing on the plain-http LAN address — `copyText()`'s fallback now works inside a dialog.
