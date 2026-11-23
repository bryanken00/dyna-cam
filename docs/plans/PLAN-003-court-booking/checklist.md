# PLAN-003 · Court booking, end to end — Checklist

> Tick items as they land. Plan: [plan.md](plan.md)
>
> Phases A–E give a working **desk-paid** flow end to end (book → pay at desk → check in →
> record). Phase F adds online payment, G notifications, H the player's cancel/move.

## Phase A — Schedule: hours, rates, closures, booking link

### Backend

- [x] Migration `030_booking_settings.sql`: `venues` gains `bookingToken` (NULL, UNIQUE),
      `maxBookingMinutes` (multiple of 60), `bookingDaysAhead`, `deskHoldMinutes`,
      `onlineHoldMinutes`, `cancelCutoffHours`, `checkInEarlyMinutes`; create `venue_hours`
- [x] Migration `031_court_rates.sql`: create `court_rates`
- [x] Migration `032_court_closures.sql`: create `court_closures`
- [x] Migration `033_create_bookings.sql`: create `bookings`; `recording_sessions.bookingId`
      (FK, unique); `payments.bookingId` (FK), `method ENUM('CASH','ONLINE')`, `provider`,
      `providerRef` (UNIQUE), `providerRefundRef`, `refundError`; `bookings` permission row +
      Owner grant (`WHERE NOT EXISTS`)
- [x] Add `bookings` to the permission seed array in `back/scripts/setup-database.js`
- [x] `utils/bookingPrice.js`: `BOOKING_SLOT_MINUTES = 60`; `quote(db, { venueId, courtId,
      startLocal, durationMinutes })` → `{ price, bookable, reason }` (sum of each hour's rate;
      court rate beats venue rate; gap in rates → not bookable; start not on the hour → 400)
- [x] `utils/courtTimeline.js`: `findConflict(db, { courtId, startLocal, endLocal,
      ignoreBookingId?, checkHours? })` (works with `req.db` or a transaction `conn`, via
      `utils/dbRows.js`) covering games, live bookings (incl. unexpired holds),
      closures and opening hours
