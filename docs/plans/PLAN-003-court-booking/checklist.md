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

- [ ] `validators/bookings.validator.js`: create (court, date, start, length, name, phone via
      `optionalPhone()`, email, payment option), move, cancel (reason, refund), list query
      (`queryEnum` status, date range, venue, search)
- [ ] `controllers/v1/admin/bookings.controller.js`: `GET /` (list + pagination), `GET /day`
      (courts × hours for one date: bookings, games, closures), `GET /:bookingId`
- [ ] `POST /admin/bookings`: one transaction, court row `FOR UPDATE` → `findConflict` → price
      quote → insert with `bookingCode` (via `insertWithPayCode`-style retry) and `manageToken`;
      options **Paid now (cash)** (inserts the payment; needs `payments` write, 403 otherwise) ·
      **Hold, pay at desk** (`Pending`, `holdExpiresAt = startAt − deskHoldMinutes`) · **Free**
- [ ] Closures that cancel bookings (`cancelConflicts`, Phase A) go through the shared
      cancel helper, so paid ones are refunded (cash now, Xendit in F) and emailed (G) — Phase A
      only sets them `Cancelled`, since no booking can be paid before Phase B
- [ ] A user with only `bookings` read can reach the venue page's booking sections (today the
      venue page needs `venues/list` or `venues/courts`)
- [ ] `PUT /:bookingId/move` (staff: unlimited, price kept unless "Reprice"),
      `POST /:bookingId/cancel` (any time before check-in; full or partial refund; cash refund =
      `Refunded` payment row),
      `POST /:bookingId/no-show`, `DELETE /:bookingId` (soft delete, no payments only)
- [ ] `POST /admin/bookings/:bookingId/payments` behind `checkPermission("payments", null, "write")`
- [ ] Mount `/bookings` in `routes/v1/admin/index.js` with `requireAuth` + `auditTrail("bookings")`
- [ ] `utils/gameStart.js` `bookCourt()`: use `findConflict` so Admin New game and the court QR's
      Start a game refuse booked time (`BUSY` + `busyFrom`); New game's error names the booking
- [ ] Payments list/detail and Sessions list/detail include booking payments / "Booking <code>"
- [ ] Tests: create → conflict on overlap (booking vs booking, booking vs game, game vs booking,
      closure, outside hours); two concurrent creates on one slot → exactly one succeeds; move and
      cancel rules; cash payment confirms a Pending booking; `payments` write required for
      "Paid now"; Deleted booking → 404 and unchanged on every by-ID route; CR-027 Start a game
      refused inside a booking

### Frontend

- [ ] `services/api/admin/bookings.js` + `services/requests/admin/bookings.js`
- [ ] `pages/Admin/DynaCam/Bookings/hooks.jsx` + `index.jsx`: Day view (courts × hours grid) and
      List view (`DataTable`, filters, stat cards)
- [ ] `components/BookingFormDrawer.jsx` (owns its `<Sheet>`; live price quote; phone with
      `zPhone` / `formatPhoneOnChange` / `PHONE_PLACEHOLDER`; email optional; payment option)
- [ ] `components/BookingDetailDrawer.jsx`: timeline + Record payment, Move, Cancel/Refund,
      Check in, No-show, Resend (each hidden without its permission)
- [ ] Register **Bookings** in `AdminRoute.jsx` (Dyna Cam group, first child,
      `<ProtectedRoute module="bookings" accessLevel="read">`); add `bookings` read to the group's
      `anyOf`
- [ ] Sessions: Started by "Booking <code>" links to the booking; Payments: method column and
      booking items

## Phase C — Public booking page (pay at the desk)

### Backend

- [ ] `controllers/v1/public/booking.controller.js`: `GET /book/:bookingToken`,
      `GET /book/:bookingToken/availability?date=` (no names, no business IDs),
      `POST /book/:bookingToken/bookings` (rate-limited; `payMethod: "Desk"` → `Pending` hold to
      `startAt − deskHoldMinutes`, reply `{ manageUrl }`)
