# CR-011 · Pickleball landing page

> **Status:** In progress · **Requested:** 2026-11-19 · **Requested by:** bryanken00 · **Size:** L
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** PLAN-001 (Phase 0 replaced the template landing page)

## Requested change

Make the public home page look and read like a pickleball product, with a new title: "Can you
update the UI UX of this? also the title … like use for the pickleball."

## Today

The home page is a generic layout: a centred headline ("Relive your best rallies."), three step
cards, four feature cards and a privacy note. Some of it no longer matches the product: it
promises GCash, Maya and card payments (only cash at the front desk exists), and it says nothing
about whole-game videos, two cameras per court, players' own live streams, Google Drive copies or
alerts. The browser tab says "Admin Template".

## Why

It's the first page a player or venue owner sees. It should look like it belongs at a pickleball
court and say what Dyna Cam really does.

## Scope

**In**

- A new hero: a pickleball court drawn from above (kitchens, net, both cameras) with a rally and
  the 60-second replay it saves, and a new headline.
- How it works for players (scan, save, share), the whole-game recording and own live stream,
  what venues get, and the privacy note, all rewritten to match what the product does today.
- The browser tab title "Dyna Cam" and a page description for search and link previews.

**Out**

- New features, prices, sign-up or a contact form.
- Photos or video of real courts (none available yet).

## Acceptance criteria

- The home page opens on a pickleball court picture with the new headline, in light and dark.
- Nothing on the page promises something the product doesn't do (no online payments).
- It reads well on a phone. There is no "Staff sign in" button in the top bar; staff reach the
  Admin portal from the small link in the footer (or `/admin`).
- The browser tab says "Dyna Cam".

## Impact

| Area | Detail |
| --- | --- |
| Screens | Public home page (`/`), staff sign-in, forgot and reset password, browser tab title, and every Admin page (sidebar, buttons, backgrounds, text, links, charts). |
| Data | None. |
| Build / rollout | None (web only). |
| Permissions | None. |
| Existing users | None. |
| Size | L: landing page and sign-in rebuilt, the whole web theme rebranded. |

## Open questions

- [ ] Real photos of a venue's courts for later?

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-19 | Asked directly |

## Revisions

- 2026-11-19: The "Staff sign in" button is removed from the top bar (requester). The footer
  keeps a small "Staff sign in" link.
- 2026-11-19: **Brand colours from the venue's wall art** (requester: "The color theme must like
  this"): court blue `#2d5cb3`, pickleball lime `#8ddc02`, navy `#1e2332`, white, an orange flash.
  The landing page opens on a blue band (top bar + hero, a real blue court with white lines and
  the lime ball, lime "See how it works" button) and ends on a navy footer; step numbers are court
  blue. Across the web app the accent (focus rings, ticks, chips, spinners) is now the lime and
  text links are court blue; the Admin keeps its neutral surfaces and black/white buttons.
- 2026-11-19: **Staff sign-in in the same look** (requester: "on /admin must update also the UI UX
  based on landing page"). The sign-in, forgot-password and reset-password screens share one
  layout: the court-blue band with the logo, the brand court and "Courts, games, replays and
  payments, all in one place." beside the form, a lime stripe between them, lime buttons. On a
  phone the band is a strip above the form. The heading is now "Staff sign in".
- 2026-11-19: **The whole Admin portal in the brand** (requester: "Update the whole /admin/*").
  Done through the theme, so every page follows: the sidebar is navy with the court logo and a lime
  active item; primary buttons are lime with navy text; light mode is cool blue-grey with navy
  text, dark mode is deep navy; charts and links are court blue. Status colours (OK, warning,
  error) are unchanged. Size raised to L.
- 2026-11-19: The page content didn't match the navy sidebar (requester, with a screenshot). The
  top bar is now navy too, with a lime line under it, so sidebar and top bar frame every page;
  stat card icons are court blue on a light blue tile; the Dashboard's courts are drawn as blue
  courts like the landing page (lime when a game is on); the account avatar is lime.
- 2026-11-19: **Sidebar and top bar back to light** (requester: "I dont want darkmode sidebard and
  header"). They follow the theme again; the brand stays in the court-logo tile, the lime bar and
  court-blue icon on the current page, the lime avatar, the blue stat icons and the blue courts.
- 2026-11-19: **Rebuilt to the "Improve UI and UX" design, and its colours everywhere**
  (requester, with the design). Palette: deep navy `#0f3264` bands, a lighter navy `#214271` for
  cards on them, brand blue `#2f5ba8` for small labels, numbers, icons and links (on a pale blue
  `#eaf1fe` tile), a softer lime `#a9cf45`, an off-white `#f8fafc` page with slate text. The
  landing page follows the design: navy hero with the court on a tilted card ("60 seconds ago" →
  "Saved now"), "One tap. That's it." with 01 / 02 / 03 steps and dividers, a navy "Built for
  busy courts" band with a white "Explore venue tools" button; whole games, venues and privacy
  restyled to match. Across the web app primary buttons are now **navy with white text** (white
  with navy text in dark mode), replacing the lime ones; dark mode is navy-based. Sign-in has the
  navy panel and button; the lime stripes are gone.
- 2026-11-19: **"How it works" is the staff-led game flow** (requester: the process is ask staff →
  pairing key → start recording). Four steps: ask the front desk, get your pairing key, pair and
  play, End game → one video per camera. The 60-second QR / court-button replay moves to "During
  your game" with going live and watching from the bench; the hero sentence and the nav follow.
