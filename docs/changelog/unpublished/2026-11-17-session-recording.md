---
type: added
impact: minor
audience: user
ref: PLAN-001
---

Staff can book a court for a whole session (5 minutes to 3 hours) on the new Sessions page. The
player gets one link where every 5 minutes of their game appears as it is saved, ready to watch
or download. A session can be cancelled before it starts or ended early.

## Dev notes

- `back/`: run `npm run db:migrate` (migration `004_create_recording_sessions`). New endpoints:
  `/api/v1/admin/sessions` (clips permission), `GET /api/v1/public/sessions/:shareToken`.
- `edge/`: update every recorder box. A booked session keeps that court's footage on the box
  until 30 minutes after it ends — plan disk at about 0.9 GB per court-hour booked. New optional
  env: `DISK_WARN_GB` (2), `DISK_CRITICAL_MB` (500). Clips and parts now have bitrate caps.
