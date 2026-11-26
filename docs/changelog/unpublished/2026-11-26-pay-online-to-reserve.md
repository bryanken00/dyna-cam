---
type: removed
impact: major
audience: user
ref: CR-046
---

Courts are now paid first to reserve — there's no payment at the counter. Players booking online
always pay online (GCash, Maya or a card); the "At the desk" choice is gone. Staff booking for
someone at the desk send a pay link instead of taking cash: the player pays online from the email
or the link staff share, and the court is released if it isn't paid in time. Staff can still give a
free booking. Bookings already waiting for a desk payment can be paid online from their booking page.
In Admin, **Take payment** and **Online settlement** are gone from Payments, and **Record payment**
is gone from Sessions. Old games and clips that were never paid are now free, so their videos open.

## Dev notes

- Online payment must be on (Xendit keys, or `PAYMENT_SANDBOX=true` for testing): without it nobody
  books online and staff can only make Free bookings.
- back/: `POST /public/book/:bookingToken/bookings` accepts `payMethod: "Online"` only;
  `POST /admin/bookings` accepts `payment: "Hold"` (pay link, 409 when online payment is off) or
  `"Free"` — `"Cash"` and `note` are gone; `POST /admin/bookings/:bookingId/payments` is removed.
  A pay-link hold lasts until `deskHoldMinutes` before the start, or `onlineHoldMinutes` from now for
  a game about to start.
- back/ tests: every test file runs with the built-in test checkout on (`PAYMENT_SANDBOX`), except
  those faking Xendit; `ctx.payBooking(bookingId)` pays a booking online.
- front/: no pay-at-desk choice, Admin "Send a pay link" / "Copy pay link"; the venue setting
  `deskHoldMinutes` is labelled "Pay-link deadline".
- back/: run `npm run db:migrate` — `042_no_counter_payments.sql` makes every remaining Unpaid game and
  clip Free and defaults new games to Free. Removed: `GET /admin/payments/lookup`,
  `POST /admin/payments`, `GET /admin/payments/settlement`. The payments list, options and refund stay.
- back/ tests: `ctx.markGamePaid(sessionId, amount)` stores a game paid in cash before CR-046.
- app/, edge/: no change.
