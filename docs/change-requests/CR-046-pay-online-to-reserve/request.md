# CR-046 · Pay online to reserve — no payment at the counter

> **Status:** In progress · **Requested:** 2026-11-26 · **Requested by:** bryanken00 · **Size:** M
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [PLAN-003](../../plans/PLAN-003-court-booking/plan.md) (court booking, desk holds, online payment), [PLAN-006](../../plans/PLAN-006-player-google-sign-in/plan.md), [CR-045](../CR-045-no-court-qr-no-booking-code/request.md)

## Requested change

A court is reserved only once it's paid online. Nobody pays at the counter any more: not players
booking online, and not staff booking for someone at the desk.

## Today

- **Players** booking online choose **Pay now** (online checkout) or **At the desk**. At the desk
  holds the court until a set time before the start; the player pays cash at the front desk.
- **Staff** (Admin → Bookings → New booking) choose **Cash** (paid now), **Hold** (pay at the desk
  later) or **Free**, and can **Record payment** (cash) on a held booking.
- Emails and pages tell held bookings to pay at the front desk.

## Why

"No payment at the counter. All is pay first to reserve." (bryanken00)

## Scope

**In**

- **Players:** online booking always pays online. **At the desk** is gone; the booking is held for
  the venue's online hold time while the player pays, then released if unpaid.
- **Staff:** New booking offers **Send a pay link** and **Free** (a comp); Cash is gone.
  - **Send a pay link:** the court is held until the venue's pay-by time before the start. The
    player gets an email with **Pay now**, and staff can show or copy the booking link. Unpaid by
    then, the court is released.
  - **Record payment** (cash) on a booking is gone.
- **Bookings already waiting for a desk payment:** they can still be paid online from their booking
  page until their hold ends, then they're released as today. Staff can't take cash for them.
- **Wording:** emails, the booking page, the booking settings ("Pay-by time" instead of "desk
  hold"), `/book` and the landing page say to pay online.
- **No online payment on a server:** players can't book online, and staff can only make Free
  bookings.

- **Added 2026-11-26 (bryanken00: "remove it now and include online settlement, because all of
  this is now online"):**
  - **Payments → Take payment** is removed: the counter cash screen for clip and game pay codes.
  - **Admin → Sessions → Record payment** (cash for a game) is removed.
  - **Payments → Online settlement** is removed: the per-venue report of online money.
  - **Old unpaid games and clips:** migration `042` makes every one still unpaid **Free**, so their
    videos open (nothing could unlock them any more). New games already start Free.

**Out**

- **Cash payments already recorded:** they stay in the Payments list, and can still be refunded.
- **Refunds:** online refunds, and "repaid by hand" for a refused online refund, are unchanged.

## Acceptance criteria

- Booking online has no "At the desk" choice; Book sends the player to pay, and an unpaid booking
  is released after the hold.
- Admin → New booking has no Cash; "Send a pay link" holds the court, emails the player a Pay now
  link, and the booking turns Paid when they pay online.
- No screen offers to record a cash payment for a booking.
- A booking already waiting for a desk payment shows Pay now online on its page.
- Emails and pages no longer say to pay at the front desk.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Player: booking page (`/book/…`), booking details, emails. Admin: New booking drawer, booking detail (no Record payment), booking settings label; Payments (no Take payment, no Online settlement); Sessions (no Record payment). |
| Data | **Migration `042_no_counter_payments.sql`:** remaining Unpaid games and clips → Free; `recording_sessions.paymentStatus` defaults to Free. `payMethod` values stay; desk holds keep `payMethod = 'Desk'`, meaning "made at the desk". |
| API | `POST /public/book/:bookingToken/bookings` takes `payMethod: "Online"` only. `POST /admin/bookings` takes `payment: "Hold"` (the pay link, 409 when online payment is off) or `"Free"`; `"Cash"` is refused. `POST /admin/bookings/:id/payments` (cash) is removed. Also removed: `GET /admin/payments/lookup`, `POST /admin/payments` (cash for a clip or game) and `GET /admin/payments/settlement`. |
| Build / rollout | Web and API. Online payment (Xendit, or the sandbox for testing) must be on, or nobody can book online. |
| Permissions | None new. |
| Existing users | **Breaking:** players and staff lose pay-at-the-desk and cash. Old desk holds are paid online. |
| Size | M — options removed across the booking flows, wording, and many tests that used cash to make a paid booking. |

## Open questions

- [ ] None blocking (decided 2026-11-26: staff send a pay link, no cash anywhere; old holds pay
      online until they end).

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-26 | Asked directly ("new cr, no payment at the counter") |
