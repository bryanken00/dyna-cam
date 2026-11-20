---
type: added
impact: minor
audience: user
ref: CR-025
---

While a game is recording, the player's game page now shows the court's live video, the same as
the court device: switch between Cam 1 and Cam 2, turn the sound on, go back 10 seconds and
return to live. Players can also save the last few minutes of their game from their own phone;
the save appears under "Your saves" and counts toward the game's save limit. The live video
plays on the venue Wi-Fi. Ending the game stays on the court device and in Admin.

## Dev notes

- back/: `GET /api/v1/public/sessions/:shareToken` adds `live` (the box's signed LAN HLS link,
  same as `/app/session`) and `capture`. New `POST /api/v1/public/sessions/:shareToken/captures`
  (`{ seconds }`), rate-limited per IP by `RATE_LIMIT_PUBLIC_CAPTURE_POINTS` (default 10/min).
  No migration.
- front/: new dependency `hls.js` — run `npm install`. It plays the live view on every browser
  with Media Source; the browser's own HLS is used only where Media Source is missing (older
  iPhones). Edge/Chrome on Windows claim built-in HLS but fail the box's stream (BUG-005).
  hls.js reads the box's playlist through a loader that rebases `#EXT-X-DISCONTINUITY-SEQUENCE`
  to count from 0 — the box's epoch-sized number froze the page for seconds at a time (BUG-006).
- edge/: no recorder box update. If the web app is served over HTTPS, browsers block the box's
  plain-HTTP live video: give the box its certificate (`CERT_PATH`, with `LIVE_HOST` a name the
  certificate covers) for the live view to play on the game page.
- app/: no change.
