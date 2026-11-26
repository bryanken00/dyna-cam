# CR-047 · Pick hours and courts by tapping — several courts in one payment, and the hour that's running

> **Status:** In progress · **Requested:** 2026-11-26 · **Requested by:** bryanken00 · **Size:** L
> **Checklist:** [checklist.md](checklist.md) · **Plan:** [PLAN-007](../../plans/PLAN-007-booking-orders/plan.md) · **Related:** [PLAN-003](../../plans/PLAN-003-court-booking/plan.md) (court booking, Xendit checkout), [CR-046](../CR-046-pay-online-to-reserve/request.md) (pay online to reserve), [PLAN-006](../../plans/PLAN-006-player-google-sign-in/plan.md)

## Requested change

On a venue's booking page (`/book/…`):

1. **No "How long".** The player taps the hours they want, on any court. Tapping 10 AM and 11 AM on
   Court 1 books 10 AM–12 PM.
2. **Several courts, one payment.** Picks on more than one court (e.g. Court 1 and Court 2 at
   6 PM) are booked and paid in a single checkout.
3. **The hour that's running can be booked.** At 10:24 AM, if nobody has 10 AM–11 AM, the player can
   still book it. It ends at 11 AM and costs the full hour.

## Today

- **One booking at a time:** the player picks a date, a length (1 h, 2 h, 3 h), then one court and
  start time, then pays for that one booking.
- **No running hour:** an hour that has already started can't be booked online. The current hour
  shows as unavailable, and the online hold can't run past the start.
- **One checkout per booking:** each checkout (Xendit invoice) pays for exactly one booking.

## Why

Booking several hours or courts takes several rounds of the form and several payments today, and an
empty court right now can't be sold at all. (bryanken00: "remove how long. user just tap multiple on
court & start time. possible to book 2 court on 1 transaction … it's possible to book even the time
running if no one already booked … if you book 10AM it ends with 11AM, same full payment.")

## Decisions (2026-11-26, bryanken00)

- **One day per checkout:** picks are on the chosen day; another day shows its own picks, and
  coming back restores the first day's. A reload clears them, after a warning.
- **Neighbouring hours join, gaps allowed:** 10 AM + 11 AM on Court 1 is one booking (10–12, one
  game); 10 AM + 2 PM is two bookings. A booking can run as long as the venue is open.
- **Each booking stands alone after paying:** the player can cancel or move one booking before the
  cut-off. Only that booking's share is refunded, as a partial refund on the same payment.
- **The running hour** can be booked only in its first half: up to 30 minutes before it ends
  (10:00–10:30 for the 10–11 hour).
- **One combined email** confirms everything paid together, listing each booking. Hours with a gap
  (1 PM and 3 PM) are separate games. Reminders stay per booking.
- **No length limit:** a booking can run up to the venue's closing time. The venue's **Longest
  booking** setting is removed (added 2026-11-26, see Revisions).

## Scope

**In**

- **Picker:** a tap-to-select grid of court × hour for the day. Each pick shows its price, and
  picks can't be made on taken or closed hours. A summary lists what will be booked ("Court 1 ·
  10 AM–12 PM", "Court 2 · 6–7 PM") and the total, with one **Book and pay ₱X** button.
- **The running hour:** shown and bookable while it's free and until 30 minutes before it ends, at
  the full hour's price, ending on the hour. It can be checked into straight away. The
  online hold runs from now, never past the hour's end.
- **One checkout for several bookings:** a new **order** groups the bookings paid together. One
  Xendit invoice covers the order. When it's paid, every booking in it is confirmed, with one
  payment row per booking for its own share.
- **After paying:** the player lands on My games, where every booking has its own page as today.
  Paying sends **one combined confirmation** listing each booking (court, time, link to its page).
  Reminders, moves and cancels stay per booking.
- **Cancel or move one booking:** before the cut-off, as today. A paid booking from an order is
  refunded for its own price as a partial refund on the order's invoice.
- **If the checkout can't be opened** (an error, or a slot taken meanwhile): nothing is held. The
  whole pick is refused, with which slot is the problem.

**Out**

- Staff booking in Admin (New booking keeps its length picker; one booking at a time).
- Several days in one checkout.
- Discounts for several hours or courts.

## Acceptance criteria

- The booking page has no "How long"; tapping hours on one or more courts builds a list and a total.
- Two neighbouring hours on a court become one booking; a gap makes two.
- Two courts picked together are paid in one checkout; after paying, both are confirmed and both
  appear in My games.
- At 10:24, an empty court's 10 AM hour can be booked and paid in full, ends at 11 AM, and can be
  checked into straight away.
- Cancelling one of two bookings paid together refunds only that one's price; the other stays booked.
- A slot taken while the player was choosing makes the booking refused with a clear message, and
  nothing is held or charged.

## Impact

| Area | Detail |
| --- | --- |
| Screens | `/book/…` picker and summary (player). Booking page and My games unchanged except an order's bookings link to each other. Admin → Bookings shows a "Paid together" marker. |
| Data | **Migration:** new `booking_orders` (orderId, venueId, playerId, orderCode for the invoice, amount, checkoutId/Url, holdExpiresAt, status, dates) and `bookings.orderId` (NULL for single bookings and staff bookings). `payments.providerRef` stops being unique on its own (several payment rows share one invoice) — unique on (providerRef, bookingId) instead. |
| API | `GET /public/book/:token/availability?date=` returns one-hour slots per court (no length), including the running hour while free. `POST /public/book/:token/bookings` takes `{ date, slots: [{ courtKey, startTime }] }` (replacing `courtKey/startTime/durationMinutes`) → creates the bookings and their order in one transaction (court rows locked in a fixed order), opens one checkout → `{ checkoutUrl, bookings: [...] }`. Xendit settlement reads `order-<code>` invoices as well as today's `booking-<code>`. Refunds become partial for order bookings. |
| Build / rollout | Web and API, one migration. Bookings made before keep working (no order). |
| Permissions | None. |
| Existing users | Players book differently (no length picker); behaviour for existing bookings is unchanged. Not breaking for staff. |
| Size | L — new order model through checkout, settlement, refunds and emails, plus the new picker and many tests. A plan doc first. |

## Open questions

Answered 2026-11-26 by bryanken00 (see Decisions):

- [x] **The running hour:** bookable until 30 minutes before it ends.
- [x] **Emails:** one combined confirmation; a gap between hours means separate games.
- [x] **Limit per checkout:** none — and no longest booking either; only the opening hours.

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Pending | — | — | Decisions on days / grouping / cancelling made 2026-11-26 |

## Revisions

- 2026-11-26: Created.
- 2026-11-26: Longest booking removed (bryanken00: "user can select hour until business hour of
  the venue"). A player's booking runs up to the venue's closing time (the desk keeps its own
  length picker). The setting
  is gone from Admin → Venue → Booking settings and the rules card; the API ignores it and no longer
  returns it. The `venues.maxBookingMinutes` column stays, unused (no migration).
- 2026-11-26: Picks are kept per date while the page is open (bryanken00): another date starts
  empty, going back to a date restores its picks, and booking clears that date's. Still one date
  per checkout.
- 2026-11-26: A reload clears the picks, and reloading or closing the tab with hours picked asks
  first (bryanken00). So the picks are kept in the page, not in sessionStorage; leaving for the
  checkout or Google's sign-in doesn't ask (the picks are booked, or travel in the return link).
