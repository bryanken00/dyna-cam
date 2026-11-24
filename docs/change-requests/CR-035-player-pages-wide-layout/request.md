# CR-035 · My booking, game page and venue list use the full screen on desktop

> **Status:** Done · **Requested:** 2026-11-24 · **Requested by:** bryanken00 · **Size:** M
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [CR-032](../CR-032-book-page-wide-layout/request.md) (the booking page's wide layout, done), [CR-030](../CR-030-player-booking-entry/request.md) (venue list)

## Requested change

> Some pages are still like this mobile view, center content only. Can you update it, like what we
> do on booking? It must still be responsive.

Give three more player pages the computer-screen layout the venue booking page got in CR-032
(chosen: My booking, the game page, the venue list), keeping the phone layout as it is.

## Today

My booking (a booking's own page), the game page and the Book a court venue list are one narrow
column in the middle of the screen on a computer, the same width as on a phone.

## Why

On a laptop or desktop most of the screen is empty and players scroll through one long column.

## Scope

**In**

- **My booking:** on wide screens, the status, booking code and what to do next on the left;
  the booking's details, paying, changing it and copying its link on the right.
- **Game page:** on wide screens, the live view and the game's videos on the left; the game's
  details, saves and controls on the right.
- **Venue list:** on wide screens, the venues as full-width rows on the left and a sidebar on the
  right with "Already booked?" and how booking works.
- Phones and small tablets keep today's single column.

**Out**

- The short single-form pages (court QR, Find my booking, test checkout, stream setup, clip) stay
  centered (asked, not chosen).
- Anything they do; layout only.

## Acceptance criteria

- On a computer screen, My booking shows two columns: status and code on the left, details and
  actions on the right.
- On a computer screen, the game page shows the live view / videos on the left and the rest on
  the right.
- On a computer screen, the venue list shows the venues on the left and "Already booked?" with
  how booking works on the right.
- On a phone each page looks and works as before.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Public `/booking/:manageToken`, `/session/:shareToken`, `/book` |
| Data | none |
| Build / rollout | none (web only) |
| Permissions | none |
| Existing users | Layout only on wide screens |
| Size | M — three pages, reusing CR-032's `wide` page frame |

## Revisions

- 2026-11-24: venue list — a 3-per-row grid left one venue at a third of the width under a
  full-width "Already booked?" ("fix UI"); now venue rows on the left, sidebar on the right.

## Open questions

- [x] Which pages → My booking, game page, venue list (bryanken00, 2026-11-24)

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-24 | asked directly |
