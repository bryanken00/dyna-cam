---
type: added
impact: minor
audience: user
ref: PLAN-001
---

Courts can be streamed live to YouTube or Facebook. Turn streaming on for a court and paste the
stream address from YouTube Studio or Facebook Live Producer; the court's QR page then shows a
"Watch live" button. The Recorder boxes page shows whether each stream is live. Recording and
replays keep working even if the stream drops.

## Dev notes

- `back/`: run `npm run db:migrate` (migration `006_add_streaming_to_courts`).
- `edge/`: update every recorder box. The stream goes out from the box over its existing camera
  connection (a Tapo C200 allows only one), using about the camera's bitrate (~1–2 Mbps) of
  upload per streamed court.
