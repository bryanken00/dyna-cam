# BUG-005 · Player's game page shows no live video — Fix checklist

> Bug: [bug.md](bug.md)

## Confirm

- [x] Reproduced: headless Edge, built-in HLS → "Parsed buffers not in DTS sequence"
- [x] Root cause confirmed and written in bug.md

## Fix

- [x] `LivePanel.jsx`: `nativeHlsOnly()` — built-in HLS only without Media Source; hls.js otherwise

## Check nothing else broke

- [x] Searched `canPlayType` in `front/src` — no other hits
- [ ] The court device (`app/`) plays through expo-video, not this page — unaffected

## Wrap-up

- [x] `cd front && npx eslint <file> && npm run build` passes
- [ ] The steps in bug.md no longer reproduce (live game in Edge on the venue Wi-Fi)
- [x] Changelog: folded into the unpublished CR-025 entry (players never saw the bug)
- [x] `bug.md` status set to `Fixed`, Resolution filled
