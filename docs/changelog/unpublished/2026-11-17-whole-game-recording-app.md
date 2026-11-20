---
type: added
impact: minor
audience: user
ref: PLAN-002
---

A paired staff phone can now record a **whole game**, not just the last 60 seconds. Open a court
and tap **Start recording**; a timer runs on the court until you tap **End recording**, and then a
QR code for the whole game appears for the players to photograph. The link works at once, and the
video fills in over the next few minutes. A forgotten recording stops by itself after 3 hours, or
before the court's next booking. Games started from a phone show on the Sessions page as
"Started by <phone> (phone)".

## Dev notes

- `back/`: run `npm run db:migrate` (migration `009_add_session_paired_app`:
  `recording_sessions.pairedAppId`). New `POST /api/v1/app/courts/:courtId/recording` and
  `/recording/end`, `GET /api/v1/app/courts/:courtId/sessions`, `GET /api/v1/app/sessions/:id`;
  `/app/courts` adds each court's running `recording`; `/app/courts/:id/clips` leaves out session
  parts. Ending a session (phone or Admin) now keeps at least 1 second instead of 1 minute.
- `app/`: no new native modules — an over-the-air bundle is enough once the Phase C dev build is
  installed.
- `edge/`: no change.
