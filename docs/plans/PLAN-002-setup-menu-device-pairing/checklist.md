# PLAN-002 · Setup menu, camera setup, and 6-digit device pairing — Checklist

> Tick items as they land. Plan: [plan.md](plan.md). Three phases, each shippable and committed
> on its own: **A** web menu + camera setup, **B** pairing (staff app + recorder box),
> **C** staff app paired mode.

## Before starting

- [x] Open questions in plan.md answered (Record = last 60 s; phones also re-show QR + take cash;
      staff login kept) — 2026-11-17

## Phase A — Setup menu and guided camera setup

### Backend

- [x] Migration `007_add_camera_preview.sql`: `courts.previewWantedUntil`, `snapshotPath`,
      `snapshotAt` (Phase B is `008`)
- [x] Heartbeat camera entries accept `video {codec, width, height, fps}` and
      `audio {codec, sampleRate}` (`device-api.validator.js`); stored in `devices.lastStatus`
- [x] `POST /device/courts/:courtId/snapshot` (JPEG, own venue only, overwrites
      `uploads/admin/snapshots/{venueId}/{courtId}.jpg`); `/device/config` lists courts whose
      preview is wanted
- [x] Admin `POST /admin/courts/:courtId/preview` (venues/courts read) sets
      `previewWantedUntil = now + 2 min`; court GET adds `camera.live` (status, message, video,
      audio, snapshotUrl signed, snapshotAt, from the venue's box)
- [x] Tests (`tests/camera-preview.test.js`, 4): snapshot isolation (another venue's box → 404), preview window, camera details in
      the court response

### Edge

- [x] Heartbeat: probe the latest closed segment per court (ffprobe, cached per segment) →
      video/audio details; real fps when the camera's claim is off (C200 claims 30, sends 15)
- [x] Snapshot: for courts in `previewWanted`, one JPEG from the latest segment every 30 s →
      upload; no second camera connection; lowest priority (skipped while clips are busy)
- [x] `cameraVersion` echoed per camera (the version the running recorder uses), so the page
      knows a report is about the newly saved address
- [x] Tests (111) + smoke (camera details + preview case)

### Frontend

- [x] `AdminRoute.jsx`: **Setup** group (Venues, Recorder Boxes) and **Dyna Cam** group (Clips,
      Sessions, Payments, Paired Apps); redirects from the old `/admin/dyna-cam/venues|courts|devices`
- [x] `pages/Admin/Setup/Venues/` (list) → `VenueDetail/` (venue info + its Courts list with
      camera status and "Set up camera")
- [x] `pages/Admin/Setup/CourtSetup/` with sections Camera (guided: type → address → save → live
      check with preview, resolution / fps / codecs, fix hints), QR sign, Button, Live stream
- [x] Courts-only users (no Venues read) get a venue picker into the same court pages
- [x] `npm run lint && npm run build`

### Phase A wrap-up

- [ ] Tried on the real Tapo C200: set up Court 1's camera from the web → live check shows
      1280×720 · 15 fps · H.264 · AAC and a preview picture
- [x] Changelog entry (`ref: PLAN-002`); commit Phase A
- [x] API follow-ups: `camera.version` / `live.cameraVersion`, server-side ages
      (`reportedSecondsAgo`, `snapshotSecondsAgo`), preview requests leave `dateUpdated` and the
      audit trail alone (rule added to `schema-conventions.md`)

## Phase B — 6-digit pairing (staff phones + recorder boxes)

### Backend

- [x] Migration `008_add_device_pairing.sql`: `pairing_codes`, `paired_apps`, `clips.pairedAppId`,
      `payments.pairedAppId`; permission `paired_apps` (+ seed, granted to Owner)
- [x] `utils/pairing.js`: 6-digit CSPRNG code, keyed HMAC-SHA256 (not plain SHA-256 — a DB dump
      can't be brute-forced without the server secret), 10-min expiry, single use, no two Active
      codes alike
- [x] Admin `/admin/pairing-codes/apps` (`paired_apps`) and `/admin/pairing-codes/recorders`
      (`venues/devices`): list live keys (no digits), create (digits shown once, never cached),
      cancel
- [x] Public `POST /api/v1/pair/app` and `POST /api/v1/pair/device` (own `/pair` mount — the
      `/device` and `/app` mounts require a token) with per-IP (5/min, 20/h) and a global
      failed-attempt pause (100 / 10 min); failed attempts logged
- [x] `middlewares/pairedAppAuth.middleware.js` (`Authorization: App <token>`, venue-scoped,
      lastSeenAt) + `/api/v1/app/{me,courts,courts/:id/clips,clips/:id}`
- [x] Admin `/admin/paired-apps` (list, options, get, rename, revoke, delete) behind `paired_apps`
- [x] `/api/v1/app/courts/:courtId/clips` (recent, for re-showing a QR) and
      `/api/v1/app/payments/{lookup,}` (cash for this venue only) via the shared
      `utils/payments.js`; Payments shows "<phone> (phone)" as received by
- [x] Tests (`tests/pairing.test.js` 15, `tests/pairing-limits.test.js` 2): code expires / single
      use / cancelled / wrong kind / typed with a space; per-IP and global limits; app isolation (another
      venue's court 404); revoked app 401; RECORDER pairing creates a working device; token never
      in the idempotency cache

### Edge

- [x] `PAIRING_CODE` in `.env` → `/device/pair` on first start → token saved to
      `DATA_DIR/device.json` (0600); `DEVICE_TOKEN` still accepted; 401 → stop and log
      "re-pair needed"
- [x] README: install with a pairing key; tests (125); used keys remembered so a
      stale `PAIRING_CODE` is never retried; revoke removes `device.json` and the cached config

### Frontend

- [x] Recorder Boxes "Add box" shows a 6-digit key + countdown and the `.env` lines
      (`API_URL`, `PAIRING_CODE`)
- [x] `pages/Admin/DynaCam/PairedApps/`: list (venue, name, platform, last seen, status), "Pair a
      phone" (venue + name → 6-digit key + countdown), rename, revoke, delete
- [x] Clips shows "Staff · <phone name>" for paired-app saves
- [x] `npm run lint && npm run build`

### Phase B wrap-up

- [x] `cd back && npm run lint && npm test` passes
- [ ] Recorder box paired with a 6-digit key on this Mac against the local API (no
      `DEVICE_TOKEN`), recording the real C200
- [x] Real pairing run (throwaway DB, the real `edge/` process, no camera): recorder key →
      box paired from `PAIRING_CODE` alone → `device.json` 0600, box online, key used up; phone
      paired → `/app/courts`; box revoked → it stopped within 18 s and removed its credentials;
      no token in the log — 2026-11-17
- [x] Changelog entry; commit Phase B

## Phase C — Staff app paired mode

- [ ] `npx expo install expo-secure-store` (**new dev build needed**); token stored there
- [ ] Root navigator: paired → paired mode; signed in → full app; neither → "Pair this phone"
- [ ] `Screens/Pair/`: 6-digit input → `POST /app/pair` → store token; errors: wrong/expired key,
      too many attempts
- [ ] `Screens/Paired/Courts/` (venue's courts, big cards, camera status) → `Court/` (large
      **Record**, offline state) → `ShareQr/` (full-screen high-contrast QR of the share link +
      short link text, Saving… → Ready by polling)
- [ ] Paired extras: court's **Recent clips** (tap → its QR again) and **Take payment** (pay code
      → record cash, this venue)
- [ ] Unpair only on 401 `TOKEN_INVALID` from `/app/*`; network / 5xx keep the token and show
      "Can't reach Dyna Cam — retrying"
- [ ] `npx expo-doctor@latest` + `npx expo export --platform android --clear`
- [ ] Tried on a phone on the venue Wi-Fi: pair with a key from the web → Courts → Court 1 →
      Record → QR photographed by another phone opens the clip
- [ ] Changelog entry; commit Phase C

## Wrap-up

- [ ] Docs: root `CLAUDE.md` (the `/api/v1/app/*` route family), backend / mobile / edge skills,
      `edge/README.md`
- [ ] Migration applied, or noted as pending for deploy
- [ ] `plan.md` status set to `Done`
