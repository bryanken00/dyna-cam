---
type: added
impact: minor
audience: user
ref: PLAN-002
---

A court can now have **two cameras**. In Setup → Venues → a court, use **Add a second camera**
and set it up like the first. On a two-camera court:

- **Replay clips and whole-game videos** show both cameras, Camera 1 above Camera 2.
- **The court's live stream** can show Cam 1, Cam 2 or **both stacked** — pick it in the court's
  Live stream settings.
- **A player's own Facebook / YouTube stream** offers the same choice on their phone, and they can
  switch cameras while live without entering their stream key again.

Changing a court's live stream no longer interrupts the court's recording.

## Dev notes

- `back/`: run `npm run db:migrate` (migration `013_second_camera`: `courts.camera2RtspUrl`
  (encrypted), `snapshot2Path`, `snapshot2At`, `streamLayout`; `recording_sessions.streamLayout`).
  Courts accept `camera2RtspUrl` / `removeCamera2` / `streamLayout`; responses add `camera2`.
  Device config adds `camera2RtspUrl`, `camera2Version`, `stream.layout`; heartbeat `camera`;
  snapshots `?camera=2`. The player's stream page takes a layout-only `PUT { layout }`.
- `edge/`: update every recorder box. One recorder per camera (`buffer/<court>~cam2/`); every
  stream is now a restream of the box's own live view (the recorder's tee output is gone), so
  **a venue court stream needs the live view on** (`LIVE_PORT`, default 8090) and runs ~10 s
  behind. Stacked streams and clips are encoded on the box (hardware encoder when available);
  `MAX_STACKED_STREAMS` (default 2). Stacked clips/parts are about twice the size — keep
  `CLIP_MAX_UPLOAD_MB` at 100 or more.
- `front/`: Court setup Camera 2 section and layout pickers.