- [ ] `GET /bookings/:manageToken` (status, code, allowed actions)
- [ ] Mount under `/v1/public` in `routes/route.js`; params validated with `validateParams`
- [ ] Tests: turned-off link → 404; date beyond `bookingDaysAhead` / past / closed → 400;
      availability hides names; hold blocks the slot until it expires

### Frontend

- [ ] `services/api/public/bookings.js` + requests
- [ ] `pages/Public/Book/` (`/book/:bookingToken`): date strip, length, court time chips with
      prices, details form, Pay at the desk
- [ ] `pages/Public/Booking/` (`/booking/:manageToken`): status card, booking code, details,
      allowed actions
- [ ] Register both routes in `routes/index.jsx`

## Phase D — Check in → recorded game

### Backend

- [ ] `utils/bookingCheckIn.js` `checkInBooking(conn, booking)`: lock booking `FOR UPDATE`, check
      window/status/payment, `bookCourt()` with the booking window (`Scheduled` if early),
      `free: true`, `maxCaptures: PLAYER_MAX_CAPTURES`, `bookingId`; set `sessionId` + `CheckedIn`
- [ ] `POST /public/bookings/:manageToken/check-in`, `POST /public/courts/:qrToken/check-in`
      (`{ bookingCode }`, strict per-IP + per-court limiter), `POST /admin/bookings/:bookingId/check-in`
- [ ] `GET /public/courts/:qrToken` returns `booking: { from, until }` when booked now / within
      the early window, and caps Start a game's length at the next booking
- [ ] Tests: check-in before window / after end / unpaid `Pending` ("Pay at the desk first") /
      wrong court code → refused; booked game gets 5 saves and is free; early
      check-in → `Scheduled` then `Recording` at `startAt`; game ends at booking end; camera
      offline → 503 and booking stays `Confirmed`; second check-in → same game, no duplicate

### Frontend

- [ ] `Public/Court/`: booked state with booking-code input → redirect to `/session/:shareToken`;
      Start a game form shows "until <time> (booked after that)"
- [ ] `Public/Booking/`: Start game button during the window; Watch your game after check-in

## Phase E — Booking job

- [ ] `jobs/bookingMaintenance.js` (60 s): expire holds → `Expired`; `NoShow` after end without
      check-in; `CheckedIn` → `Completed` when its game has ended; registered where the other jobs
      start
- [ ] Tests for each transition (driven by calling the job function with a fixed clock)

## Phase F — Online payment (Xendit, one Dyna Cam account)

- [ ] Confirm with the account owner which methods are enabled and refundable (open question;
      only blocks going live — build and test in Xendit test mode)
- [ ] `lib/payments/xendit.js`: `createInvoice(booking)` (`external_id` = bookingId, amount =
      `bookings.price`, `invoice_duration` = `onlineHoldMinutes`, success/failure redirect →
      `/booking/<manageToken>`, payer email), `getInvoice(id)`, `expireInvoice(id)`,
      `refund({ invoiceId, amount, reason })`, `checkCallbackToken(header)` (constant-time);
      online payment off when `XENDIT_SECRET_KEY` or `XENDIT_CALLBACK_TOKEN` is empty
- [ ] `back/.env.example`: `XENDIT_SECRET_KEY`, `XENDIT_CALLBACK_TOKEN` (test-mode keys for dev)
- [ ] `POST /public/book/:bookingToken/bookings` with `payMethod: "Online"` → `Pending` hold of
      `onlineHoldMinutes`, `checkoutId` + `checkoutUrl` saved, reply `{ checkoutUrl }`;
      `POST /public/bookings/:manageToken/pay` reopens the open invoice or makes a new one while
      the hold is live
