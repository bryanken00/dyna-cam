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

- [x] `npx expo install expo-secure-store` (**new dev build needed**); token stored there
- [x] Root navigator: paired → paired mode; signed in → full app; neither → "Pair this phone"
- [x] `Screens/Pair/`: 6-digit input → `POST /pair/app` → store token; errors: wrong/expired key,
      too many attempts
- [x] `Screens/Paired/Courts/` (venue's courts, big cards, camera status) → `Court/` (large
      **Record**, offline state) → `ShareQr/` (full-screen high-contrast QR of the share link +
      short link text, Saving… → Ready by polling)
- [x] Paired extras: court's **Recent clips** (tap → its QR again) and **Take payment** (pay code
      → record cash, this venue)
- [x] Unpair only on 401 `TOKEN_INVALID` from `/app/*`; network / 5xx keep the token and show
      "Can't reach Dyna Cam — retrying"
- [x] `npx expo-doctor@latest` + `npx expo export --platform android --clear`
- [ ] Tried on a phone on the venue Wi-Fi: pair with a key from the web → Courts → Court 1 →
      Record → QR photographed by another phone opens the clip
- [x] "Unpair this phone" revokes the phone on the server too (`POST /app/unpair`, best
      effort, then forgets the token); a failed clip's QR screen shows the reason
- [x] Changelog entry; commit Phase C

## Phase D — Whole-game recording from the staff app (Start / End)

### Backend

- [x] Migration `009_add_session_paired_app.sql`: `recording_sessions.pairedAppId` (who started it
      from a phone)
- [x] `utils/sessions.js`: shared `startSessionNow` (now → min(now + 3 h, the court's next
      booking); refuses when a booking starts within 5 min) and `endSessionNow` (the admin
      `/end` route uses it too)
- [x] `/api/v1/app`: `POST /courts/:courtId/recording` (start; already recording → 200 with the
      running one; camera/box offline → 503), `POST /courts/:courtId/recording/end`,
      `GET /sessions/:sessionId`, `GET /courts/:courtId/sessions`; `/courts` adds each court's
      running `recording`; recent clips leave out session parts
- [x] Admin sessions show "started by <phone> (phone)"
- [x] Tests (`tests/app-recording.test.js`, 6): start → running on `/courts` → end → parts and
      Ready; double start converges; no camera 503; a booking soon → 409, a later one shortens
      the game; another venue's court/game 404; End right after Start keeps a short game.
      An ended game now keeps at least 10 s (was 1 min) so the court frees up straight away

### App

- [x] Court screen: big **Start recording** / **End recording** with a running timer;
      "Save last 60 s" as a secondary button
- [x] Courts list shows "Recording · 12:34" on a court that's recording
- [x] End → full-screen QR of the game's link, Saving… → Ready (parts ready / total)
- [x] Recent on a court: games and 60-second clips, tap → QR again
- [x] Demo mode; `npx expo export --platform android --clear`

### Phase D wrap-up

- [x] Start reply carries `recording.already`; End keeps at least 1 s (not 10 s), so a Start
      right after End is a new game
- [x] `cd back && npm run lint && npm test` (163); front lint + build; app export; changelog
      entry; commit Phase D
- [ ] Tried on a phone with the real C200: Start → play a few minutes → End → QR opens the game

## Phase E — Session devices (pair to a session, live view, unpair at the end)

> Plan: [section 5](plan.md#5-session-devices-phase-e). Build waits for the requester's go-ahead
> on the document.

### E1 · Backend

- [ ] Migration `010_session_devices.sql`: `pairing_codes.sessionId`, `paired_apps.sessionId`,
      `devices.liveUrl`, `devices.liveKey` (encrypted); revoke venue-wide paired phones, cancel
      their keys; `paired_apps` permission → `Deleted`
- [ ] `POST /admin/sessions` `startNow`; session pairing keys (create / list / cancel, 10 min or
      the session's end); session detail lists devices + live keys; device unpair
- [ ] `POST /pair/app` takes only session keys and returns the session
- [ ] `requirePairedApp`: token valid while Scheduled/Recording and 10 min after the end; then,
      or when cancelled / unpaired, 401 `TOKEN_INVALID`
- [ ] `/app/session` (status, timers, share link, parts, `live.hlsUrl` signed for the box,
      `unpairInSeconds`), `POST /app/session/stop`; remove the Phase B–D `/app/*` routes
- [ ] Heartbeat accepts `live { url, key }`; key stored encrypted, never returned
- [ ] Remove `/admin/pairing-codes/apps`, `/admin/paired-apps/*`, `POST /admin/clips`,
      `DELETE /admin/clips/:clipId`
- [ ] Tests: pair → session → stop → 10-min grace → 401; cancelled session / unpaired device →
      401; another session's key can't be reused; ended session's key refused; live link
      signature checks; Clips write routes gone; Deleted-record 404s for the new by-ID routes

### E1 · Recorder box

- [ ] `edge/src/live.js`: HLS playlist of the last 5 closed segments + segment files, per court,
      HMAC-signed links with expiry, path-safe; `LIVE_PORT` (8090, 0 = off), `LIVE_HOST`
- [ ] `liveKey` created once in `DATA_DIR` (0600); heartbeat sends `live { url, key }`
- [ ] Tests (signature, expiry, playlist, path traversal) + smoke: play the playlist with ffprobe
- [ ] README: open port 8090 on the box; the device must be on the same Wi-Fi

### E2 · Web

- [ ] Book session: **Start now** (default) or date/time; after booking → Pair a device dialog
- [ ] Session ⋮ and detail: **Pair a device** (name → key + countdown), devices list with Unpair,
      live keys with Cancel
- [ ] Remove Dyna Cam → Paired Apps (page, route, menu, services)
- [ ] Clips view only: remove Save clip now and Delete
- [ ] `npm run lint && npm run build`

### E3 · App

- [ ] Remove the staff sign-in and staff-account screens, and `Screens/Paired/*`
- [ ] Pair this device → Session (live video, QR, timer, Stop) → Ended (QR, saving progress,
      Done, unpair countdown) → Pair
- [ ] `expo-video`; Android cleartext to the box; iOS Local Network usage text; landscape on
      tablets (**new dev build**)
- [ ] Demo mode; `npx expo-doctor@latest` + `npx expo export --platform android --clear`

### Phase E wrap-up

- [ ] Docs: root `CLAUDE.md` (`/api/v1/app/*` is now session devices), backend / mobile / edge
      skills, `edge/README.md`, `app/README.md`
- [ ] Migration `010` applied locally (ask first)
- [ ] Changelog entries (`impact: major` — app sign-in removed, phones re-paired); commit E1, E2,
      E3 separately
- [ ] Tried for real: book Court 1 "Start now" → pair a phone → live video from the C200 on the
      phone → Stop → QR → game downloads → phone unpairs after Done

## Wrap-up

- [x] Docs: root `CLAUDE.md` (the `/api/v1/app/*` route family), backend / mobile / edge skills,
      `edge/README.md`
- [x] Migration applied (`007`, `008`, `009` on the local DB), and noted in the changelog for deploy
- [ ] `plan.md` status set to `Done`
