---
type: added
impact: minor
audience: user
ref: PLAN-002
---

Players can now **stream their game live to their own Facebook or YouTube**. On the court's
session device, tap **Stream to your Facebook / YouTube** and scan the QR with your phone; paste
your stream key from Facebook's Live Producer or YouTube Studio and tap **Start streaming**. The
game goes live a few seconds later and stops by itself when the session ends. You can stop or
change it from your phone, from the session device, or — for staff — from the session's details
in the Admin portal. The venue's own court stream keeps running alongside.

Your stream key is kept private: it is only ever shown masked and is deleted when the session
ends.

## Dev notes

- `back/`: run `npm run db:migrate` (migration `011_session_streams`: encrypted
  `recording_sessions.streamUrl`, platform, setup code hash/expiry). New
  `POST /api/v1/app/session/stream-link`, `POST /api/v1/app/session/stream/stop`,
  `GET|PUT|DELETE /api/v1/public/stream-setup/:code` (rate-limited by
  `RATE_LIMIT_STREAM_SETUP_POINTS`, default 30/min), `POST /api/v1/admin/sessions/:id/stream/stop`;
  `/device/config` sessions carry `stream.url` while recording; heartbeat `sessionStreams`.
- `edge/`: update every recorder box. Player streams are separate ffmpeg processes reading the
  box's own live view (needs `LIVE_PORT` on); video copied, audio resampled to 44.1 kHz; up to 4
  per box. Each uses about 1–2 Mbit/s of upload.
- `front/`: new public page `/stream/:code`.
- `app/`: no new native modules — works on the Phase E dev build.
