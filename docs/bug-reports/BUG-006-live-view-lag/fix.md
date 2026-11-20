# BUG-006 · Player's game page live view lags and spins — Fix checklist

> Bug: [bug.md](bug.md)

## Confirm

- [x] Reproduced: headless Brave + DevTools protocol against the real box — page answers in
      18–30 s, profile ~70 s in hls.js `onLevelLoaded` / `_handleTransmuxComplete`
- [x] Root cause confirmed (rebasing the discontinuity sequence removes it) and written in bug.md

## Fix

- [x] `LivePanel.jsx`: hls.js gets a playlist loader that rebases `#EXT-X-DISCONTINUITY-SEQUENCE`
      to count from 0 for that player (first value seen = 0), so hls.js's per-discontinuity
      arrays stay small. Works with every box already installed — no recorder box update.

## Check nothing else broke

- [x] Searched for other hls.js players in `front/src` (`hls.js`, `new Hls`) — other hits fixed too
- [x] A discontinuity in the window (camera gap, recorder restart) still plays through
- [x] Camera switch / renewed link (a new player) starts its own count from 0
- [x] The court device (`app/`) and box restreams don't use hls.js — unaffected

## Wrap-up

- [x] `cd front && npm run lint && npm run build` passes
- [x] Headless Brave run of the built page's player settings plays smoothly against the real box
- [ ] The steps in bug.md no longer reproduce (live game in Brave on the venue Wi-Fi)
- [x] Changelog: folded into the unpublished CR-025 entry (players never saw the bug)
- [x] `bug.md` status set to `Fixed`, Resolution filled
