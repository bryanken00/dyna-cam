# CR-036 · Rebrand to DGSports: name, mark, colours and a web splash

> **Status:** Done · **Requested:** 2026-11-24 · **Requested by:** bryanken00 · **Size:** L
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [CR-011](../CR-011-pickleball-landing-page/request.md) (the pickleball brand this replaces)

## Requested change

> Can we change this Dyna Cam to DGSports? Also implement splash screen on web. Use the icons.
> Update the system theme. (brand kit: `temp/public`, `temp/splash`, `temp/brand`)

The product is called **DGSports** everywhere people see it on the web and in its emails, with
the DGPlay logo (`temp/brand/dgplay-logo-supplied.png`) and its blue-and-lime colours, icons made
from it, and the logo bouncing in when the site opens (see Revisions: this replaced the first
choice, the Court Monogram).

Decided (2026-11-24): rename the **web, API messages and emails** (the mobile app and recorder
box later); the splash plays **once per browser tab**; the colours **match the brand kit exactly**.

## Today

Everything is branded **Dyna Cam**: the page titles, the Admin sidebar and sign-in panel, the
player pages' top bar, the landing page, printed court and booking signs, emails, alert
messages and download file names. The mark is a court drawn from above; the colours are CR-011's
navy `#0F3264`, court blue and a soft lime `#A9CF45` on a cool white. There is no splash and only
an SVG favicon.

## Why

The service is launching as DGSports, with a finished brand kit (mark, colours, typeface, icons,
opening animation).

## Scope

**In**

- **Name:** "DGSports" on every web page (title, Admin sidebar and its menu group, sign-in,
  player pages, landing page, court and booking signs, error messages), in emails (sender name,
  subjects, footer), Discord alerts, Google Drive folder names for new courts, and downloaded
  video file names (`dgsports-game.mp4`, `dgsports-replay.mp4`).
- **Logo:** the DGPlay logo replaces the court mark (sidebar, sign-in, landing page, player
  top bar), redrawn from the kit's measurements; the wordmark in Space Grotesk ("DG" bold, "Sports"
  in the ball's lime on the blue band).
- **Icons:** favicon (SVG + 32 px), Apple touch icon, Safari pinned-tab mask, 192/512 and
  maskable icons in a web app manifest, theme colour.
- **Colours:** the DGPlay logo's blue `#174F8A`→`#4189C8`, white, the ball's lime `#E2F41F` and ink
  `#0B2333`. Light: cool-white page, dark text, blue buttons. Dark: a `#0B2333` page, light text,
  lime buttons.
- **Splash:** the logo bounces in on its blue, once per browser tab; a still logo for
  people who ask for reduced motion; never blocks the site (it gives up after a few seconds).

**Out**

- The mobile app (still "Dyna Cam"; its DGPlay icon needs a new store build) and the recorder
  box. The web's pairing dialog stops naming the app.
- The offline page in the kit: it needs a service worker, which the site doesn't have.
- Internal names (repository, folders, code identifiers, package names, existing Google Drive
  folders, which keep their names).

## Acceptance criteria

- The browser tab, the Admin sidebar, sign-in, the landing page, the player pages, the printed
  signs and emails say DGSports, with the new mark.
- The browser tab shows the DGSports icon; adding the site to a phone's home screen uses the
  DGSports icon.
- Opening the site plays the bounce-in once; reloading the same tab doesn't replay it; a new tab
  does.
- Light and dark themes use the kit's colours; buttons are blue (light) and lime (dark).
- Downloaded game videos are named `dgsports-game….mp4`.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Every web page (colours, mark, name); new splash; printed court / booking signs |
| Data | none — no migration. New courts' Drive folders are named "DGSports · …"; existing ones keep their name |
| Build / rollout | `front/.env` `VITE_APP_NAME`, `back/.env` `APP_NAME`, `MAIL_FROM`, `ALERT_DISCORD_USERNAME` → DGSports; reprint signs; new front dependency `@fontsource-variable/space-grotesk` |
| Permissions | none |
| Existing users | Same features; new name, look and download file names |
| Size | L — the whole web look, icons, splash, and name strings across front and back |

## Revisions

- 2026-11-24: the brand folder (`temp/brand`) arrived mid-build: the web uses the Court
  Monogram (`mark.mjs`) and Space Grotesk for the wordmark; the DGPlay logo (`dgplay.mjs`) is the
  native app's icon and stays out of this web change. Also fixed the landing hero's leftover
  "pick your game time" (walk-ins went in CR-034).
- 2026-11-24: "use this branding color and logo" (`temp/brand/dgplay-logo-supplied.png`) — the
  web now uses the **DGPlay logo** and its colours instead of the Court Monogram: the logo's blue
  `#174F8A`→`#4189C8`, white, the ball's lime `#E2F41F`, ink `#0B2333`. Light: cool-white page,
  blue buttons; dark: `#0B2333` page, lime buttons. The logo is redrawn as SVG from
  `dgplay.mjs`'s measurements (they match the supplied PNG within half a pixel) and every icon is
  generated from it by `front/scripts/brand-icons.mjs`. The kit's Lottie splash animated the old
  mark, so the splash is now a CSS bounce-in of the new logo; `lottie-web` is gone.
- 2026-11-24: "make the logo transparent" — the browser-tab icon and the in-app logo (sidebar,
  player top bar) drop the blue tile: the frame is the logo's blue on a light ground and white on a
  dark one (the favicon follows the device's colour scheme, the app logo the app's theme). Home-
  screen icons keep the tile (phones need an opaque icon).

## Open questions

- [x] Scope of the rename → web + API + emails (bryanken00, 2026-11-24)
- [x] Splash → once per browser tab (bryanken00, 2026-11-24)
- [x] Theme → match the brand kit exactly (bryanken00, 2026-11-24)

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-24 | asked directly |