- [ ] `controllers/v1/webhooks/xendit.controller.js` mounted at `/v1/webhooks/xendit` in
      `routes/route.js`: `x-callback-token` check → 401 on mismatch; re-read the invoice with
      `getInvoice()` and act only on `PAID` + amount equal to `bookings.price`; `payments` row
      (`ONLINE`, `provider 'xendit'`, unique `providerRef`) + booking `Paid`/`Confirmed` in one
      transaction; paid after the slot was lost → automatic full refund + email; always 200 once
      the token is valid
- [ ] Refunds through `refund()`: player cancel before cut-off (full), staff cancel (full or
      partial), lost slot (full); Xendit refusal → booking still cancelled, payment `refundError`
      set and shown as **Refund failed** in Admin Payments and the booking drawer
- [ ] Cancel / move of an unpaid online booking calls `expireInvoice()` so the old checkout can't
      be paid
- [ ] Payments page: per-venue online totals for a date range (the settlement statement)
- [ ] Tests (Xendit client mocked): wrong / missing callback token → 401 and nothing changes;
      payload says PAID but `getInvoice()` doesn't → nothing changes; amount mismatch → nothing
      changes; replayed webhook → one payment row; late payment on a taken slot → refunded;
      refund refusal → `refundError` set, booking cancelled
- [ ] Frontend: Pay now option on `Public/Book/` (hidden when online is off); `Public/Booking/`
      polls after checkout return and offers Pay again while `Pending`

## Phase G — Notifications

- [ ] `lib/mailer/templates.js`: confirmed, pay-at-desk deadline, reminder, cancelled, moved,
      game started
- [ ] `utils/bookingEmails.js`: send + record (`confirmationSentAt`, `reminderSentAt`, …); no-op
      without an email or without SendGrid
- [ ] Hook sends into create/confirm, cancel (all sources), move, check-in; reminders in
      `bookingMaintenance.js` (`BOOKING_REMINDER_MINUTES`, default 120)
- [ ] Admin Resend confirmation (`POST /admin/bookings/:bookingId/resend`)
- [ ] Tests: each email sent once; reminder not sent for cancelled / already-sent bookings

## Phase H — Player cancel and move

- [ ] `POST /public/bookings/:manageToken/cancel`: only before `cancelCutoffHours`; paid online →
      full Xendit refund; unpaid → `expireInvoice()` if one is open; after cut-off → 409
- [ ] `POST /public/bookings/:manageToken/move`: before the cut-off, only when
      `rescheduledCount = 0`; locks the court row, `findConflict` with `ignoreBookingId`, same
      length, new quote ≤ booking `price` (price kept, no partial refund), `rescheduledCount = 1`
- [ ] Availability for a move (`?forBooking=<manageToken>` or a sibling endpoint) returns only
      slots priced ≤ the booking's price
- [ ] Tests: after cut-off → refused; second move → refused; pricier slot → refused; move into a
      taken slot → 409 and unchanged; online cancel refunds in full through Xendit
- [ ] Frontend: Cancel ("Full refund until <cut-off>") and Move ("You can move this booking
      once", same picker as `Book/`) on `Public/Booking/`; past the cut-off, "call <venue phone>"

## Wrap-up

- [ ] `cd back && npm run lint && npm test` passes
- [ ] `cd front && npm run lint && npm run build` passes
- [ ] Migrations `030`–`033` applied, or noted as pending for deploy (Phase A: written and run by
      `npm test`; not applied to the dev database yet)
- [ ] Tried in the browser: set hours and rates → book online (desk pay) → staff record cash →
      scan court QR, enter booking code → game records the booked time → video on the game page;
      plus an online-paid booking in Xendit test mode, a cancel with refund and a move
- [ ] `CLAUDE.md` cross-cutting facts updated (booking routes, webhook route family, booking
      tokens as credentials) and `back/CLAUDE.md` stack paragraph
- [ ] Changelog entry added in `docs/changelog/unpublished/` (`ref: PLAN-003`)
- [ ] `plan.md` status set to `Done`
