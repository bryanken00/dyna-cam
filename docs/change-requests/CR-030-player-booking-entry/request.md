# CR-030 · A way in for players to book a court

> **Status:** In progress · **Requested:** 2026-11-23 · **Requested by:** bryanken00 · **Size:** M
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [PLAN-003](../../plans/PLAN-003-court-booking/plan.md) (court booking)

## Requested change

> Where to book? it must have UI for player can access

A player should be able to find where to book a court on their own, without being handed a link,
and find their booking again if they lose the link.

## Today

- Each venue has its own booking page. The only way to reach it is the link or QR code that staff
  copy or print from the venue's setup page in Admin.
- Nothing a player can open by themselves leads there:
  - the home page says nothing about booking;
  - a court's QR page only starts or checks in a game.
- A booking's own page (pay, check in, cancel, move) is reached only through its link. That link
  is in the confirmation email, or staff copy it from the booking. A player who lost it has no way
  back in.

## Why

Online booking only brings in bookings if players can find it. Venues shouldn't have to hand out
links for every booking, and players lose emails.

## Scope

**In**

- A public **Book a court** page listing every venue that takes online bookings: its name,
  address, logo, number of courts, and today's hours. Each venue opens its booking page.
- **Book a court** on the home page: in the top bar and as the hero's main button.
- **Book this court ahead** on a court's QR page, when its venue takes online bookings.
- **Find my booking**: a player enters their booking code plus the phone number or email they
  booked with, and lands on their booking's page. A booking link that no longer works points
  there too.

**Out**

- Choosing which venues are listed. Every venue with online booking turned on is listed, and
  turning online booking off removes it.
- Maps, distance, or searching by location (a plain text filter only).
- Player accounts or a "my bookings" history.

## Acceptance criteria

- The home page has **Book a court** in the top bar and in the hero. It opens a page listing the
  venues that take online bookings.
- A venue with online booking off, or Inactive, isn't listed.
- Picking a venue opens its booking page.
- A court's QR page offers **Book this court ahead** when its venue takes online bookings, and
  doesn't when it doesn't.
- **Find my booking** with the right code and phone, or the right code and email, opens the
  booking's page.
- A wrong code or a wrong phone/email shows the same "no booking matches" message. It doesn't
  reveal whether the code exists.
- Too many tries in a minute are refused for a while.

## Impact

| Area | Detail |
| --- | --- |
| Screens | New public pages `/book` (venues) and `/booking` (find my booking); home page top bar and hero; court QR page; the booking page's "link not valid" state |
| Data | None (no migration). New public API `GET /public/venues` and `POST /public/bookings/find`; `GET /public/courts/:qrToken` adds the venue's booking link |
| Build / rollout | None (web and API only) |
| Permissions | None (public pages, no login) |
| Existing users | Nothing changes for staff. Every venue with online booking on now appears in a public list. Before, only people given its link could find it. |
| Size | M: two small public endpoints with tests, two small pages, three links |

## Open questions

- [ ] Should a venue be able to stay off the public list while still taking online bookings
      through its link? (Not built. Today on = listed.)

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-23 | Asked directly |
