---
type: added
impact: minor
audience: user
ref: CR-028
---

A game's page now has the courtside device's controls, so players who start their own game from
the court QR can run it from their phone: **End game** to stop early and get the whole game,
a delete button on each save to free one of its 5 slots, and **Stream to your Facebook /
YouTube** (with Change stream and Stop streaming). "Save the last …" now shows from the start of
the game, greyed out with a countdown until the first minute has been played. Anyone with the
game's link can use these controls.

## Dev notes

- back/: new `controllers/v1/public/game-controls.controller.js`, mounted at
  `/api/v1/public/sessions`: `POST /:shareToken/end`, `DELETE /:shareToken/captures/:number?savedAt=`
  (no IDs on public routes), `POST /:shareToken/stream-link`, `POST /:shareToken/stream/stop`.
  Rate-limited per IP by the optional `RATE_LIMIT_PUBLIC_CONTROL_POINTS` (default 20/min).
  `GET /public/sessions/:shareToken` now also returns `stream` and `canStream`.
- front/: game page (`pages/Public/Session/`) — End game, delete on Your saves, the stream block,
  and the greyed first-minute save picker.
- No migration, app build or recorder-box update.
