---
type: removed
impact: major
audience: user
ref: PLAN-002
---

**Setup → Recorder Boxes is gone.** Recorder boxes are installed by the Dyna Cam team and set up
from their settings file — there is nothing to do in the Admin portal. Each venue's page shows
its **Venue ID** with a Copy button for that setup, and each court's camera setup still shows
whether the venue's box is online. The court's **Live stream** settings now show whether the
stream is live.

## Dev notes

- `back/`: set `RECORDER_ENROLL_KEY` (32+ chars, e.g. `openssl rand -hex 32`) in `.env`, and run
  `npm run db:migrate` (migration `014_recorder_boxes_env_only`: `venues/devices` permission
  Inactive, unused box pairing keys cancelled). New `POST /api/v1/pair/enroll`; removed
  `/api/v1/admin/devices/*`, `/api/v1/admin/pairing-codes/recorders*`, `POST /api/v1/pair/device`.
  List / revoke boxes with `npm run boxes` / `npm run boxes:revoke -- <name or id>`. After a box
  is stolen, revoke it **and** change `RECORDER_ENROLL_KEY`.
- `edge/`: update every recorder box. New boxes need `ENROLL_KEY` + `VENUE_ID` (and optionally
  `BOX_NAME`) in `.env`; `PAIRING_CODE` is gone. Boxes that already have `data/device.json` keep
  working. A revoked box stops and stays stopped until `data/revoked.json` is deleted.
- `front/`: Recorder Boxes page removed (old links go to Setup → Venues).
