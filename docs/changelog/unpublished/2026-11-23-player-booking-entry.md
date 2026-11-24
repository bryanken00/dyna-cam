---
type: added
impact: minor
audience: user
ref: CR-030
---

Players can now find where to book on their own:
- **Book a court** on the home page lists every venue taking online bookings, with its address,
  courts and today's hours.
- A court's QR page offers **Book this court ahead**.
- **Find my booking** opens a booking from its code plus the phone number or email it was made
  with, for anyone who lost the link.

## Dev notes

- back/: `GET /api/v1/public/venues`; `POST /api/v1/public/bookings/find`, rate-limited by the new
  `RATE_LIMIT_PUBLIC_FIND_POINTS` (default 5 a minute). `GET /public/courts/:qrToken` now returns
  `bookingToken`.
- front/: new pages `/book` and `/booking`. The public top bar's name links home.
- Every venue with online booking on is now listed publicly. Turning a venue's online booking
  off takes it off the list.