- [x] `validators/booking-settings.validator.js` + `closures.validator.js`
- [x] `GET/PUT /admin/booking-settings/:venueId` (rules + hours + rates in one body; also returns
      the venue's courts) behind `checkPermission("bookings", null, "read"|"write")` — its own
      route group, not under `/venues`, so one route group keeps one permission
- [x] `POST /admin/booking-settings/:venueId/link` (issue new `randomToken()`) and `DELETE` (turn off)
- [x] `controllers/v1/admin/closures.controller.js`: list / create / update / delete; create
      returns conflicting bookings unless `cancelConflicts: true`; mounted with `requireAuth` +
      `auditTrail("closures")`
- [x] Tests: settings round-trip; price quote (peak/off-peak, court override, rate gap);
      closure over a booking refused without `cancelConflicts`; Deleted closure → 404, unchanged

### Frontend

- [x] `services/api/admin/bookingSettings.js` + `services/requests/admin/bookingSettings.js`
      (query keys, invalidation, toasts); same for closures
- [x] VenueDetail → **Online booking** section (copy, QR, Issue new link, Turn off, Print sign →
      `Setup/BookingSign/` at `/admin/setup/venues/:venueId/booking-sign`) and **Booking rules,
      hours and prices** summary + `BookingSettingsFormDrawer` (rules, weekly hours editor, rates)
- [x] VenueDetail → **Closures** list + Add closure drawer (court or whole venue, from/to,
      reason; shows bookings in the way and the "cancel them" confirmation)

## Phase B — Bookings core and the desk

### Backend

- [x] `validators/bookings.validator.js`: create (court, date, start, length, name, phone via
      `optionalPhone()`, email, payment option), move, cancel (reason, refund), list query
      (`queryEnum` status, date range, venue, search)
- [x] `controllers/v1/admin/bookings.controller.js`: `GET /` (list + pagination), `GET /day`
      (courts × hours for one date: bookings, games, closures), `GET /:bookingId`
- [x] `POST /admin/bookings`: one transaction, court row `FOR UPDATE` → `findConflict` → price
      quote → insert with `bookingCode` (via `insertWithPayCode`-style retry) and `manageToken`;
      options **Paid now (cash)** (inserts the payment; needs `payments` write, 403 otherwise) ·
      **Hold, pay at desk** (`Pending`, `holdExpiresAt = startAt − deskHoldMinutes`) · **Free**
- [x] Closures that cancel bookings (`cancelConflicts`, Phase A) go through the shared
      cancel helper, so paid ones are refunded (cash now, Xendit in F) and emailed (G) — Phase A
      only sets them `Cancelled`, since no booking can be paid before Phase B
- [x] ~~A user with only `bookings` read can reach the venue page's booking sections~~ —
      decided not needed: desk staff work from Bookings; whoever edits a venue's booking
      settings also has a venues permission (see plan Revisions)
- [x] `PUT /:bookingId/move` (staff: unlimited, price kept unless "Reprice" — only while unpaid),
      `POST /:bookingId/cancel` (any time before check-in; refund in full or not at all; cash refund =
      `Refunded` payment row),
      `POST /:bookingId/no-show`, `DELETE /:bookingId` (soft delete, no payments only)
- [x] `POST /admin/bookings/:bookingId/payments` behind `checkPermission("payments", null, "write")`
- [x] Mount `/bookings` in `routes/v1/admin/index.js` with `requireAuth` + `auditTrail("bookings")`
- [x] `utils/gameStart.js` `bookCourt()`: use `findConflict` so Admin New game and the court QR's
      Start a game refuse booked time (`BUSY` + `busyFrom`); New game's error names the booking.
      Also: open games (no game time) check the next 6 h, and Add time locks the court row and
      checks the timeline
- [x] Payments list/detail and Sessions list/detail include booking payments / "Booking <code>"
- [x] Tests: create → conflict on overlap (booking vs booking, booking vs game, game vs booking,
      closure, outside hours); two concurrent creates on one slot → exactly one succeeds; move and
      cancel rules; cash payment confirms a Pending booking; `payments` write required for
      "Paid now"; Deleted booking → 404 and unchanged on every by-ID route; CR-027 Start a game
      refused inside a booking

### Frontend

- [x] `services/api/admin/bookings.js` + `services/requests/admin/bookings.js` (+ `GET /options`,
      `GET /quote` for the live price)
- [x] `pages/Admin/DynaCam/Bookings/hooks.jsx` + `index.jsx`: Day view (courts × hours grid) and
      List view (`DataTable`, filters, stat cards)
- [x] `components/BookingFormDrawer.jsx` (owns its `<Sheet>`; live price quote; phone with
      `zPhone` / `formatPhoneOnChange` / `PHONE_PLACEHOLDER`; email optional; payment option)
- [x] `components/BookingDetailSheet.jsx` (+ `MoveBookingFormModal`, `CancelBookingFormModal`):
      details, payments, game + Record payment, Move, Cancel/Refund, No-show, Delete (each hidden
      without its permission). Check in → Phase D, Resend → Phase G
- [x] Register **Bookings** in `AdminRoute.jsx` (Dyna Cam group, first child,
      `<ProtectedRoute module="bookings" accessLevel="read">`); add `bookings` read to the group's
      `anyOf`
- [x] Sessions: Started by "Booking <code>" links to the booking; Payments: method column and
      booking items

## Phase C — Public booking page (pay at the desk)

### Backend

- [x] `controllers/v1/public/booking.controller.js`: `GET /book/:bookingToken`,
      `GET /book/:bookingToken/availability?date=` (no names, no business IDs),
      `POST /book/:bookingToken/bookings` (rate-limited; `payMethod: "Desk"` → `Pending` hold to
      `startAt − deskHoldMinutes`, reply `{ manageUrl }`)
- [x] `GET /bookings/:manageToken` (status, code, allowed actions)
- [x] Mount under `/v1/public` in `routes/route.js`; params validated with `validateParams`
- [x] Tests (`tests/public-booking.test.js`): turned-off / replaced link → 404; past, beyond
      `bookingDaysAhead`, too long, too soon for a desk hold → 400; outside opening hours → 409;
      availability hides names, codes and business IDs; hold blocks the slot until it expires
- [x] Courts are named by a `courtKey` (hash of the booking link + court), never their ID;
      `utils/bookingAvailability.js` works a day's free slots out in one pass; the desk's booking
      detail gets the player's `manageUrl` (Copy the player's link)

