# CR-012 · Session device app in the pickleball brand — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)

## Build

- [x] `global.css` + `src/lib/theme.js`: the website's palette (light and dark), brand colours
- [x] `tailwind.config.js`: `brand` colours
- [x] `LogoMark`: the court mark on a navy tile
- [x] Pair screen: navy header panel with the court logo; the key hint speaks to players and
      keeps the staff path (Sessions → the game → Pair a device)
- [x] `app.json`: Android adaptive icon background navy
- [x] Docs: mobile-conventions (palette, primary button, brand colours)

## Acceptance

- [x] Pair, Session, Ended in the new colours, light and dark (on a device)
- [x] Pair screen navy panel with the court logo (on a device)
- [x] Pairing and the game work as before (on a device)

## Wrap-up

- [x] `npx expo export --platform android --clear` bundles (3639 modules)
- [x] `npx expo-doctor@latest` — 1 check fails: 11 Expo packages behind SDK 58 (was already failing;
      PLAN-001)
- [x] Changelog entry added (`ref: CR-012`)
- [x] Requester shown the result and signed off
- [x] `request.md` status set to `Done`
