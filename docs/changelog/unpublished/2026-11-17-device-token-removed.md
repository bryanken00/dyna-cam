---
type: removed
impact: major
audience: user
ref: PLAN-002
---

Recorder boxes are now added **only with a 6-digit pairing key** (Setup → Recorder Boxes → Add
box). The long token you used to copy into the box's settings is gone, along with "Re-issue
token" — a revoked box is added again with a new key.

## Dev notes

- `back/`: removed `POST /api/v1/admin/devices` (create + token) and
  `POST /api/v1/admin/devices/:deviceId/token`. A box is created only by `POST /api/v1/pair/device`.
  Tests add boxes with the new `ctx.pairBox()` helper.
- `edge/`: `DEVICE_TOKEN` is no longer read. A box that still has it logs a warning; if it has no
  `DATA_DIR/device.json` yet, pair it once with `PAIRING_CODE`. Update every recorder box.
- `front/`: Recorder Boxes lost the token dialog and "Re-issue token".