### Frontend

- [x] `services/api/public/bookings.js` + requests
- [x] `pages/Public/Book/` (`/book/:bookingToken`): date strip, length, court time chips with
      prices, details form, Pay at the desk
- [x] `pages/Public/Booking/` (`/booking/:manageToken`): status card, booking code, details,
      allowed actions
- [x] Register both routes in `routes/index.jsx`

## Phase D — Check in → recorded game

### Backend

- [x] `utils/bookingCheckIn.js` `checkInBooking(conn, booking)`: lock booking `FOR UPDATE`, check
      window/status/payment, `bookCourt()` with the booking window (`Scheduled` if early),
      `free: true`, `maxCaptures: PLAYER_MAX_CAPTURES`, `bookingId`; set `sessionId` + `CheckedIn`
- [x] `POST /public/bookings/:manageToken/check-in`, `POST /public/courts/:qrToken/check-in`
      (`{ bookingCode }`, strict per-IP + per-court limiter), `POST /admin/bookings/:bookingId/check-in`
- [x] `GET /public/courts/:qrToken` returns `booking: { from, until }` when booked now / within
      the early window, and caps Start a game's length at the next booking
- [x] Tests: check-in before window / after end / unpaid `Pending` ("Pay at the desk first") /
      wrong court code → refused; booked game gets 5 saves and is free; early
      check-in → `Scheduled` then `Recording` at `startAt`; game ends at booking end; camera
      offline → 503 and booking stays `Confirmed`; second check-in → same game, no duplicate

### Frontend

- [x] `Public/Court/`: booked state with booking-code input → redirect to `/session/:shareToken`;
      Start a game form shows "until <time> (booked after that)"
- [x] `Public/Booking/`: Start game button during the window; Watch your game after check-in
- [x] Admin booking detail: **Check in** during the window (staff don't need the recorder box
      online, like New game); the API sends `checkInFrom`

## Phase E — Booking job

- [x] `jobs/bookingMaintenance.js` (60 s): expire holds → `Expired`; `NoShow` after end without
      check-in; `CheckedIn` → `Completed` when its game has ended; registered where the other jobs
      start
- [x] Tests for each transition (driven by calling the job function with a fixed clock) —
      `tests/booking-maintenance.test.js`; scheduled in `bin/www.js` beside the other jobs

## Phase F — Online payment (Xendit, one Dyna Cam account)

- [ ] Confirm with the account owner which methods are enabled and refundable, and check the
      refund call in Xendit test mode (open question; only blocks going live — built and tested
      against a fake Xendit)
- [x] `lib/payments/xendit.js`: `createInvoice()` (`external_id` = `booking-<bookingCode>`, amount =
      `bookings.price`, `invoice_duration` = the hold, success/failure redirect →
      `/booking/<manageToken>?checkout=done`, payer email), `getInvoice(id)` (PAID or SETTLED =
      paid), `expireInvoice(id)`, `refund({ invoiceId, amount, referenceId, reason })`,
      `getRefund(id)`, `checkCallbackToken(header)` (constant-time); online payment off when
      `XENDIT_SECRET_KEY` or `XENDIT_CALLBACK_TOKEN` is empty; `XENDIT_API_URL` for tests
