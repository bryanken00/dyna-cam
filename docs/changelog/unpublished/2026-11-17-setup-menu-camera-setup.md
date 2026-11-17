---
type: improved
impact: minor
audience: user
ref: PLAN-002
---

The Admin portal is reorganised: a **Setup** section for Venues and Recorder Boxes, and a
**Dyna Cam** section for Clips, Sessions and Payments. Open a venue to see its courts, and open a
court to set it up step by step — the camera (with the Tapo helper), its QR sign, its button and
its live stream. After you save a camera, the page shows whether the recorder box can see it,
the picture size, frame rate and sound, and a live preview picture so you can aim the camera.

## Dev notes

- `back/`: run `npm run db:migrate` (migration `007_add_camera_preview`). New
  `POST /api/v1/admin/courts/:courtId/preview` (venues/courts read), `POST
  /api/v1/device/courts/:courtId/snapshot`; court responses add `camera.live`, `camera.version`,
  `camera.snapshotUrl`. Live-status columns don't touch `dateUpdated` or the audit trail.
- `edge/`: update every recorder box (camera details in the heartbeat, preview snapshots from
  its own recording — never a second camera connection, `cameraVersion` echo).
- `front/`: old `/admin/dyna-cam/venues|courts|devices` links redirect to the Setup pages.
