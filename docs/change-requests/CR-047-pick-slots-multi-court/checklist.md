# CR-047 · Pick hours and courts by tapping — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered (2026-11-26: running hour until 30 min before its end; one combined
      email; no limit per checkout; Longest booking removed — up to closing)
- [x] Plan doc written (size L) and linked both ways — PLAN-007 (its checklist is this one)

## Build — database

- [x] Migration: `booking_orders`; `bookings.orderId` (NULL, index, FK); `payments` unique on
      (providerRef, bookingId) instead of providerRef alone

## Build — API (`back/`)

- [x] Availability: one-hour slots per court for a date (no length); the running hour while free and
      until 30 min before it ends
- [x] `utils/bookings.js`: online rules allow the running hour (ends on the hour, full price); online
      hold from now, never past the booking's end
- [x] Group picks: neighbouring hours on a court → one booking (a gap → separate games); one date;
      no length limit beyond the opening hours
- [x] Longest booking removed: the online and desk rules no longer check `maxBookingMinutes`;
      Booking settings ignores it and stops returning it; the demo seed stops setting it
- [x] `POST /public/book/:token/bookings` `{ date, slots }`: lock courts in a fixed order, check every
      slot, create the bookings + the order in one transaction; any conflict → 409 naming the slot,
      nothing held
- [x] Checkout per order (`order-<orderCode>` invoice, the order's total, the shortest hold); a failed
      checkout releases every booking in it
- [x] Settlement: an order's invoice confirms all its bookings, one payment row each (its price);
      today's `booking-<code>` invoices still work
- [x] Cancel / move one booking of an order: partial refund of its price on the order's invoice;
      the others untouched; an unpaid order's checkout closes when its last booking is cancelled
- [x] One combined confirmation email for an order (each booking, its court, time and link);
      reminders / moves / cancels stay per booking
- [x] Payment sandbox: partial refunds
- [x] Tests: grouping, the running hour (bookable, price, end, check-in), two courts one checkout →
      both confirmed, a conflict refuses all, cancel one → partial refund, the other kept, old
      single bookings still settle
- [x] `npm run lint` · `npm test` (498 pass; 7 new in booking-orders.test.js; 0 lint errors); test
      helpers book the last minutes of the running hour Free instead of a refused pay link

## Build — web (`front/`)

- [x] `/book/…`: remove How long; court × hour tap grid with prices; picks summary (joined ranges per
      court) and total; one Book and pay button; back from sign-in keeps the picks (URL)
- [x] Running hour shown as "Now" while bookable
- [x] After paying: back to the first booking's page (its poll settles the whole order); a free order goes to My games
- [x] Admin → booking detail: "Paid together with" lists the order's other bookings
- [x] Admin → Booking settings: Longest booking field and rules-card row removed; `/book/…` has no
      "up to N hours" text or too-long warning
- [x] `/book/…` picks kept per date in the page: another date starts empty, back to a date restores
      its picks, a booking clears that date's
- [x] Reload / close with picks → the browser's "Leave site?" warning; after a reload the picks are
      gone (the sign-in return link's `picks` is dropped from the URL once read); no warning when
      leaving for the checkout or Google sign-in
- [x] `npm run lint` · `npm run build`

## Acceptance

- [ ] No How long; tapping hours builds a list and total
- [ ] Neighbouring hours → one booking; a gap → two
- [ ] Two courts, one checkout → both confirmed, both in My games
- [ ] 10:24 → the 10 AM hour bookable at full price, ends 11 AM, check-in at once
- [ ] Cancel one of two → only its price refunded; the other kept
- [ ] A slot taken meanwhile → refused clearly, nothing held or charged
- [ ] Pick hours on Nov 26 → Nov 27 shows none → back to Nov 26 shows them again; after booking
      they're gone
- [ ] With hours picked, reload → warning; reload anyway → nothing picked
- [ ] No Longest booking in Booking settings; 4+ neighbouring hours book as one game; past closing
      can't be picked

## Wrap-up

- [ ] Migration applied, or noted as pending for deploy — pending: `npm run db:migrate` (043)
- [x] Changelog entry added (`ref: CR-047`)
- [ ] Requester shown the result and signed off
- [ ] `request.md` status set to `Done`