- [x] `back/.env.example`: `XENDIT_SECRET_KEY`, `XENDIT_CALLBACK_TOKEN` (test-mode keys for dev),
      `RATE_LIMIT_PUBLIC_BOOK_POINTS`, `RATE_LIMIT_PUBLIC_PAY_POINTS`; the test harness blanks the
      Xendit keys so a developer's `.env` never reaches Xendit
- [x] `POST /public/book/:bookingToken/bookings` with `payMethod: "Online"` → `Pending` hold of
      `onlineHoldMinutes` (never past the start), `checkoutId` + `checkoutUrl` saved, reply
      `{ checkoutUrl }`; if the checkout can't be opened the hold is let go (502);
      `POST /public/bookings/:manageToken/pay` reopens the open invoice or makes a new one while
      the hold is live (a desk hold can be paid online too)
- [x] `controllers/v1/webhooks/xendit.controller.js` mounted at `/v1/webhooks/xendit` in
      `routes/route.js`: `x-callback-token` check → 401 on mismatch; re-read the invoice with
      `getInvoice()` and act only on paid + amount equal to `bookings.price`; `payments` row
      (`ONLINE`, `provider 'xendit'`, unique `providerRef`) + booking `Paid`/`Confirmed` in one
      transaction (`utils/bookingPayments.js` `settleInvoice()`); paid after the slot was lost →
      automatic full refund (the email joins in Phase G); 200 for every handled or ignored event,
      503 only when Xendit's API can't be reached (so Xendit retries); `refund.failed` events too
- [x] Refunds through `refund()`: staff cancel (full or none — Phase B decision), closures that
      cancel bookings, lost slot (full); player cancel joins in Phase H. Queued inside the
      cancel's transaction (`refundError` = "Refund not sent yet"), sent after commit; Xendit
      refusal → booking still cancelled, payment `refundError` set and shown as **Refund failed**
      in Admin Payments and the booking drawer, with **Try the refund again** (booking drawer) and
      **Mark repaid by hand** (Payments)
- [x] Cancel / move / desk cash payment of an unpaid online booking calls `expireInvoice()` so the
      old checkout can't be paid
- [x] Payments page: **Online settlement** sheet — per-venue online totals for a date range
      (`GET /admin/payments/settlement`: collected, refunded, refund failed, net)
- [x] Tests (`tests/online-payment.test.js`, Xendit faked): wrong / missing callback token → 401
      and nothing changes; payload says PAID but `getInvoice()` doesn't → nothing changes; amount
      mismatch → not confirmed, money refunded; replayed (and concurrent) webhook → one payment
      row; late payment on a free slot → confirmed, on a taken slot → refunded; refund refusal →
      `refundError` set, booking cancelled, retry and mark-repaid; `refund.failed` → Refund
      failed; cancel / move / cash close the checkout; Pay reopens or renews; the booking page
      settles a paid checkout before the webhook; Deleted booking → 404; settlement totals
- [x] Frontend: Pay now / At the desk choice on `Public/Book/` (hidden when online is off; sends
      the player to Xendit); `Public/Booking/` polls every 5 s after the checkout return and
      offers Pay now / Pay again while `Pending`

## Phase G — Notifications

- [x] `lib/mailer/templates.js`: confirmed, pay-at-desk deadline, reminder, cancelled (and "your
      court was released"), moved, game started, and a payment refunded (paid after the slot
      was lost, paid twice, wrong amount)
- [x] Migration `034_booking_cancel_email.sql`: `bookings.cancelledEmailSentAt`, beside 033's
      `confirmationSentAt` and `reminderSentAt`
- [x] `utils/bookingEmails.js` `sendBookingEmail()`: send + record — once-only emails are
      claimed on their column first; no-op without an email; without SendGrid only logged,
      nothing recorded; never throws
