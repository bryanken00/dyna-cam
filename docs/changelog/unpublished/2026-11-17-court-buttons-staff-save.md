---
type: added
impact: minor
audience: user
ref: PLAN-001
---

Each court can have a Wi-Fi button: players press it to save the last 60 seconds, just like
scanning the court's QR code. Staff can also save a court's last 60 seconds from the Clips page
("Save clip now"), and the Clips list now shows how each clip was saved.

## Dev notes

- `back/`: run `npm run db:migrate` (migration `003_add_button_code_to_courts`). New endpoints:
  `POST /api/v1/device/buttons/:buttonCode/press`, `POST /api/v1/admin/clips`.
- `edge/`: update every recorder box. New optional env: `BUTTON_PORT` (default 8089),
  `BUTTON_HOST`, `BUTTON_KEY` (recommended). Configure each button to call
  `http://<box-ip>:8089/press/<code>?key=<BUTTON_KEY>` — see `edge/README.md`.
