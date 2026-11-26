# CR-045 · No court QR, no booking code for players

> **Status:** In progress · **Requested:** 2026-11-26 · **Requested by:** bryanken00 · **Size:** M
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [PLAN-006](../../plans/PLAN-006-player-google-sign-in/plan.md) (players sign in with Google), [CR-034](../CR-034-court-qr-booking-only/request.md) (court QR check-in by booking code), [CR-030](../CR-030-player-booking-entry/request.md) (Find my booking), [CR-027](../CR-027-player-start-game-qr/request.md) (court QR)

## Requested change

Players no longer use a QR code on the court or a booking code. They start the camera from their
booking's page, which they open from My games or from the link in their confirmation email: on the
day, they tap **I'm at the court — start recording**. Remove the booking code and the court QR from
everything players see.

## Today

- **Booking page:** shows **Your booking code** (e.g. K7Q M2P) and says to scan the QR sign on the
  court and enter the code. Its **I'm at the court — start recording** button also works, with "Or
  scan the QR sign…" under it.
- **Courts:** each court has a printed QR sign (Admin → the court → QR sign → Print). It opens a
  page where the player types their booking code to start recording.
- **Find my booking:** finds a booking by its code plus phone or email.
- **Emails:** booking emails list the booking code, and say to scan the QR sign and enter the code.
  The pay-at-desk email says to show the code at the desk.
- **Elsewhere:** `/book`'s "How booking works" and the landing page describe the QR + code steps.

## Why

Since PLAN-006 every online booking belongs to a signed-in player, whose bookings are in My games,
and every booking email links to the booking's page. The code and the QR sign are an extra step
players no longer need. (bryanken00: "We no longer provide QR Code for camera on the court. … We
don't need booking code anymore.")

## Scope

**In**

- **Booking page:** the **Your booking code** card and the QR hints are removed. A short note says
  when and how to start recording ("From 5:50 PM, open this page at the court and tap I'm at the
  court — start recording").
- **Court QR:** the court QR check-in page and its API are removed, and so are the court's QR sign
  section and printable sign in Admin. An old printed sign opens a page that says recording now
  starts from your booking, with **My games** and **Book a court**.
- **Find my booking** is removed (page and API). `/booking` goes to My games, and "Already booked?"
  on `/book` points to My games.
- **Emails:** no booking code. Confirmation and reminder emails explain how to start recording
  (open the booking page, tap the button) next to **Open your booking**. The pay-at-desk email says
  to give your name at the desk.
- **Wording:** `/book`'s "How booking works" and the landing page describe the new steps.

**Out**

- **Admin:** staff still see the code in Bookings, the day grid and Sessions, as a reference for
  searching and on online payments. See Open questions.
- **Database:** the `bookingCode` column stays; it's the reference on Xendit invoices.
- **Game pay codes** for old unpaid games, a different code at the front desk: unchanged.
- **Venue booking sign:** the printed sign with the venue's online booking link stays. It's for
  booking, not for the camera.

## Acceptance criteria

- The booking page shows no booking code and no QR instructions; on the day, **I'm at the court —
  start recording** starts the game.
- Booking emails have no booking code; the confirmation explains how to start recording and links
  to the booking.
- Opening an old court QR link shows "open your booking" with links to My games and Book a court,
  and nothing can be started from it.
- `/booking` (Find my booking) opens My games.
- Admin → a court has no QR sign section and no printable sign.
- Staff can still check a booking in from Admin.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Player: booking page, court page (now a notice), Find my booking (gone), `/book`, landing page. Admin: court setup loses the QR sign section, the court sign print page is gone. |
| Data | None. `bookingCode` and `courts.qrToken` stay in the database. |
| API | Removed: `POST /public/courts/:qrToken/check-in`, `POST /public/bookings/find`. `GET /public/courts/:qrToken` stays as it was, for old signs (it shows no names or codes). The booking page's check-in now also says "Recording resumed" (CR-041), since it's the only way in. |
| Build / rollout | Web and API. No app or recorder box change. Printed court QR signs can come down. |
| Permissions | None. |
| Existing users | **Breaking for players:** no check-in by code at the court and no Find my booking. A desk booking without an email or Google sign-in is checked in by staff in Admin (already possible). |
| Size | M — mostly removals across pages, emails, Admin and their tests. |

## Open questions

- [ ] **Booking code in Admin:** keep it there as a staff reference (chosen for now), or remove
      it from Admin too and name bookings by player and time?

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-26 | Asked directly; court QR removed fully, no booking code for players, emails explain starting the camera |
