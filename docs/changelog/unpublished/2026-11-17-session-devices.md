---
type: changed
impact: major
audience: user
ref: PLAN-002
---

Dyna Cam is now **session based**. At the counter, book a session (it can **start now**) and
**pair a device** to it with the 6-digit key that appears. The phone or tablet at the court then
shows the game **live** from the venue's recorder box, with a QR code the players scan to get
their game, a timer and a **Stop recording** button. When the game ends the QR fills the screen
until the video is ready to download; after 10 minutes, or when someone taps Done, the device
unpairs itself and is ready for the next session.

What changed for staff:

- **The app is only a session device now.** Staff sign-in, the courts list, Record, recent clips
  and Take payment are gone from the app; phones paired to a whole venue are unpaired and must be
  paired to a session.
- **Payments are taken at the counter only**, on the web Payments page.
- **Dyna Cam → Paired Apps is gone** — devices are paired and unpaired on each session.
- **Clips is view only** — no Save clip now and no Delete.

## Dev notes

- `back/`: run `npm run db:migrate` (migration `010_session_devices`: `pairing_codes.sessionId`,
  `paired_apps.sessionId`, `devices.liveUrl` / `liveKey` (encrypted); revokes venue-wide paired
  phones; `paired_apps` permission set Inactive). `/api/v1/app/*` is now `GET /session`,
  `POST /session/stop`, `POST /unpair`; new `POST /admin/sessions` `startNow`,
  `/admin/sessions/:id/pairing-codes`, `/admin/sessions/:id/devices/:id/unpair`. Removed:
  `/admin/paired-apps/*`, `/admin/pairing-codes/apps*`, `POST /admin/clips`,
  `DELETE /admin/clips/:id`, and the Phase B–D `/app/*` routes.
- `edge/`: update every recorder box. New LAN live view on `LIVE_PORT` (default 8090; open it on
  the box's firewall; `LIVE_PORT=0` turns it off, `LIVE_HOST` overrides the detected address).
  An old box keeps recording; devices show "Live view unavailable".
- `app/`: **new dev/store build required** — adds `expo-video` and `expo-build-properties`
  (Android plain-HTTP to the box), iOS Local Network permission text, landscape on tablets.
  The device must be on the same Wi-Fi as the recorder box for the live view.
