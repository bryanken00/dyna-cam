# PLAN-007 · Booking orders: several courts in one payment, and the running hour

> **Status:** In progress · **Created:** 2026-11-26 · **Owner:** bryanken00 · **Checklist:** [../../change-requests/CR-047-pick-slots-multi-court/checklist.md](../../change-requests/CR-047-pick-slots-multi-court/checklist.md)
> **Related:** [CR-047](../../change-requests/CR-047-pick-slots-multi-court/request.md) (the request and its decisions), [PLAN-003](../PLAN-003-court-booking/plan.md) (booking, Xendit), [CR-046](../../change-requests/CR-046-pay-online-to-reserve/request.md)

## Goal

How to build CR-047: a player taps hours on one or more courts for one day and pays once. Neighbouring
hours on a court join into one booking, and the hour that's running can be booked during its first
half.

## Context

- **A checkout pays for one booking.** Each checkout is one Xendit invoice, and the payment is
  confirmed per booking ([utils/bookingPayments.js](../../../back/server/src/utils/bookingPayments.js)):
  - `openCheckout` creates the invoice;
  - the invoice is named `booking-<code>`;
  - `settleInvoice` confirms the payment;
  - refunds use each payment's own amount, so partial refunds already work.
- **Bookings are written one at a time.** `createBooking` in
  [utils/bookings.js](../../../back/server/src/utils/bookings.js) locks the court and refuses an hour
  that has started (`onlineRules`). The online hold never runs past the booking's start
  (`onlineHoldUntil`).
- **Availability is per length.** It's worked out for one length at a time and never includes the
  running hour
  ([utils/bookingAvailability.js](../../../back/server/src/utils/bookingAvailability.js)).

## Approach

### Data — migration `043_booking_orders.sql`

- **`booking_orders`:** `orderId`, a unique `orderCode` (the invoice reference), `venueId`,
  `playerId`, the `amount` when made, `status` (`Active`, `Deleted`), and the dates.
- **`bookings.orderId`:** NULL, with an index and a FK. It's NULL for single bookings and staff
  bookings, and a booking never leaves its order.
- **`payments`:** the UNIQUE on `providerRef` becomes UNIQUE (`providerRef`, `bookingId`). An order's
  invoice pays several bookings, one payment row each.

### Booking

- **Request body:** `POST /public/book/:token/bookings` takes `{ date, slots: [{ courtKey,
  startTime }], phone?, payMethod }`. The old single shape (`courtKey`, `startTime`,
  `durationMinutes`) still works.
- **Grouping:** slots are grouped by court, sorted, and neighbouring hours joined into runs. A run can be
  any length inside the opening hours (no longest booking), and only one date is allowed.
- **One transaction:** runs are written in (courtId, start) order, each through `createBooking` with
  `source: "Online"`. More than one run makes an order row and sets `bookings.orderId`. Every
  booking in an order gets the earliest hold among them, so they expire together. Any refusal rolls
  everything back, and the 409 / 400 names the slot ("Court 2 at 6 PM: …").
- **After commit:** one run opens a checkout as today. An order opens `openOrderCheckout` (the
  `order-<orderCode>` invoice, for the total of its unpaid bookings, lasting until their hold), and
  stores the same `checkoutId` / `checkoutUrl` on each. Payment returns to the first booking's page,
  whose poll settles the invoice. If the checkout fails, every hold in the order is released.

### The running hour

- `RUNNING_HOUR_BOOKABLE_MINUTES = 30`. An online booking may start in the past only while
  `now < start + 30 min`. It ends on the hour and costs the full price.
- `onlineHoldUntil` caps the hold at the booking's start for a future booking, and at its end for a
  running one.
- Availability gets `allowRunning`: the public page passes it, the player's move picker doesn't.

### Settling

- `settleInvoice` reads `booking-<code>` (unchanged) or `order-<code>`. For an order it:
  1. locks the order's courts (sorted), then its bookings;
  2. stops if a payment with this `providerRef` already exists (`ALREADY_RECORDED`);
  3. checks the invoice amount against the sum of the order's unpaid bookings. If they differ, one
     payment row for the whole amount on the first booking is refunded (`AMOUNT_MISMATCH`);
  4. otherwise runs `decide()` per unpaid booking with its own price, writes one payment row per
     booking, confirms the kept ones and refunds each one not kept for its own share.
- Kept bookings get **one combined email** (`sendOrderConfirmedEmail`), which claims each booking's
  `confirmationSentAt`.
- `resumeCheckout` for an order booking reuses the order's open invoice while its amount still equals
  the unpaid total. Otherwise it closes that invoice and opens a new order checkout.

### Cancel / move

Unchanged, and each booking is handled alone:
- **Paid:** its own payment row is refunded, which is a partial refund on the order's invoice.
- **Unpaid:** the shared invoice is closed. The other bookings' **Pay** opens a new order checkout for
  what's left.

### Web

- **`/book/…` picker:**
  - no length picker; a court × hour grid where any free hour can be toggled;
  - the running hour labelled "Now";
  - a summary of joined runs per court with their prices and a total, and one **Book and pay**
    button;
  - the picks kept in the URL (`picks=courtKey@HH:mm,…`) across sign-in.
- **After booking:** the player goes to the checkout.
- **Admin booking detail:** a "Paid together" note listing the order's other bookings.

## Out of scope

Staff bookings (still one at a time), several days per checkout, discounts.

## Risks

- **Deadlocks between two orders:** courts are always locked in courtId order, then bookings.
- **A stale order invoice paid after a booking was cancelled:** the amount no longer matches, so the
  whole payment is refunded.
- **Partial refunds on Xendit invoices:** supported by its refund API (amount ≤ the invoice); the
  sandbox records the amount given.

## Revisions

- 2026-11-26: Created for CR-047.
- 2026-11-26: Longest booking (`maxBookingMinutes`) removed — a run is limited only by the opening
  hours.
