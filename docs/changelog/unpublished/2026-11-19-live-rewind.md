---
type: added
impact: minor
audience: user
ref: CR-014
---

The courtside device's live view can now go back: tap ⟲ 10 s to see the last point again (tap
again to go further, up to about 50 seconds), and Live → to return to live. While behind, the
picture says how far ("20 s behind").

## Dev notes

- edge/: the live playlist lists `LIVE_DVR_SECONDS` (default 60) of the buffer instead of the
  newest 5 segments — update the recorder box at every venue. Old boxes keep working with ~10 s.
- app/: live view controls (JavaScript only, next app update). No API change.