- [x] Hook sends into create (desk and online desk hold / free), confirm (desk cash, verified
      online payment), cancel (staff, closures; player in Phase H), move, check-in (booking page,
      court QR, Admin); reminders and released holds in `bookingMaintenance.js`
      (`BOOKING_REMINDER_MINUTES`, default 120; skipped when the confirmation went out that close
      to the start; released only for holds that ran out in the last hour)
- [x] Admin **Resend email** (`POST /admin/bookings/:bookingId/resend`): the confirmation, the
      pay-by email or the game link, whichever fits; the booking drawer shows which emails went out
- [x] Tests (`tests/booking-emails.test.js`, SendGrid faked): each email sent once; none without
      an email; reminder not sent for cancelled / already-sent / just-confirmed bookings, nor twice
      when two job runs overlap; released only for recent holds; staff reason kept out of the
      cancellation; Resend (409 no email / cancelled, 404 Deleted, 503 without SendGrid)

## Phase H — Player cancel and move

- [x] `POST /public/bookings/:manageToken/cancel`: only before `cancelCutoffHours`; paid online →
      full Xendit refund (`REQUESTED_BY_CUSTOMER`); unpaid → `expireInvoice()` if one is open;
      after cut-off → 409 "call the venue"; paid in cash at the desk → 409 (the desk gives cash
      back); the cancellation email follows
- [x] `POST /public/bookings/:manageToken/move` (`{ courtKey?, date, startTime }`): before the
      cut-off, only when `rescheduledCount = 0`; locks the court rows, `findConflict` with
      `ignoreBookingId` and opening hours, same length, within `bookingDaysAhead`, new quote ≤
      booking `price` (price kept, no partial refund), `rescheduledCount = 1`; a desk hold
      follows the new start; an open checkout is closed; the Moved email follows
- [x] `GET /public/bookings/:manageToken/move-options?date=` (sibling endpoint): only slots priced
      ≤ the booking's price, its own time marked `current`, courts keyed by the booking's link
      (`utils/bookingAvailability.js` `moving` option)
- [x] The booking page's `actions.cancel` / `actions.move`, plus `cutoffPassed`, `paidAtDesk`,
      `movedOnce` to say why one is missing
- [x] Tests (`tests/player-cancel-move.test.js`, Xendit faked via `tests/helpers/fakeXendit.js`):
      after cut-off → refused; cash-paid cancel → refused; unpaid hold cancel; online cancel
      refunds in full through Xendit; unpaid online cancel closes the checkout; move options price
      filter; second move → refused; pricier / taken / closed-hours / too-far slot → refused and
      unchanged; move to another court; Deleted booking → 404
- [x] Frontend: Cancel ("Cancel by <cut-off> for a full refund") and Move ("You can move it once",
      same picker as `Book/` — `PickChip`, `BookingDateStrip`, `CourtSlotPicker` now shared in
      `src/components/`) on `Public/Booking/`; past the cut-off, "call <venue phone>"

## Wrap-up

- [ ] `cd back && npm run lint && npm test` passes
- [ ] `cd front && npm run lint && npm run build` passes
- [ ] Migrations `030`–`034` applied, or noted as pending for deploy (Phase A: written and run by
      `npm test`; not applied to the dev database yet)
- [ ] Tried in the browser: set hours and rates → book online (desk pay) → staff record cash →
      scan court QR, enter booking code → game records the booked time → video on the game page;
      plus an online-paid booking in Xendit test mode, a cancel with refund and a move
- [ ] `CLAUDE.md` cross-cutting facts updated (booking routes, webhook route family, booking
      tokens as credentials) and `back/CLAUDE.md` stack paragraph
- [ ] Changelog entry added in `docs/changelog/unpublished/` (`ref: PLAN-003`)
- [ ] `plan.md` status set to `Done`
