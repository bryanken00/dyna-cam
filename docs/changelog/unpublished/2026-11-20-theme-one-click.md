---
type: improved
impact: patch
audience: user
ref: CR-022
---

The theme button changes the theme with one click — Auto, then Light, then Dark — instead of
opening a menu. Its icon shows the current theme, and hovering it says what the next click does.

## Dev notes

- front/: `components/ThemeToggle.jsx` is a plain button cycling `auto → light → dark`
  (Admin top bar, player pages, landing page). The theme store is unchanged.
