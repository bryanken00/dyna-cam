# BUG-006 · Player's game page live view lags and spins

> **Status:** Fixed · **Severity:** High · **Reported:** 2026-11-20 · **Reported by:** bryanken00
> **Fix checklist:** [fix.md](fix.md)

## Summary

On the player's game page (CR-025), the live video sits on a spinner for 20 seconds or more, then
plays in jerks far behind live. The whole page freezes meanwhile (buttons and the timer stop
responding).

## Where

- **Page / screen / endpoint:** Player game page `/session/:shareToken` → live panel (hls.js)
- **Account / role:** player (no login)
- **Environment:** local, venue LAN · Brave (Chromium) on macOS, `http://192.168.0.104:4020`
- **Recorder box (edge only):** DGSI · agent 1.0.0 · Court 1, one camera (Tapo)

## Steps to reproduce

1. Start a game on a court whose box is online.
2. Open the game's page in a Chromium browser (Brave, Chrome, Edge) on the venue Wi-Fi.
3. Watch the live panel.

## Expected

The live video starts within a second or two and plays smoothly, about 6–10 s behind live.

## Actual

A spinner for ~20 s; then the video jumps to a point 30–60 s behind live and plays in jerks. The
page stops answering for 16–30 s at a time. Measured in headless Brave over the DevTools
protocol: a simple read of the page took 18–30 s to answer, and the main-thread profile showed
~50 s in hls.js `onLevelLoaded` and ~20 s in `_handleTransmuxComplete` over a 25 s run.

## Root cause

The box numbers the live playlist's discontinuities from the epoch second:
[edge/src/live.js](../../../edge/src/live.js) `LiveSequencer.number()` starts `dseq` at the first
segment's name (≈ 1 795 176 505), so every playlist says
`#EXT-X-DISCONTINUITY-SEQUENCE:1795176505`. hls.js gives each fragment that number as its `cc`
and keeps per-discontinuity state in plain arrays indexed by it (`this.initPTS[frag.cc] = …`,
then `this.initPTS.slice(…)` on every transmuxed fragment, and playlist alignment walks the same
arrays on every level load). An array with an index of 1.8 billion is 1.8 billion entries long, so
each of those operations takes seconds and blocks the page's main thread.

Confirmed: the same stream in the same headless browser with the playlist's
`DISCONTINUITY-SEQUENCE` rebased to 0 in a playlist loader answered in 1–3 ms, started playing in
0.2 s, ~9 s behind live, and hls.js used almost no CPU.

The court device (`app/`, expo-video → ExoPlayer / AVPlayer) doesn't use hls.js and isn't
affected; neither are the box's restreams (ffmpeg).

Separate, not this bug: the camera dropped out for 9–15 s a few times during the test (gaps in
the box's buffer), which shows as a short stall and a discontinuity in any player.

## Resolution

[LivePanel.jsx](../../../front/src/pages/Public/Session/components/LivePanel.jsx) gives hls.js a
playlist loader (`rebasedPlaylistLoader`) that rewrites `#EXT-X-DISCONTINUITY-SEQUENCE` to count
from 0 for that player, so hls.js's per-discontinuity arrays stay small. Same headless test after
the fix: playing in 0.2 s, 7–9 s buffered, ~9–10 s behind live, no stalls over 30 s with a
discontinuity in the window, the page answering in 0–2 ms. Web-only: no box update needed.

Possible follow-up (not needed for this fix): the box could number discontinuities from a small
base itself (`edge/src/live.js` `LiveSequencer`), for any other hls.js-based player.
