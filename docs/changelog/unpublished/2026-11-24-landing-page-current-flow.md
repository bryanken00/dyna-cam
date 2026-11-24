---
type: improved
impact: patch
audience: user
ref: CR-042
---

The home page now explains how DGSports works today: book a court and pay online or at the desk,
check in at the court with your booking code, watch live and save your best rallies, then get the
whole game from Google Drive. The venue section lists online booking, check-in at the court, videos
straight to the venue's Google Drive and the TV court board, and the privacy note says videos never
pass through our servers. Staff sign-in now mentions bookings and payments, without the icon above its title.

## Dev notes

- front/: copy only, in `pages/LandingPage/index.jsx` (`STEPS`, `DURING_GAME`, `VENUE_FEATURES`,
  section bodies, privacy note), `pages/Admin/Login.jsx` subtitle (and no heading icon) and `components/AuthLayout.jsx`
  tagline. Removed claims: walk-in games from the court QR, on-site playback, logo on every replay,
  7 days + 2 days in Drive.
