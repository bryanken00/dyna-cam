# CR-011 · Pickleball landing page — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)

## Build

- [x] Hero court drawing (`LandingPage/components/HeroCourt.jsx`): to scale, kitchens, net,
      Cam 1 / Cam 2, a rally arc drawn once on load, the 60-second replay bar (motion off with
      reduce motion)
- [x] New headline and copy; sections: how it works, whole games, for venues, privacy
- [x] Copy matches the product today (cash only, whole-game videos, two cameras, own stream,
      Drive, alerts)
- [x] Tab title "Dyna Cam" + page description
- [x] Brand colours (revision): `--color-brand-*` tokens, accent → lime, links → court blue; blue
      band + navy footer on the landing page, `.btn-on-navy` / `.btn-on-court`; design-system doc
      updated
- [x] Sign-in screens (revision): `AuthLayout` → blue band + brand court beside the form (strip on a
      phone), lime submit buttons on sign-in / forgot / reset, "Staff sign in"; court drawing and
      logo moved to `components/brand/` (`HeroCourt`, `CourtMark`) and shared
- [x] Whole Admin (revision): theme tokens — primary button lime/navy, cool light neutrals with navy
      text, navy dark mode, court-blue charts; court logo in the sidebar, court-blue icon on the
      current page; link variants of Button/Badge use the link colour
- [x] Court-blue stat card icons (`StatCard`), blue courts on the Dashboard (`CourtDiagram`), lime
      avatar
- [x] Sidebar and top bar stay light (revision: a navy sidebar and top bar were tried and
      dropped)
- [x] Design revision ("Improve UI and UX"): palette tokens (`--color-brand-*`, accent, link,
      primary button navy/white, light and dark neutrals); landing page rebuilt to the design
      (navy hero + tilted `.hero-card`, eyebrow + headline sections, 01–03 steps, navy call-out
      band, venues grid with icon tiles); sign-in navy panel and button, lime stripes removed;
      design-system docs updated
- [x] "How it works" = the staff-led game flow (4 steps); QR replay under "During your game";
      hero copy and nav updated

## Acceptance

- [x] Opens on the court picture with the new headline, light and dark *(screenshots, built site)*
- [x] No promise the product doesn't keep
- [x] Works on a phone (390 px, no sideways scroll); no "Staff sign in" button in the top bar,
      the footer link goes to the Admin portal
- [x] Tab says "Dyna Cam"
- [x] Staff sign-in matches the landing page, light and dark, desktop and phone *(screenshots)*
- [x] Landing page matches the design, light and dark, desktop and phone *(screenshots)*
- [x] Admin pages checked in the running app (sidebar, buttons, tables, drawers, light and dark)

## Wrap-up

- [x] `cd front && npm run lint && npm run build` passes
- [x] Changelog entry added (`ref: CR-011`)
- [x] Requester shown the result and signed off
- [x] `request.md` status set to `Done`
