# BUG-005 · Player's game page shows no live video

> **Status:** Fixed · **Severity:** High · **Reported:** 2026-11-20 · **Reported by:** —
> **Fix checklist:** [fix.md](fix.md)

## Summary

While a game records, the player's game page (CR-025) shows "Live view needs the venue Wi-Fi"
instead of the court's live video, even on the venue Wi-Fi with the box online.

## Where

- **Page / screen / endpoint:** Player game page `/session/:shareToken` → live panel
- **Account / role:** player (no login)
- **Environment:** local, venue LAN · Microsoft Edge on Windows 10 (`http://192.168.0.100:4020`)

## Steps to reproduce

1. Start a game on a court whose box is online.
2. Open the game's page in Edge (or Chrome) on Windows.

## Expected

The live video plays under "Recording now".

## Actual

"Live view needs the venue Wi-Fi · Recording isn't affected".

## Root cause

The API returns a valid signed `live.hlsUrl`, and the box serves the playlist and segments
(200, CORS open, H.264 + AAC). The page picked its player with
`video.canPlayType("application/vnd.apple.mpegurl")` in
[LivePanel.jsx](../../../front/src/pages/Public/Session/components/LivePanel.jsx). Edge on Windows
answers `"maybe"`, so the page skipped hls.js and used Edge's built-in HLS player. That player
fails on the box's stream: `MEDIA_ERR_DECODE — CHUNK_DEMUXER_ERROR_APPEND_FAILED: Parsed buffers
not in DTS sequence` (reproduced in headless Edge). The error state shows the Wi-Fi panel. hls.js
plays the same link.

## Resolution

The page now uses hls.js wherever the browser has Media Source (`MediaSource` /
`ManagedMediaSource`), and falls back to the built-in player only where it doesn't (older
iPhones).
