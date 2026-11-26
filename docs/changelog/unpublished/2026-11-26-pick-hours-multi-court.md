---
type: improved
impact: minor
audience: user
ref: CR-047
---

Booking a court is quicker: there's no "How long" any more — players tap the hours they want, on
any courts, and pay for everything in one go. Hours next to each other on a court are one game; a
gap makes a separate game. Two courts booked together are paid once and get one confirmation email,
and each booking can still be cancelled or moved on its own (only its share is refunded). The hour
that's already running can now be booked too, during its first half, at the full price. There's
no longest booking any more: players can book as many hours as they like, up to closing time, and
the Longest booking setting is gone from the venue's booking settings. Hours picked on one day
stay picked while you look at another day, and reloading the page warns before it clears them.

## Dev notes

- back/: run `npm run db:migrate` — `043_booking_orders.sql` adds `booking_orders`,
  `bookings.orderId`, and makes `payments` unique on (providerRef, bookingId) instead of providerRef.
- back/: `POST /public/book/:bookingToken/bookings` takes `{ date, slots: [{ courtKey, startTime }] }`
  (the old `courtKey/startTime/durationMinutes` still works) and replies with `bookings` and `total`.
  Several bookings make an order paid by one Xendit invoice `order-<orderCode>`; settlement confirms
  each (one payment row each) and refunds per booking. `GET …/availability` defaults to one-hour slots
  and includes the running hour (`now: true`) during its first 30 minutes.
- back/: Admin booking detail returns `paidTogether`.
- back/: `maxBookingMinutes` is no longer checked, saved or returned by Booking settings (a sent
  value is ignored); online bookings are limited only by opening hours. The column stays, unused.
- front/: `/book/…` multi-pick picker and summary; Admin booking detail "Paid together with";
  Booking settings drops Longest booking.
- app/, edge/: no change.
