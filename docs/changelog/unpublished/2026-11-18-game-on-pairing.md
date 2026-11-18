---
type: improved
impact: major
audience: user
ref: CR-005
---

Games are no longer booked with a start time and a length. In **Admin → Sessions**, staff click
**New game**, pick the court (and, if they like, the player's name and phone), then pair the
court's phone or tablet. **Recording starts the moment the device is paired** and runs until
someone presses **End game** on the device, or **End game** in Admin; nothing ends it by itself.
Players can't stop or pause it. Games waiting for a device can still be cancelled, and games
recording for 3 hours or more are highlighted so staff notice a forgotten one. One game per court
at a time.

## Dev notes

- `back/`: run `npm run db:migrate` (migration `017_open_games`: session status `Waiting`,
  `recording_sessions.openEnded`). `POST /admin/sessions` with just `courtId` (+ `playerName`,
  `phone`) creates an open game; the old body with `startNow`/`startAt` + `durationMinutes` still
  books a time window. The first `POST /pair/app` starts a waiting game. Open games report
  `endAt: null` and `openEnded: true` while they run (`/admin`, `/public`, `/app`).
- `app/`: **End game** replaces Stop recording; no end-time countdown for open games. JavaScript
  only: an over-the-air update, no new store build.
- `edge/`: no change (an open game's footage window keeps rolling ahead).
