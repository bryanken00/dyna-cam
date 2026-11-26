# CR-046 · Pay online to reserve — no payment at the counter — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Decisions: staff send a pay link (no cash anywhere); old desk holds pay online until they end

## Build — API (`back/`)

- [x] `POST /public/book/:bookingToken/bookings`: `payMethod` "Online" only (default); 409 while online payment is off
- [x] `POST /admin/bookings`: `payment` "Hold" (pay link) or "Free"; "Cash" refused (400); a pay link
      needs online payment on (409); `note` and the payments-write check for cash gone
- [x] Pay-link hold: until the venue's pay-by time (`deskHoldMinutes` before the start), or for a game
      about to start, `onlineHoldMinutes` from now (never past its end)
- [x] `POST /admin/bookings/:bookingId/payments` (cash) removed
- [x] Emails: the pay-by email asks to pay online (Pay now), never at the counter
- [x] Tests: the test checkout (`PAYMENT_SANDBOX`) is on in every test file except real-Xendit ones;
      `ctx.payBooking()` pays a booking online; cash and pay-at-desk tests rewritten
- [x] `npm run lint` · `npm test` (497 pass; 0 lint errors)

## Build — web (`front/`)

- [x] `/book/…`: no "At the desk"; always pay online; no online payment → "online booking isn't available"
- [x] Booking page: unpaid bookings say "Pay now to confirm" / pay online by …; no desk wording
- [x] Admin → New booking: **Send a pay link** / **Free**; no Cash, no payment note
- [x] Admin → booking detail: **Copy pay link** instead of Record payment; "Waiting for online payment"
- [x] Booking settings: "Pay-link deadline" / "Pay links due"
- [x] `/book` steps, TV board, printed booking sign, landing page: pay online, no counter
- [x] `npm run lint` · `npm run build`

## Build — added 2026-11-26: Take payment, game Record payment, Online settlement

- [x] Migration `042_no_counter_payments.sql`: remaining Unpaid games and clips → Free; games default Free
- [x] API: removed `GET /admin/payments/lookup`, `POST /admin/payments`, `GET /admin/payments/settlement`
      (and `recordCashPayment`, `recordGamePayment`, their validators); the list, options and refund stay
- [x] Web: Payments page without Take payment / Online settlement; Sessions without Record payment;
      their modals, sheet and services removed
- [x] Tests: `ctx.markGamePaid()` stands in for a game paid in cash before CR-046; payments and
      session-payments tests rewritten (removed routes 404, old payments listed and refundable);
      491 pass, 0 lint errors
- [x] `npm run lint` · `npm run build` (front)

## Acceptance

- [ ] Booking online has no "At the desk"; Book sends the player to pay; unpaid → released after the hold
- [ ] Admin → New booking: no Cash; Send a pay link holds, emails Pay now, turns Paid when paid online
- [ ] No screen records a cash payment for a booking
- [ ] An old desk hold shows Pay now online on its page
- [ ] No email or page says to pay at the front desk (bookings)
- [ ] Payments has no Take payment or Online settlement; Sessions has no Record payment
- [ ] After `npm run db:migrate`, an old unpaid game's page plays its videos

## Wrap-up

- [x] Docs: root `CLAUDE.md`, testing guide
- [ ] Migration 042 applied, or noted as pending for deploy (pending: `npm run db:migrate`)
- [x] Changelog entry added (`ref: CR-046`, `impact: major`)
- [ ] Requester shown the result and signed off
- [ ] `request.md` status set to `Done`
