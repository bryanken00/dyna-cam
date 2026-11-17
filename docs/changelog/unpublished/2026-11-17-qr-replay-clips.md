---
type: added
impact: minor
audience: user
ref: PLAN-001
---

Players can save the last 60 seconds of their rally by scanning the QR code on their court, and
get a link to watch, download or share the clip — with the venue's logo on it. In the Admin
portal, staff set up venues, courts (including Tapo cameras), the recorder box at each venue,
print each court's QR sign, and browse, play and delete saved clips.

## Dev notes

- `back/`: run `npm run db:migrate` (migrations `001_create_venues_courts_devices`,
  `002_create_clips`). Set `DEVICE_SECRET_KEY` (32+ random characters) in `back/.env` — it
  encrypts camera addresses; `setup.sh` generates it for new installs. Optional:
  `CLIP_MAX_UPLOAD_MB`, `RATE_LIMIT_PUBLIC_CLIP_POINTS`, `RATE_LIMIT_DEVICE_UPLOAD_POINTS`.
  `APP_URL` must be the public web address — QR signs and share links point there.
- `back/`: `setup-database.js` now seeds each missing permission instead of skipping when the
  table is non-empty; re-run `npm run db:setup` (or rely on the migrations) to get the
  `venues/*` and `clips` permissions.
- `edge/` (new): install on an always-on machine at each venue (Node ≥ 20.12, ffmpeg, NTP), add
  the box in Admin → Recorder boxes, put `API_URL` + `DEVICE_TOKEN` in `edge/.env`, run with pm2.
  See `edge/README.md` (Tapo C200 setup included).
- `front/`: new dependency `qrcode.react` 4.2.0 (`npm install`).
