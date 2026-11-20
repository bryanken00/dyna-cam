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

- [x] Tried on the real Tapo C200: set up Court 1's camera from the web → live check shows
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
- [x] Recorder box paired with a 6-digit key on this Mac against the local API (no
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
- [x] *(Superseded by Phase E — tried with the Phase E flow instead)* Tried on a phone on the venue Wi-Fi: pair with a key from the web → Courts → Court 1 →
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
- [x] *(Superseded by Phase E — tried with the Phase E flow instead)* Tried on a phone with the real C200: Start → play a few minutes → End → QR opens the game

## Phase E — Session devices (pair to a session, live view, unpair at the end)

> Plan: [section 5](plan.md#5-session-devices-phase-e). Build waits for the requester's go-ahead
> on the document.

### E1 · Backend

- [x] Migration `010_session_devices.sql`: `pairing_codes.sessionId`, `paired_apps.sessionId`,
      `devices.liveUrl`, `devices.liveKey` (encrypted); revoke venue-wide paired phones, cancel
      their keys; `paired_apps` permission → `Inactive` (permissions have no Deleted status)
- [x] `POST /admin/sessions` `startNow`; session pairing keys (create / list / cancel, 10 min or
      the session's end); session detail lists devices + live keys; device unpair
- [x] `POST /pair/app` takes only session keys and returns the session
- [x] `requirePairedApp`: token valid while Scheduled/Recording and 10 min after the end; then,
      or when cancelled / unpaired, 401 `TOKEN_INVALID`
- [x] `/app/session` (status, timers, share link, parts, `live.hlsUrl` signed for the box,
      `unpairInSeconds`), `POST /app/session/stop`; remove the Phase B–D `/app/*` routes
- [x] Heartbeat accepts `live { url, key }`; key stored encrypted, never returned; the live
      link comes from the box whose last heartbeat listed the court
- [x] Remove `/admin/pairing-codes/apps`, `/admin/paired-apps/*`, `POST /admin/clips`,
      `DELETE /admin/clips/:clipId`
- [x] Tests (`session-devices.test.js` 13, `pairing.test.js` 7, clips/buttons/payments
      updated; 161 in all): pair → session → stop → 10-min grace → 401; cancelled session /
      unpaired device → 401; ended session's key refused; a key never outlives its session; live
      link signature; key never returned; Clips write routes and Paired Apps gone; 404s

### E1 · Recorder box

- [x] `edge/src/live.js`: HLS playlist of the last 5 closed segments + segment files, per court,
      HMAC-signed links with expiry, path-safe; `LIVE_PORT` (8090, 0 = off), `LIVE_HOST`
- [x] `liveKey` created once in `DATA_DIR` (0600); heartbeat sends `live { url, key }`
- [x] Tests (29 new, 154 in all: signature, expiry, playlist, 16 path-traversal cases,
      sequence across prune/restart, discontinuities) + smoke: ffprobe plays the playlist.
      Segments' timestamps are shifted to their real start as they're served (each buffer
      segment restarts at ~1.4 s), so players see one continuous stream
- [x] README: open port 8090 on the box; the device must be on the same Wi-Fi

### E2 · Web

- [x] Book session: **Start now** (default) or date/time; after booking → Pair a device dialog
- [x] Session ⋮ and detail: **Pair a device** (name → key + countdown), devices list with Unpair,
      live keys with Cancel
- [x] Remove Dyna Cam → Paired Apps (page, route, menu, services)
- [x] Clips view only: remove Save clip now and Delete
- [x] `npm run lint && npm run build`

### E3 · App

- [x] Remove the staff sign-in and staff-account screens, and `Screens/Paired/*`
- [x] Pair this device → Session (live video, QR, timer, Stop) → Ended (QR, saving progress,
      Done, unpair countdown) → Pair
- [x] `expo-video`; Android cleartext to the box; iOS Local Network usage text; landscape on
      tablets (**new dev build**)
- [x] Demo mode; `npx expo-doctor@latest` (only the existing "11 packages out of date") +
      `npx expo export --platform android --clear`

### Phase E wrap-up

- [x] Docs: root `CLAUDE.md` (`/api/v1/app/*` is now session devices), backend / mobile / edge
      skills, `edge/README.md`, `app/README.md`
- [x] Migration `010` applied locally (approved 2026-11-17)
- [x] Changelog entries (`impact: major` — app sign-in removed, phones re-paired); commit E1, E2,
      E3 separately
- [x] Tried for real: book Court 1 "Start now" → pair a phone → live video from the C200 on the
      phone → Stop → QR → game downloads → phone unpairs after Done

## Phase F — `DEVICE_TOKEN` removed (boxes pair with a key only)

- [x] API: remove `POST /admin/devices` (create + token) and `POST /admin/devices/:id/token`;
      tests pair their boxes with a key (`pairBox` helper)
- [x] Web: Recorder Boxes without the token dialog / "New token"; Add box = pairing key
- [x] Edge: drop `DEVICE_TOKEN` (config, credentials, `.env.example`, README, skill, tests); a
      set `DEVICE_TOKEN` only logs that it's ignored
- [x] `back` lint + test (161), `front` lint + build, `edge` lint + test (154); changelog;
      commit. Tests pair boxes with a key; a freshly paired box counts as online

## Phase G — Player's own live stream (Facebook / YouTube)

> Plan: [section 6](plan.md#6-players-own-live-stream-phase-g). Build waits for the
> requester's go-ahead.

### G1 · Backend

- [x] Migration `011_session_streams.sql`: `recording_sessions.streamUrl` (encrypted),
      `streamPlatform`, `streamUpdatedAt`, `streamSetupTokenHash`, `streamSetupExpiresAt`
- [x] Device: `POST /app/session/stream-link`, `POST /app/session/stream/stop`; `/app/session`
      adds `stream`
- [x] Public `/public/stream-setup/:code` GET / PUT / DELETE (rate-limited; Facebook / YouTube
      key or a full RTMP(S) address; only while the session is to come or recording)
- [x] `/device/config` sessions carry `stream.url` while recording; heartbeat
      `sessionStreams[]` status; the key is cleared when the session ends
- [x] Admin session detail: stream platform / status / masked address, **Stop stream**
- [x] Tests (`session-streams.test.js` 11; 173 in all): code expiry and replacement; key never
      returned (masked) and stored encrypted; refused after the end; cleared at the end and on
      cancel; box gets it only while recording; status round trip; bad keys/addresses 400; 404s

### G1 · Recorder box

- [x] Session restream process (`edge/src/restream.js`): ffmpeg reads the court's signed live
      HLS on 127.0.0.1 → video copied, audio resampled to 44.1 kHz (the camera's 8 kHz) → FLV to
      the player's address; starts/stops with the session; backoff 5 s → 60 s; max 4; status in
      the heartbeat; key masked everywhere and never in the cached config
- [x] Tests (186) + smoke: restreamed to a local RTMP listener → live in ~6 s; listener killed →
      error, recording unaffected; new listener → live again; README

### G2 · Web

- [x] Public `/stream/:code` page for the player's phone: platform, key, help, Start / Stop,
      live status
- [x] Session detail: stream line + Stop stream
- [x] `npm run lint && npm run build`

### G3 · App

- [x] Session screen: **Stream to your Facebook / YouTube** → sheet with the setup QR; streaming
      chip with status and **Stop streaming**
- [x] Demo mode; `npx expo export --platform android --clear`

### Phase G wrap-up

- [x] Migration `011` applied locally (approved 2026-11-17); changelog; commit G1, G2, G3
- [x] Tried for real: session on Court 1 → player scans the stream QR → pastes a Facebook key →
      the session appears live on Facebook → Stop

## Phase H — Two cameras on one court (Cam 1 / Cam 2 / Both stacked)

> Plan: [section 7](plan.md#7-two-cameras-on-one-court-phase-h). Build waits for the
> requester's go-ahead.

### H1 · Backend

- [x] Migration `013_second_camera.sql`: `courts.camera2RtspUrl` (encrypted), `snapshot2Path`,
      `snapshot2At`, `streamLayout`; `recording_sessions.streamLayout`
- [x] Courts API: `camera2RtspUrl`, `streamLayout`; `camera2` in the court response (masked,
      version, live check, preview); preview asks for both; snapshot upload for camera 2
- [x] `/device/config`: `camera2RtspUrl`, `camera2Version`, `stream.layout` (court + session);
      heartbeat `camera: 1 | 2`
- [x] Player stream: `setup.cameras`, `PUT … layout`, `stream.layout`
- [x] Tests (`second-camera.test.js` 8; 181 in all): camera 2 saved encrypted / masked / kept /
      removed; layouts validated (CAM2/STACKED need camera 2, camera 2 needs camera 1); config
      carries them; per-camera live check and preview; layout-only switch keeps the key; no
      layout on a 1-camera court; audit trail keeps no camera-2 password (BUG-001 helper)

### H1 · Recorder box

- [x] A recorder + buffer per camera; camera details, preview and status per camera
- [x] Live view for camera 2 (`/live/<courtId>/cam2/…`)
- [x] Streams as restreams: copy for one camera; stacked = two inputs → scale → `vstack` →
      H.264 (hardware encoder when available, keyframe every 2 s) → FLV; `MAX_STACKED_STREAMS`
- [x] The venue's court stream moves from the recorder tee to a restream (no recorder restart on
      stream changes)
- [x] Clips and session parts stacked on 2-camera courts; one camera only when the other has no
      footage for the window
- [x] Tests (204) + smoke: two generated cameras → stacked 65 s clip and 60 s session part
      1280×1440 with AAC (VideoToolbox); venue STACKED → CAM2 and a player CAM1 restream live on
      local listeners; recorder pids unchanged across the layout change; README. One camera with
      no video → a stacked stream falls back to the other until both are up

### H2 · Web

- [x] Court setup: Camera 2 (optional) section; Live stream layout choice
- [x] Player's stream page: layout choice (2-camera courts), shown on the status card
- [x] `npm run lint && npm run build`

### Phase H wrap-up

- [x] Migration `013` applied locally (approved 2026-11-17); changelog; commit H1, H2
- [x] Tried for real with two cameras (or the C200 twice via its two streams for a test):
      stacked stream on Facebook, Cam 2 only, a stacked 60-second clip

## Phase I — Recorder boxes set up from `.env` only (no UI)

> Plan: [section 8](plan.md#8-recorder-boxes-set-up-from-env-only-phase-i). Build waits for the
> requester's go-ahead.

### I1 · Backend

- [x] `RECORDER_ENROLL_KEY` (≥ 32 chars, else enrolment off) in `.env.example`; `POST
      /api/v1/pair/enroll` (constant-time key check, pairing limits, venue must exist)
- [x] Remove `/admin/devices/*`, `/admin/pairing-codes/recorders*`, `/pair/device`; migration
      `014`: `venues/devices` permission Inactive
- [x] `scripts/boxes.js`: `npm run boxes` (venue, name, status, last seen, agent, id) and
      `npm run boxes:revoke -- <name or id>`
- [x] Tests (182 in all; `enrolment-off.test.js`, enrolment in `pairing.test.js`, the CLI in
      `venues-courts-devices.test.js`): enrol ok / wrong key / unknown or deleted venue /
      enrolment off; token works and stays hashed; `boxes` lists, `boxes:revoke` by name or id →
      401; removed routes 404; `ctx.pairBox` enrols. Court responses now carry the venue stream's
      status (`camera.live.streamStatus`), shown on the court's Live stream section

### I1 · Recorder box

- [x] `ENROLL_KEY`, `VENUE_ID`, `BOX_NAME` (default hostname); `PAIRING_CODE` removed (a leftover
      one is only warned about); credentials: `device.json` → enrol
- [x] Revoked → delete `device.json`, write `revoked.json`, stop; no automatic re-enrol until a
      person deletes it
- [x] Tests (205); README (install with `.env`, rotating the key, revoked boxes); skill

### I2 · Web

- [x] Remove Setup → Recorder Boxes (page, route, menu, services, box pairing dialog)
- [x] Venue page: venue ID with **Copy**; court setup hint points to the box's `.env` setup
- [x] `npm run lint && npm run build`

### Phase I wrap-up

- [x] Migration `014` applied locally (approved 2026-11-17); `RECORDER_ENROLL_KEY` generated into
      `back/.env`, `ENROLL_KEY` + `VENUE_ID` into `edge/.env` (approved); docs (root `CLAUDE.md`,
      `back/CLAUDE.md`, skills); changelog; commit I1, I2
- [x] Your running box keeps working (it has `device.json`); a fresh box enrols from `.env`

## Wrap-up

- [x] Docs: root `CLAUDE.md` (the `/api/v1/app/*` route family), backend / mobile / edge skills,
      `edge/README.md`
- [x] Migration applied (`007`, `008`, `009` on the local DB), and noted in the changelog for deploy
- [x] `plan.md` status set to `Done`
