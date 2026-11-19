---
type: improved
impact: minor
audience: user
ref: CR-011
---

The website has a new pickleball look in deep navy, blue and lime. The home page opens on a navy
hero with a court drawn on a tilted card, then shows how a game is recorded in four steps (ask
the front desk, get your pairing key, pair and play, get your video), what players can do during
it (save a 60-second replay, go live, watch from the bench), what venues get, and the privacy
note, exactly as the product works today. Staff sign-in has the same navy look, and across the Admin portal
buttons are navy, links and icons blue, and the Dashboard draws each court as a blue court. The
browser tab now reads "Dyna Cam".

## Dev notes

- front/: `pages/LandingPage/` rebuilt to the "Improve UI and UX" design; brand court and logo in
  `components/brand/` (`HeroCourt`, `CourtMark`), shared with `components/AuthLayout.jsx` (sign-in,
  forgot and reset password).
- front/: theme in `index.css`: `--color-brand-*` palette (navy `#0f3264`, blue `#2f5ba8`, lime
  `#a9cf45`); accent `#a9cf45`; links `#2f5ba8` (`#8fb0e8` dark); primary button
  `--color-btn-bg` navy / `--color-btn-text` white (white / navy in dark); light neutrals
  `#f8fafc` page; navy dark mode; `--chart-series-1` blue; `.hero-card`, `.btn-on-navy`,
  `.btn-on-court`, `.court-nav-link`, load animation `.landing-*` (stopped by reduce motion).
- front/: Button/Badge `link` variants use `--color-link`; stat card icons on a blue tile; the
  sidebar marks the current page with a blue icon.
- front/: the old landing copy promised GCash, Maya and card payments; it now says cash at the
  front desk. `index.html` title "Dyna Cam", description and theme colours.
