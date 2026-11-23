# PLAN-003 · Court booking, end to end

> **Status:** In progress · **Created:** 2026-11-23 · **Owner:** — · **Checklist:** [checklist.md](checklist.md)
> **Related:** [PLAN-001](../PLAN-001-court-replay-cameras/plan.md) (venues, courts, games),
> [CR-005](../../change-requests/CR-005-start-stop-from-device/request.md) (booking ahead removed),
> [CR-015](../../change-requests/CR-015-pay-before-download/request.md) (desk payments, pay codes),
> [CR-016](../../change-requests/CR-016-game-time-limit/request.md) (timed games),
> [CR-018](../../change-requests/CR-018-email-drive-link/request.md) (emails),
> [CR-027](../../change-requests/CR-027-player-start-game-qr/request.md) (court QR starts a game)

## Goal

A player can find a free court slot online, book it, pay for it (online or at the desk), get a
confirmation and a reminder, cancel or move it, then **check in with the court QR**. Checking in
starts the recorded game for exactly the booked time, and the player gets the video as today.
Staff run the same bookings from the desk in Admin: walk-ins and phone bookings, cash payments,
opening hours, prices and closures.

The whole path from booking to video lives in Dyna Cam: **book → pay → remind → check in →
record → watch / save / download**.

## Context

**Today, courts are reserved and paid for outside the system.** CR-027 made the court QR start a
free, timed game "because the court was paid at reservation". Dyna Cam has no record of who
reserved what, so:

- anyone who scans the court QR can start a game on a court someone else reserved, and the
  venue can't tell a booked game from a walk-in;
- the venue keeps its schedule, prices and payments somewhere else (chat, paper, spreadsheets);
- the desk can't see the day's courts at a glance, and no-shows aren't recorded.

**What already exists and is reused:**

| Piece | Where | How this plan uses it |
| --- | --- | --- |
| Venues and courts | `venues`, `courts` ([001](../../../back/database/migrations/001_create_venues_courts_devices.sql)); Admin [Setup → Venues](../../../front/src/pages/Admin/Setup/) | Bookings belong to a court; booking settings live on the venue |
| Timed games | `recording_sessions`, [`bookCourt()`](../../../back/server/src/utils/gameStart.js) locks the court row and refuses overlaps; [`advanceSessions()`](../../../back/server/src/utils/sessions.js) moves `Scheduled` → `Recording` at `startAt` and ends at `endAt` | Check-in creates the game through `bookCourt()` with the booking's window |
| Court QR Start a game | `GET/POST /public/courts/:qrToken[/games]` in [`public.controller.js`](../../../back/server/src/controllers/v1/public/public.controller.js); page [`Public/Court`](../../../front/src/pages/Public/Court/) | Becomes the check-in point, and refuses walk-ins on booked time |
| Payments | `payments` table (cash only, `method ENUM('CASH')`), [`utils/payments.js`](../../../back/server/src/utils/payments.js) (`insertWithPayCode`, `recordGamePayment`), Admin [Payments](../../../front/src/pages/Admin/DynaCam/Payments/) | Booking payments become rows here, plus an online method |
| Email | [`lib/mailer`](../../../back/server/src/lib/mailer/mailer.js) (SendGrid when `SENDGRID_API_KEY` is set), [`templates.js`](../../../back/server/src/lib/mailer/templates.js), [`jobs/driveEmails.js`](../../../back/server/src/jobs/driveEmails.js) | Confirmation, reminder, cancellation and check-in emails |
| Background jobs | [`server/src/jobs/`](../../../back/server/src/jobs/) (interval jobs) | Hold expiry, no-shows, reminders |
| Rate-limited public writes | `dynamicLimiter` in [`middlewares/rateLimiter.js`](../../../back/server/src/middlewares/rateLimiter.js) | Every public booking write |
| Unguessable tokens | [`utils/crypto/tokens.js`](../../../back/server/src/utils/crypto/tokens.js) `randomToken()` | Venue booking link, booking manage link |

**What's missing:** opening hours, prices, closures, a bookings table, a public booking page, an
online payment provider, booking emails, and a link between a booking and its game. This is a new
capability with no home in the app, so it gets a plan rather than a CR. It does touch the court QR
(CR-027) and Admin → Sessions, and the plan says how.

