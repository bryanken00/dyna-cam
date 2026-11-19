---
type: improved
impact: patch
audience: user
ref: CR-012
---

The courtside app now matches the website's pickleball look: navy buttons, blue links, a soft
lime highlight, a navy dark mode, the Dyna Cam court logo, and a navy header on the screen where
you enter the pairing key.

## Dev notes

- app/: `global.css` and `src/lib/theme.js` on the website's palette (keep them in step);
  `brand` colours in `tailwind.config.js`; `LogoMark` is the court mark; Pair screen header.
  JavaScript only, so it reaches phones with the next app update.
- app/: `app.json` Android adaptive icon background `#0F3264` — needs a new build to show on
  installed phones. The icon and splash pictures themselves are still the placeholder.
