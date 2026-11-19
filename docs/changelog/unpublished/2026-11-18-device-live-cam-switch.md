---
type: added
impact: minor
audience: user
ref: CR-007
---

On a court with two cameras, the session device now has a **Cam 1 | Cam 2** switch above its live
video, so players can watch either angle while they play. One camera plays at a time, starting on
Cam 1; if the chosen camera has no live video, the panel says so and the other is one tap away.
One-camera courts look the same as before. Recording isn't affected by switching.

## Dev notes

- `back/`: `GET /api/v1/app/session` `live` gains `cameras: [{ camera, hlsUrl }]` on two-camera
  courts (camera 2 at the box's `/live/<court>/cam2/`, same signature); `hlsUrl` stays camera 1.
- `app/`: JavaScript only — an over-the-air update, no new store build.
- `edge/`: no change; boxes already serve camera 2's live view.