> CR-005 removed staff "booking ahead" for **games** (a game now starts when it's created). This
> plan doesn't bring that back. A **booking** is a separate record that reserves court time, and
> only check-in creates its game.

## Decisions (2026-11-23, bryanken00)

| Question | Decision |
| --- | --- |
| Who books | **Players online** (public page, no account: name, email, phone) **and staff at the desk** (Admin) |
| How it's paid | **Online through Xendit** (GCash, Maya, cards…) **or at the desk** (cash, recorded by staff) |
| Whose Xendit account | **One Dyna Cam account** (keys in the API's `.env`). Settling with each venue happens outside the system. |
| Booking → recording | **Check in with the court QR** during the booked time. The game ends at the booking's end. Walk-ins can't start a game on booked time. |
| Pay before playing | **A booking must be paid (or Free) to check in.** There is no "pay later" check-in. |
| Pay-at-desk hold | An unpaid desk hold is **released 30 min before the start** (per-venue `deskHoldMinutes`) |
| Player cancel | **Full refund** if cancelled before the venue's cut-off (default 24 h). After it there's no Cancel on the booking page; staff can still cancel, with or without a refund. |
| Player move | **Once** per booking, before the cut-off, same length, to a slot that costs **the same or less** (no refund of the difference). A pricier slot means cancel and rebook. |
| Time grid | **60-minute steps only**, for every venue |
| Saves per booked game | **5**, like games started from the court QR (CR-027) |
| Buffer between bookings | **None.** Bookings can touch (3:00–4:00, then 4:00–5:00). |
| Also in v1 | Opening hours and pricing · email notifications · cancel / reschedule · closures (blackouts) |

## Approach

### The flow

```
 Player (phone, no login)                       Venue desk (Admin)
 ───────────────────────                        ──────────────────
 /book/<venue link>                              Bookings → New booking (walk-in / phone)
   pick date → court → time → length                │
   name, email, phone                               │
   ├─ Pay online ──▶ Xendit checkout ───webhook──┐  │ Record payment (cash)
   └─ Pay at the desk (held until N min before)  │  │
                                                 ▼  ▼
                              booking: Pending ─▶ Confirmed ──(email: confirmation)
                                                     │  (email: reminder, 2 h before)
                                 cancel / move ◀─────┤  from /booking/<manage link>, until cut-off
                                                     │
            At the court: scan court QR ─▶ "Booked 3:00–4:00 PM — enter your booking code"
            (or "Start game" on /booking/<manage link> during the slot)
                                                     ▼
                                  CheckedIn ─▶ game (recording_sessions, bookingId)
                                     records 3:00 → 4:00, free, 5 saves, ends by itself
                                                     ▼
                              /session/<shareToken>: live view, saves, whole-game video,
                              Drive email (CR-018) → booking Completed
            Nobody checked in by the end ─▶ NoShow
```

### Statuses

`bookings.status`:

| Status | Meaning | Blocks the slot? |
| --- | --- | --- |
| `Pending` | Created and waiting for payment: online checkout open, or pay-at-desk hold. `holdExpiresAt` set. | Yes, until `holdExpiresAt` |
| `Confirmed` | Paid, or Free (staff comp) | Yes |
| `CheckedIn` | Its game exists (`sessionId` set) | Yes |
| `Completed` | Its game ended | — (past) |
| `NoShow` | The slot ended without a check-in | — (past) |
| `Cancelled` | Cancelled by the player or staff; `cancelledBy`, `cancelReason` | No |
| `Expired` | A `Pending` hold ran out unpaid | No |
| `Deleted` | Soft delete (staff only, mistakes) | No |

`bookings.paymentStatus`: `Unpaid` · `Paid` · `Refunded` · `Free` (staff comp). A booking is
**Confirmed** only once it's `Paid` or `Free`, and only a `Confirmed` booking can check in. An
unpaid booking is always a `Pending` hold that runs out. There is no "pay later".

### Data model (new migrations, from `030_`)

**`030_booking_settings.sql`**: venue rules and hours.

- `venues` gains:
  - `bookingToken VARCHAR(64) NULL UNIQUE`: the public booking link `/book/<bookingToken>`.
    `NULL` means online booking is off. Staff can **Issue new link** or **Turn off**, like the
    court QR.
  - `maxBookingMinutes INT NOT NULL DEFAULT 180`: a multiple of 60. The grid is fixed at
    60 minutes for every venue (`BOOKING_SLOT_MINUTES = 60` in `utils/bookingPrice.js`), so
    bookings start on the hour and last whole hours.
  - `bookingDaysAhead INT NOT NULL DEFAULT 14`.
  - `deskHoldMinutes INT NOT NULL DEFAULT 30`: an unpaid "pay at the desk" booking (made online or
    by staff) is released this many minutes before its start.
  - `onlineHoldMinutes INT NOT NULL DEFAULT 15`: how long a Xendit checkout holds the slot (also
    sent as the invoice's expiry).
  - `cancelCutoffHours INT NOT NULL DEFAULT 24`: players can cancel or move up to this many hours
    before the start.
  - `checkInEarlyMinutes INT NOT NULL DEFAULT 10`.
- `venue_hours`: `venueHourId`, `venueId`, `dayOfWeek TINYINT` (0 = Sunday), `opensAt TIME`,
  `closesAt TIME`, `status`. No row for a day means closed that day. Closing after midnight is
  out of scope.

**`031_court_rates.sql`**: prices.

- `court_rates`: `rateId`, `venueId`, `courtId NULL` (NULL = every court at the venue),
  `name VARCHAR(50)` ("Peak", "Off-peak"), `daysOfWeek VARCHAR(20)` (e.g. `1,2,3,4,5`),
  `startTime TIME`, `endTime TIME` (both on the hour), `pricePerHour DECIMAL(10,2)`, `status`.
- Price of a booking = the sum of each booked hour's matching `pricePerHour`. A court-specific
  rate beats a venue-wide one. An open hour
  with no matching rate can't be booked online ("Ask the desk"). The price is computed by one
  helper, [`utils/bookingPrice.js`](../../../back/server/src/utils/), and **snapshotted** on the
  booking (`price`) so later rate changes don't touch it.

**`032_court_closures.sql`**: blackouts.

- `court_closures`: `closureId`, `venueId`, `courtId NULL` (NULL = the whole venue),
  `startAt`, `endAt`, `reason VARCHAR(255)`, `createdByAccountId`, `status`.
- A closure can't be saved over existing `Pending`/`Confirmed` bookings unless staff tick
  "Cancel the N bookings in the way". Those bookings are cancelled and refunded, and their players
  get the cancellation email.

**`033_create_bookings.sql`**: bookings, and the link to games and payments, plus the
permission.

- `bookings`: `bookingId`, `venueId`, `courtId`, `startAt`, `endAt`, `playerName VARCHAR(100)
  NOT NULL`, `phone VARCHAR(20) NULL`, `email VARCHAR(255) NULL`, `price DECIMAL(10,2)`,
  `paymentStatus`, `payMethod ENUM('Online','Desk') NOT NULL`, `source ENUM('Online','Desk')`,
  `bookingCode VARCHAR(12) UNIQUE` (short code the player types at the court and reads to the
  desk, made like a pay code, e.g. `K7QM2P`), `manageToken VARCHAR(64) UNIQUE`
  (`/booking/<manageToken>`), `holdExpiresAt DATETIME NULL`, `checkoutId VARCHAR(100) NULL`
  (the open Xendit invoice's ID), `checkoutUrl VARCHAR(500) NULL` (its hosted page, so "Pay"
  reopens the same invoice until it expires),
  `sessionId VARCHAR(50) NULL` (FK, set at check-in), `rescheduledCount INT DEFAULT 0`,
  `cancelledAt`, `cancelledBy ENUM('Player','Staff','System')`, `cancelReason`,
  `confirmationSentAt`, `reminderSentAt`, `createdByAccountId NULL`, `status`, `dateCreated`,
  `dateUpdated`.
  - Indexes: `(courtId, startAt, endAt)`, `(venueId, startAt)`, `(status, holdExpiresAt)`,
    `(status, startAt)` (reminders, no-shows).
- `recording_sessions` gains `bookingId VARCHAR(50) NULL` (FK, unique). Admin → Sessions shows
  "Booking K7QM2P" in Started by.
- `payments` gains `bookingId VARCHAR(50) NULL` (FK). `method` becomes `ENUM('CASH','ONLINE')`,
  with `provider VARCHAR(30) NULL`, `providerRef VARCHAR(100) NULL UNIQUE` (the paid Xendit
  invoice's ID, which makes webhook retries idempotent), `providerRefundRef VARCHAR(100) NULL`
  and `refundError VARCHAR(255) NULL` (set when Xendit refuses a refund: shown as **Refund
  failed**). Every payment row has exactly one of
  `clipId`, `sessionId` or `bookingId`.
- Permission `bookings` (module, `submodule NULL`, "Court bookings"), granted to the Owner and
  added to the seed array in [`setup-database.js`](../../../back/scripts/setup-database.js).

### One court, one timeline

Today `bookCourt()` refuses a game that overlaps another game. After this plan, **games, live
bookings and closures share one overlap rule**, in a new
`utils/courtTimeline.js` (`findConflict(conn, { courtId, startLocal, endLocal, ignoreBookingId? })`):

- a game (`recording_sessions` not `Cancelled`/`Failed`);
- a booking that's `Confirmed`/`CheckedIn`, or `Pending` with `holdExpiresAt > now`;
- a closure on the court or the whole venue;
- outside opening hours (bookings only; staff can override with "Outside opening hours" on desk
  bookings).

`bookCourt()` and the booking create/move handlers both lock the **court row `FOR UPDATE`** first
(as `bookCourt()` already does) and then call `findConflict`. Two people can't take the same slot,
and a walk-in can't slip into a booked one. Consequences:

- **Court QR Start a game (CR-027)** on a free court still works. It now also refuses if a booking
  starts inside the chosen game time ("This court is booked from 3:00 PM — pick a shorter game
  time", the message that already exists for `busyFrom`).
- **Admin → Sessions → New game** gets the same refusal, with a link to the booking.
- A **check-in** passes `ignoreBookingId` so its own booking doesn't block it.

### API

**Public, no login** (`/api/v1/public/...`, rate-limited writes, token params validated with
`validateParams`, replies carry no business IDs or camera details):

| Endpoint | What |
| --- | --- |
| `GET /book/:bookingToken` | Venue name and logo, courts (name only), rules (slot length, max length, days ahead, cancel cut-off), whether online payment is on |
| `GET /book/:bookingToken/availability?date=YYYY-MM-DD` | Per court: the bookable start times for that date and the price of each length. Taken times come back only as "taken", with no names |
| `POST /book/:bookingToken/bookings` | `{ courtId?, date, startTime, durationMinutes, playerName, email, phone?, payMethod }`. The court is picked by its position/name key from the availability reply, not its business ID. Creates a `Pending` booking with a hold. `Online` → `{ checkoutUrl }`; `Desk` → `{ manageUrl }` |
| `GET /bookings/:manageToken` | The booking page: court, times, price, status, payment, booking code, what the player may do now (pay, cancel, move, check in), and the game link once checked in |
| `POST /bookings/:manageToken/pay` | The checkout for an unpaid `Pending` booking: the open invoice's `checkoutUrl`, or a new invoice if it expired while the hold is still live |
| `POST /bookings/:manageToken/cancel` | Only before the cut-off. A paid online booking gets a **full** Xendit refund; an unpaid desk hold has nothing to refund. After the cut-off → 409 ("Call the desk") |
| `POST /bookings/:manageToken/move` | `{ date, startTime }`, before the cut-off, **once** (`rescheduledCount = 0`), same length, new slot priced **≤** the snapshot `price` (the booking keeps its price; no partial refund). Locks, checks and moves in one transaction |
| `POST /bookings/:manageToken/check-in` | During `[startAt − checkInEarlyMinutes, endAt)`, `Confirmed` only (paid or Free). Creates the game → `{ shareUrl }` |
| `GET /courts/:qrToken` (changed) | Also returns `booking: { from, until }` when a booking holds the court now or within the early window, so the page asks for the booking code instead of the Start a game form |
| `POST /courts/:qrToken/check-in` (new) | `{ bookingCode }`. Checks in that court's current booking → `{ shareUrl }`. Rate-limited hard per IP (6-character codes): 5 wrong tries then a 15-minute lock |

**Xendit webhook** (`/api/v1/webhooks/xendit`, new route family): no login. Xendit sends its
**`x-callback-token` header**, which must equal `XENDIT_CALLBACK_TOKEN` (constant-time compare);
anything else → 401, nothing changes. Xendit doesn't sign the body, so the handler **never trusts
the payload's status or amount**. It reads the invoice back from Xendit's API by ID, and acts only
if Xendit says `PAID` and the amount equals `bookings.price`. The globally parsed JSON body
(`config/express.js`) is enough; no raw-body handling is needed.

On a paid invoice, the handler:

1. finds the booking by `checkoutId` (our own column);
2. inserts a `payments` row (`method ONLINE`, `provider 'xendit'`, `providerRef` = invoice ID,
   unique, so a retried webhook does nothing);
3. sets the booking to `Paid` + `Confirmed`.

Steps 2 and 3 happen in one transaction. A payment that arrives after its hold expired still
confirms the booking **if the slot is still free**. Otherwise it is refunded automatically and the
player is emailed. The handler always answers 200 once the token checks out, so Xendit stops
retrying events we've already handled.

**Admin** (`/api/v1/admin/...`, `requireAuth` + `auditTrail`):

| Endpoint | Permission | What |
| --- | --- | --- |
| `GET /bookings?venueId&date&status&search` | `bookings` read | List, plus a `day` view: courts × hours for one date (bookings, games, closures) |
| `GET /bookings/:bookingId` | `bookings` read | One booking with its payments and game |
| `POST /bookings` | `bookings` write | Desk booking: court, date, start, length, name, phone, email, and one of **Paid now (cash)** · **Hold, pay at desk** (released `deskHoldMinutes` before the start, like online desk holds) · **Free**. "Paid now" records the cash payment in the same transaction. That needs `payments` write too, otherwise the option is hidden and the API refuses it with 403 |
| `PUT /bookings/:bookingId/move` | `bookings` write | Any time before it starts, any number of times (the one-move limit is for players); price kept unless staff tick "Reprice" |
| `POST /bookings/:bookingId/cancel` | `bookings` write | Any time before check-in, even after the player's cut-off. Reason required, and **Refund** (on by default when paid; all of it or nothing). Online refund goes through Xendit; a cash refund is a `Refunded` payment row (reuses the CR-015 refund) |
| `POST /bookings/:bookingId/check-in` | `bookings` write | Staff check the player in (the player has no phone, the QR is damaged…) |
| `POST /bookings/:bookingId/no-show` | `bookings` write | Mark early. The job also does it after the end |
| `POST /bookings/:bookingId/payments` | `payments` write | Record a cash payment → `Paid` (+ `Confirmed` if `Pending`) |
| `POST /bookings/:bookingId/resend` | `bookings` write | Resend the confirmation email |
| `DELETE /bookings/:bookingId` | `bookings` write | Soft delete (a mistake with no payments) |
| `GET/PUT /booking-settings/:venueId` | `bookings` read / write | Rules, hours and rates for a venue (one form), plus its courts |
| `POST /booking-settings/:venueId/link` · `DELETE …` | `bookings` write | Issue a new link / turn online booking off |
| `GET/POST/PUT/DELETE /closures` | `bookings` read / write | Closures; the POST reply lists bookings in the way unless `cancelConflicts: true` |

Every by-ID endpoint returns 404 for a `Deleted` booking or closure and leaves it unchanged, and
gets a test.

### Online payments

- **Provider: Xendit**, with **one Dyna Cam account** for every venue. Each booking is a
  **Xendit Invoice**, a hosted checkout page that offers the account's enabled methods (GCash, Maya,
  ShopeePay, cards…). Its `external_id` is the `bookingId`; its `invoice_duration` is the hold
  (`onlineHoldMinutes`); its `success_redirect_url` / `failure_redirect_url` point to
  `/booking/<manageToken>`.
- The code sits behind `lib/payments/xendit.js`: `createInvoice(booking)`, `getInvoice(id)`,
  `expireInvoice(id)` (on cancel or move of an unpaid booking), `refund({ invoiceId, amount,
  reason })` (Xendit's Refunds API), and `checkCallbackToken(header)`. A second provider would be
  one more file in `lib/payments/`.
- `.env`: `XENDIT_SECRET_KEY`, `XENDIT_CALLBACK_TOKEN`. When either is empty, online payment is
  **off** and the booking page offers "Pay at the desk" only, like SendGrid's "configured or not"
  switch. Test-mode keys work the same way, for development.
- The return redirect only brings the player back to `/booking/<manageToken>`, which polls until
  the webhook lands. **The redirect never confirms anything; only a verified webhook does.**
- The amount always comes from `bookings.price`, never from the client.
- Money from every venue lands in the one Dyna Cam balance. Settling with venues is done outside
  the system. The Payments page's per-venue totals (method Online) are the statement to settle
  from.
- **Refunds:** player cancels before the cut-off → full refund. Staff cancel → full refund or
  none, their choice. A late webhook on a lost slot → full refund. Each refund is recorded on the payment
  row (`Refunded`, `refundedAt`). If Xendit refuses one (e.g. a method that can't be refunded),
  the booking is still cancelled and the payment is flagged **Refund failed** so staff can repay
  by hand.

### Notifications (email, through `lib/mailer`)

New templates in `templates.js`, sent by a new `utils/bookingEmails.js`. Each send is recorded on
the booking, so a retry doesn't send it twice:

| Email | When | Contains |
| --- | --- | --- |
| Booking confirmed | Booking becomes `Confirmed` | Venue, court, date, times, price, paid / pay at desk, **booking code**, manage link, how check-in works |
| Pay at the desk reminder | Created as a desk hold | The deadline (`startAt − deskHoldMinutes`) |
| Reminder | ~2 h before the start (`jobs/bookingMaintenance.js`) | Times, booking code, "scan the court QR when you arrive" |
| Cancelled | Player, staff, a closure or an expired hold | Who cancelled, the refund (amount and method) |
| Moved | After a move | Old and new times |
| Game started | At check-in | The game page link (`/session/<shareToken>`). The existing CR-018 Drive email follows after the game |

Email is required for **online** bookings (it's how the player gets the link back) and optional
for desk bookings. SMS is out of scope; the phone is kept for the desk.

### Background job: `jobs/bookingMaintenance.js` (every 60 s, like the others)

1. `Pending` past `holdExpiresAt` → `Expired`, then the cancellation email. Desk holds expire at
   `startAt − deskHoldMinutes`.
2. Reminder emails for `Confirmed` bookings starting within 2 h with `reminderSentAt IS NULL`.
3. `Confirmed` with `endAt <= now` and no check-in → `NoShow`.
4. `CheckedIn` whose game has ended (`Processing`/`Ready`/`Failed`) → `Completed`.

### Check-in → game

`checkInBooking(conn, booking)` in `utils/bookingCheckIn.js`, used by the public and Admin
check-in endpoints:

- It runs inside a transaction, locks the booking `FOR UPDATE`, and needs status `Confirmed`
  (`paymentStatus` `Paid` or `Free`). An unpaid booking is refused ("Pay at the desk first"). In
  practice an unpaid hold has already been released `deskHoldMinutes` before the start.
- It calls `bookCourt()` with `startLocal = max(now, booking.startAt)`, `endLocal = booking.endAt`,
  `status` `Recording` (or `Scheduled` if they're early: `advanceSessions` starts it at
  `startAt`), `free: true`, `maxCaptures: PLAYER_MAX_CAPTURES` (5, as decided),
  `playerName/phone/email` from the
  booking, and the new `bookingId`. Recording time always stays inside the paid time.
- It sets `bookings.sessionId` and `status = 'CheckedIn'`, then sends the Game started email.
- **Camera offline** → 503 like Start a game today, and the booking stays `Confirmed`. Staff can
  still check it in from Admin once the camera is back. Recording is the product, so a booking
  can't be checked in without it; a "play without video" check-in is out of scope.
- Checking in late gives a shorter game. The slot isn't extended, because the next booking may be
  right after.

### UI: player (mobile-first, `front/src/pages/Public/`)

- **`Book/`** (`/book/:bookingToken`): venue header → date strip (today … `bookingDaysAhead`) →
  length picker (1 h, 2 h … up to the max) → per-court hourly time chips with prices (taken /
  closed greyed) → details (name, email, phone with `PHONE_PLACEHOLDER` / `formatPhoneOnChange`)
  → **Pay now (GCash, Maya, card…)** (opens the Xendit invoice) or **Pay at the desk** (with "held
  until <start − 30 min>") → redirect.
- **`Booking/`** (`/booking/:manageToken`): status card, booking code (big, copyable), times,
  court, price and payment, and the actions allowed now: Pay, Cancel ("Full refund until <cut-off
  time>"), Move ("You can move this booking once", the same picker showing only slots at the same
  or lower price), Start game (during the check-in window), Watch your game (after check-in).
  Past the cut-off it shows "To change this booking, call <venue phone>". It polls while
  `Pending` after a checkout return.
- **`Court/`** (changed): when the court is booked now, it shows "Booked 3:00–4:00 PM · Enter your
  booking code" (6-character input → check-in → redirect to `/session/:shareToken`) instead of the
  Start a game form. Outside booked time, the CR-027 form stays, with the new cap of "until the
  next booking".
- Routes registered in [`routes/index.jsx`](../../../front/src/routes/index.jsx) beside
  `/court/:qrToken`.

### UI: Admin (`front/src/pages/Admin/`)

- **Dyna Cam → Bookings** (new page, `bookings` read), first item in the Dyna Cam group:
  - **Day view** (default): venue + date pickers, a grid of courts × hours showing bookings
    (by status colour token), running games and closures. Click a free cell → New booking
    drawer, prefilled. Click a booking → detail drawer.
  - **List view**: the standard `DataTable` page (search by name / phone / code, status, date
    range, venue), stat cards (today's bookings, unpaid, no-shows this week, revenue today).
  - **New booking drawer** (`BookingFormDrawer.jsx`, owns its `<Sheet>`): court, date, start,
    length (price shown live from the API's quote), name, phone, email, payment option.
  - **Booking detail drawer**: timeline (created, paid, emails sent, checked in, game link),
    actions Record payment, Move, Cancel/Refund, Check in, No-show, Resend.
- **Setup → Venue → Bookings** (new section on [VenueDetail](../../../front/src/pages/Admin/Setup/VenueDetail/),
  `bookings` write): online link (copy / QR / print sign, reusing the
  [CourtSign](../../../front/src/pages/Admin/Setup/CourtSign/) print layout), rules, a weekly hours
  editor, a rates table, and a **Closures** list with Add closure.
- **Sessions**: Started by shows "Booking K7QM2P" (link to the booking). New game's busy error
  names the booking.
- **Payments**: booking payments listed with "Booking" as the item, plus a method column
  (Cash / Online).
- Sidebar: the Dyna Cam group's `anyOf` gains `bookings` read.

### Alternatives considered

- **Reuse `recording_sessions` as the booking (status `Scheduled`)**, the PLAN-002 approach:
  rejected. A game must be the real recording (CR-005), and a booking has its own life (holds,
  payments, no-shows, moves) that would clutter every session query and the recorder box's view of
  what to keep.
- **Auto-start recording at the booked time**: rejected in favour of check-in. A no-show would
  fill the recorder box's disk for nothing, and anyone on the court would get recorded.
- **Player accounts**: rejected for v1. The booking code + manage link fits the existing
  "the token is the credential" model, and accounts would be a new auth system.
- **PayMongo instead of Xendit**: first proposed. Dropped because the business uses Xendit.
- **xenPlatform sub-accounts, or each venue's own Xendit keys**: money would settle straight to
  each venue. Rejected for v1 (one Dyna Cam account) because it needs xenPlatform approval and
  per-venue onboarding or encrypted per-venue keys. The `lib/payments/xendit.js` seam keeps a later
  move to sub-accounts (the `for-user-id` header) contained.
- **Xendit Payment Requests API (direct e-wallet charge) instead of Invoices**: more control, but
  we'd build each method's UI. The hosted Invoice page covers every enabled method with one
  integration.
- **"Pay later" check-in for regulars**: rejected. Every booking is paid (or Free) before it
  plays.
- **30-minute or per-venue grid**: rejected; 60 minutes everywhere keeps pricing and the day view
  simple.

## Affected areas

| Area | Files / tables | Change |
| --- | --- | --- |
| Database | `back/database/migrations/030_`–`033_` | `venues` booking columns, `venue_hours`, `court_rates`, `court_closures`, `bookings`; `recording_sessions.bookingId`; `payments.bookingId` + `ONLINE` method + provider columns; `bookings` permission |
| Seed | `back/scripts/setup-database.js` | `bookings` permission |
| API: shared | `utils/courtTimeline.js`, `utils/bookingPrice.js`, `utils/bookingCheckIn.js`, `utils/bookingEmails.js`, `utils/gameStart.js` (uses the timeline) | New overlap rule, pricing, check-in, emails |
| API: public | `controllers/v1/public/booking.controller.js` (new), `public.controller.js` (court page + check-in) | Booking page, availability, create/pay/cancel/move/check-in |
| API: admin | `controllers/v1/admin/bookings.controller.js`, `closures.controller.js`, `booking-settings.controller.js` (new); `sessions.controller.js`, `payments.controller.js` (booking columns) | Desk bookings, settings, closures |
| API: payments | `lib/payments/xendit.js`, `controllers/v1/webhooks/xendit.controller.js`, `routes/route.js` | Invoices, webhook, refunds |
| API: jobs / mail | `jobs/bookingMaintenance.js`, `lib/mailer/templates.js` | Holds, reminders, no-shows, completion; email templates |
| Validators | `validators/bookings.validator.js`, `booking-settings.validator.js`, `closures.validator.js`, `public.validator.js` | Every new body/query/param |
| Tests | `back/tests/bookings*.test.js` | See checklist |
| UI: public | `front/src/pages/Public/Book/`, `Public/Booking/`, `Public/Court/` (changed), `routes/index.jsx` | Booking, manage, check-in |
| UI: admin | `front/src/pages/Admin/DynaCam/Bookings/`, `Setup/VenueDetail/` (Bookings section), `DynaCam/Sessions/`, `DynaCam/Payments/`, `routes/pageRoutes/AdminRoute.jsx` | Bookings page, venue settings, links |
| Services | `front/src/services/api/{admin,public}/bookings.js`, `services/requests/…` | Axios + React Query |
| Permissions | `bookings` / `null` (new); `payments` / `null` (existing, for money) | Read = see bookings and settings; write = create, move, cancel, settings |
| Env | `back/.env.example` | `XENDIT_SECRET_KEY`, `XENDIT_CALLBACK_TOKEN`, `BOOKING_REMINDER_MINUTES` (default 120) |
| Recorder box / app | — | No change: the game is an ordinary `recording_sessions` row |

## Out of scope

- Player accounts, booking history and saved payment methods.
- SMS or Messenger notifications (email only).
- Recurring bookings (every Tuesday 7 PM), memberships, packages, open-play / per-head pricing.
- Splitting payment between players, promo codes and discounts.
- Opening hours past midnight.
- A public list of venues; each venue shares its own `/book/` link or QR.
- Reports beyond the stat cards and the existing Payments page; Dashboard booking insights can be
  a later CR.
- The staff mobile app (`app/`): staff booking work happens on the web, as with payments.
- Playing a booking without the camera recording.

## Risks

- **Double booking under load.** Two players pay for the same slot at once. Mitigation: every
  create, move, check-in and game start locks the court row `FOR UPDATE` and checks the one
  timeline. Holds count as taken. A webhook for a slot lost after hold expiry refunds itself. A
  concurrency test covers it.
- **Webhook trust and retries.** A forged or replayed webhook could confirm unpaid bookings, and
  Xendit's callback token is a shared secret, not a signature. Mitigation: constant-time token
  check; re-read the invoice from Xendit's API and require `PAID` + our amount; look up by our own
  `checkoutId`; unique index on `providerRef`; never confirm from the redirect.
- **One balance for every venue.** All online money lands in Dyna Cam's Xendit account, so venues
  depend on the settlement. Mitigation: Payments shows per-venue online totals for each period;
  sub-accounts stay a later option (see Alternatives).
- **Booking code guessing at the court QR.** Mitigation: a code works only for the court's current
  booking, the attempt limit is per IP and per court, and a wrong code reveals nothing.
- **Walk-in Start a game (CR-027) now shrinks around bookings.** Players may be confused that the
  QR offers less time. Mitigation: the page says "until 3:00 PM (booked after that)".
- **Gateway fees on refunds.** Players get a full refund before the cut-off, so Xendit's fee on
  that payment is a cost to the business. Mitigation: the cut-off (default 24 h) is shown before
  paying. Some methods may not be refundable through the API; those are flagged **Refund failed**
  for staff to repay by hand.
- **Time zone.** All times are Manila local (`getCurrentTimestampLocal()`, `moment.tz`); the
  availability grid is computed server-side, so a phone in another zone still shows venue time.
- **Scope size.** This is the largest piece since PLAN-001. Mitigation: the checklist is phased so
  the desk-only flow (Phases A–D) works end to end before online payments (Phase F).

## Open questions

- [x] **Payment gateway:** Xendit.
- [x] **Whose Xendit account:** one Dyna Cam account; venues are settled outside the system.
- [x] **Cancellation refund:** full refund before the cut-off; no player cancel after it (staff
      still can).
- [x] **Moving to a pricier slot:** refused; cancel and rebook.
- [x] **How many moves:** one per booking (players); staff unlimited.
- [x] **Pay-later check-in:** no. A booking must be paid or Free to check in.
- [x] **Desk-hold deadline:** released 30 minutes before the start (per-venue `deskHoldMinutes`).
- [x] **Slot grid:** 60-minute steps only.
- [x] **Booked games' saves:** 5.
- [x] **Buffer between bookings:** none.
- [ ] **Xendit account setup:** which payment methods are enabled on the account (decides what
      the checkout shows), and are refunds enabled for them? Needed before Phase F goes live, not
      before building it in test mode.

## Revisions

- 2026-11-23: Created. Decisions on who books, payment, check-in and v1 extras taken with
  bryanken00.
- 2026-11-23: Open questions answered (bryanken00): payments through **Xendit** (one Dyna Cam
  account, Invoices + callback-token webhook, replacing PayMongo); full refund before the cut-off;
  one player move to a same-or-cheaper slot; no "pay later" (paid or Free to check in); desk holds
  released 30 min before the start; 60-minute grid only (`slotMinutes` dropped); 5 saves; no
  buffer.
- 2026-11-23: Phase A built (status In progress). Booking settings live at
  `/admin/booking-settings/:venueId` (their own route group with the `bookings` permission)
  instead of under `/admin/venues`, since one route group keeps one permission. A closure's
  `cancelConflicts` only marks bookings `Cancelled` for now; refunds and emails join in Phase B,
  F and G.
- 2026-11-23: Phase B built. Staff refunds are all-or-nothing (no partial refunds — the payments
  table has no refund amount, and partial refunds weren't asked for). A booking payment is refunded
  only by cancelling the booking (Payments → Refund refuses it), so the slot is freed with it. The
  venue page stays limited to venues / courts permissions: desk staff work from Bookings, and
  whoever edits booking settings also manages the venue. Open games (no game time) now check the
  next 6 hours for bookings and closures, and Add time locks the court row and checks the timeline.
