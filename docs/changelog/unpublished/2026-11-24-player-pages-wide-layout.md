---
type: improved
impact: patch
audience: user
ref: CR-035
---

On a computer, a booking's own page, the game page and the Book a court venue list now use the
whole screen: the booking's status and code beside its details, the game's video beside its saves
and controls, and the venue list beside "Already booked?" and a short how-booking-works guide. Phones are unchanged.

## Dev notes

- front/: `pages/Public/Booking` and `pages/Public/Venues` use `PublicLayout wide` with a Tailwind
  `lg` two-column grid (venues: rows left, sidebar right). `pages/Public/Session` builds each section once and places it by screen width
  (`useWindowSize`, ≥ 1024 px → two columns; one column, phone order, otherwise or when there's
  no live view / video yet). The venue list's gap above "Already booked?" is back.
