# PLAN-001 · Court replay cameras ("Pickle Cam"-style) — Checklist

> Tick items as they land. Plan: [plan.md](plan.md). Phases ship independently; finish one
> phase's wrap-up before starting the next.

## Phase 0: Repo consolidation + cleanup

### Docs, skills, CLAUDE.md → root

- [x] Diff each `app/.claude/skills/{plan-doc,change-request,bug-report,changelog}/SKILL.md`
      against the root copy, fold any useful additions (e.g. `argument-hint`) into the root
      version, then delete the `app/` copy
- [x] Widen the root workflow skills' "when to run" wording to cover `front/`, `back/`, `app/`
      and `edge/`
- [x] Extend root `publish` to also bump `app/package.json`, `app/app.json` `expo.version` and
      `app/src/constants/version.js`; delete `app/.claude/skills/publish`
- [x] `git mv app/.claude/skills/frontend-conventions .claude/skills/mobile-conventions`; rename
      its `name:` and rewrite its description so it triggers on `app/src` / `app/App.js`
- [x] `git mv` `app/docs/{DESIGN_GUIDELINES,MODULE_PATTERN,ENGINEERING_CHECKLIST}.md` into
      `.claude/skills/mobile-conventions/references/` (kebab-case names) and add them to the
      skill's routing table
- [x] Move `app/CLAUDE.md`'s Architecture / Theming / Typography / Traps / Commands content into
      `mobile-conventions` references; replace `app/CLAUDE.md` with a short pointer modelled on
      [`front/CLAUDE.md`](../../../front/CLAUDE.md)
- [x] `git mv app/.claude/skills/new-module .claude/skills/new-mobile-module`; rename `name:`;
      point the root `new-module` skill at it for the mobile half
- [x] Delete `app/.claude/settings.json` (identical to root) and the now-empty `app/.claude/`
- [x] Delete `app/docs/` (empty `plans/`, `change-requests/`, `bug-reports/`, `changelog/`
      scaffolding + its README) after the moves above
- [x] Trim `app/README.md` to run / build / env instructions for the app
- [x] Root `CLAUDE.md`: fix the tenancy paragraph (no SuperAdmin/company/branch in code — already
      fixed on disk before Phase 0 started), add
      `app/` (and later `edge/`) to the layout + skills tables, add the app's verification loop
      (`npx expo-doctor@latest`, `npx expo export --platform android --clear`)
- [x] Root `README.md`: Dyna Cam overview + quick start for `back/`, `front/`, `app/`
- [x] Grep the repo for dead links to `app/docs/…`, `docs/DESIGN_GUIDELINES.md`,
      `docs/MODULE_PATTERN.md`, `docs/ENGINEERING_CHECKLIST.md` and fix them

### Template cleanup

- [x] `app/app.json`: name, slug, `android.package`, `ios.bundleIdentifier` → Dyna Cam values;
      `app/package.json` `name` → `dyna-cam-app`
- [x] `app/.env.example`: `EXPO_PUBLIC_API_URL=http://localhost:4021`, LAN-IP hint updated
- [x] `app/eas.json`: `production` profile sets `EXPO_PUBLIC_DEMO_MODE=false` explicitly
- [x] `back/package.json` → `dyna-cam-api`, `front/package.json` → `dyna-cam-web` (names and
      descriptions only — **no** version bump by hand)
- [x] Delete root `.DS_Store`; add `.DS_Store` to [`.gitignore`](../../../.gitignore) (it was
      already ignored and untracked)
- [x] `run.sh` / `run-mac.sh`: opt-in `app` target (`npm run dev` → `expo start`, port 8081),
      not part of the no-argument default
- [x] Landing page decision applied: `/` is now a Dyna Cam page; the template's component
      gallery moved to `/components` (`pages/ComponentGallery/`)
- [x] App identity decided: "Dyna Cam", `com.dgsi.dynacam`; app version aligned to 1.0.0 so
      `/publish` bumps one product version

### Connect `app/` to this API

- [x] `app/src/services/api/auth.js` + `requests/auth.js`: unwrap the
      `{ success, message, data }` envelope (two `.data` hops), store access + refresh tokens
- [x] `app/src/services/api/axios.js`: refresh-token rotation on 401 via `/admin/auth/refresh`
- [x] Handle 403 `PASSWORD_CHANGE_REQUIRED`: route the user to a change-password screen
      (`Screens/Account/ChangePassword/`, also reachable from Menu → Account)
- [x] CSRF double-submit + `Idempotency-Key` on mutations; fixed the old interceptor's missing
      `Toast` import and non-existent `reset()` call
- [x] Request sequence replayed against the API test harness with CSRF on (csrf-token → login →
      403 `PASSWORD_CHANGE_REQUIRED` → change password → refresh → logout): every step matched
- [x] Sign in on a device against the local API (`http://<LAN-IP>:4021`) and log out cleanly
      *(closed 2026-11-19 by owner decision, not run; superseded by PLAN-002: the app no longer has a staff sign-in, it pairs to a session)*

### Phase 0 wrap-up

- [x] `cd back && npm run lint && npm test` passes
- [x] `cd front && npm run lint && npm run build` passes
- [x] `cd app && npx expo export --platform android --clear` bundles (3642 modules)
- [x] `cd app && npx expo-doctor@latest` passes — **fails 1 check: 11 Expo packages behind SDK 58's
      pinned versions** (pre-existing; fix with `npx expo install --check`, then a new dev build)
      *(closed 2026-11-19 by owner decision, not run; the package update is left for whenever the next dev build is made)*
- [x] Changelog entry (`ref: PLAN-001`): `docs/changelog/unpublished/2026-11-17-dyna-cam-foundation.md`

## Phase 1: Foundation + QR clips + watermark

### Backend

- [x] Migration `001_create_venues_courts_devices.sql`: `venues`, `courts`, `devices` tables +
      permission rows `venues/list`, `venues/courts`, `venues/devices` (idempotent
      `WHERE NOT EXISTS`) granted to Owner
- [x] Migration `002_create_clips.sql`: `clips` table + `clips` permission row
- [x] Add the same permissions to the seed array in
      [`setup-database.js`](../../../back/scripts/setup-database.js) — and fix its seeding to
      insert each *missing* permission (it used to skip seeding whenever the table was
      non-empty, so a migration's permission row blocked the base set on fresh installs)
- [x] `utils/crypto/secretBox.js`: AES-256-GCM for camera URLs with `DEVICE_SECRET_KEY`; added
      `DEVICE_SECRET_KEY`, `CLIP_MAX_UPLOAD_MB`, `RATE_LIMIT_PUBLIC_CLIP_POINTS`,
      `RATE_LIMIT_DEVICE_UPLOAD_POINTS` to `back/.env.example` and `DEVICE_SECRET_KEY` to
      `setup.sh` (public links reuse the existing `APP_URL`, no `PUBLIC_APP_URL` needed)
- [x] Validators: `venues`, `courts`, `devices`, `clips`, `device-api`, `public`
      (`_helpers.js` wrappers, `optionalPhone()` on venue phone, `optionalUploadPath()` on
      `logoUrl`, RTSP-only camera URLs)
- [x] `venues.controller.js`: CRUD behind `venues/list`; `logoUrl` signed; delete also retires
      the venue's courts and revokes its boxes
- [x] `courts.controller.js`: CRUD + `POST /:courtId/rotate-qr` behind `venues/courts`; camera
      URL write-only (responses show `camera.configured` + a credential-free `display`)
- [x] `devices.controller.js`: CRUD + revoke + re-issue token behind `venues/devices`; token
      shown once, SHA-256 stored; `online` from `lastSeenAt` (90 s)
- [x] `clips.controller.js` (admin): list with filters, get-one with signed video/thumbnail
      links, soft delete (removes the files), behind `clips`
- [x] Mount the four groups in [`routes/v1/admin/index.js`](../../../back/server/src/routes/v1/admin/index.js)
      with `requireAuth` + `auditTrail(...)`
- [x] `middlewares/deviceAuth.middleware.js`: `Authorization: Device <token>` → `req.device`
      (`deviceId`, `venueId`); updates `lastSeenAt`; 401 on revoked/deleted
- [x] `controllers/v1/device/device.controller.js`: `heartbeat`, `config`, `jobs` (long-poll,
      `?wait=0..30`), `clips/:clipId/{processing,upload,fail}`; mounted at `/v1/device` in
      [`route.js`](../../../back/server/src/routes/route.js)
- [x] Clip upload: multer to `uploads/admin/clips/{venueId}/{clipId}/` via `uploadFolderId()`,
      a per-box limiter (not the per-IP `uploadLimiter`, which a busy venue would hit), size
      cap `CLIP_MAX_UPLOAD_MB`, mp4 + jpeg only (content-checked)
- [x] `controllers/v1/public/public.controller.js`: `GET /courts/:qrToken`,
      `POST /courts/:qrToken/clips` (20 s per-court merge, per-IP limit, 503 `CAMERA_OFFLINE`
      when the box is offline), `GET /clips/:shareToken`; mounted at `/v1/public`
- [x] Confirm the signed-upload static handler serves HTTP `Range` — it does (tested: 206)
- [x] `jobs/clipMaintenance.js`: at startup + hourly — expire clips past `expiresAt` (files
      deleted), fail clips still Pending/Processing after 15 min
- [x] Tests (`tests/venues-courts-devices.test.js`, `tests/clips.test.js`, 27 tests): CRUD +
      404-on-Deleted for venues/courts/devices/clips; device cross-venue isolation; public
      cooldown merge; revoked device 401; upload + Range playback; expiry

### Recorder box (`edge/`)

- [x] Scaffold `edge/` (Node ≥ 20.12, ESM, eslint + prettier matching `back/`), `edge/.env.example`
      (`API_URL`, `DEVICE_TOKEN`, `DATA_DIR`, encoder, buffer, intervals), pm2 `ecosystem.config.cjs`
- [x] Config sync: `/device/config` on start + every 60 s (cached for a dead API); one ffmpeg
      ring-buffer recorder per active court, restart with backoff (2 → 30 s), stalled-stream kill
- [x] Heartbeat every 30 s with agent version + per-court camera status and readable, masked
      messages ("Camera not reachable — check Wi-Fi/power", wrong password, wrong path)
- [x] Job loop: long-poll `/device/jobs` → claim → wait for the post window → select segments by
      real time → concat → trim → logo overlay (bottom-right, 12 %) → H.264 (hardware if present,
      else `libx264 veryfast`) + AAC, faststart → JPEG thumbnail → upload with retry/backoff;
      `fail` with a reason when the buffer doesn't cover the moment
- [x] Local queue persisted to disk (`queue.json`) so cut-but-not-uploaded clips survive a reboot
- [x] `edge/README.md` (install, NTP, Tapo C200 setup, fake-camera testing, troubleshooting) +
      `edge/CLAUDE.md` + `.claude/skills/edge-conventions/SKILL.md`; `edge/` added to root
      `CLAUDE.md`, `README.md` and the shared product version in `/publish`
- [x] `npm run lint` clean, `npm test` 58/58, `npm run smoke` (real ffmpeg record → cut → watermark
      with A-law audio and irregular keyframes; also `--encoder libx264` and `--bursty`) OK
- [x] Load test: 6 courts recording, 3 simultaneous clip jobs on the target box — record CPU and
      job time in `edge/README.md` *(needs the real box hardware; table left as TODO)*
      *(closed 2026-11-19 by owner decision, not run; CR-008's box health report shows CPU, memory and disk on the real box instead)*

### Frontend

- [x] `services/api/admin/{venues,courts,devices,clips}.js` + `services/requests/admin/*`
- [x] `pages/Admin/DynaCam/Venues/` (list + drawer, logo upload, retention days, phone)
- [x] `pages/Admin/DynaCam/Courts/` (venue filter, camera chip, recorder dot, drawer with the
      Tapo helper; Print QR A5 sign via `qrcode.react` 4.2.0; Rotate QR; copy/open player link)
- [x] `pages/Admin/DynaCam/Devices/` (online/offline + "seen … ago", cameras, token dialog shown
      once with the box's `.env` lines; revoke / re-issue / delete)
- [x] `pages/Admin/DynaCam/Clips/` (thumbnails, filters, preview player, download, copy link, delete)
- [x] Registered in [`AdminRoute.jsx`](../../../front/src/routes/pageRoutes/AdminRoute.jsx) under
      a "Dyna Cam" sidebar group with matching `<ProtectedRoute module/submodule>`
- [x] `services/api/public/*` + `pages/Public/Court/` (`/court/:qrToken`) + `pages/Public/Clip/`
      (`/clip/:shareToken`, polling, player, download, Web Share); routes in
      [`routes/index.jsx`](../../../front/src/routes/index.jsx)
- [x] API follow-ups from the frontend review: per-page picker endpoints
      (`/courts/options`, `/devices/options`, `/clips/options`), `venueLogoUrl` on courts,
      `lastSeenSecondsAgo` on devices, `downloadUrl` (`Content-Disposition: attachment`)
- [x] `npm run lint` (0 errors, the 9 pre-existing warnings) and `npm run build` pass

### Tapo cameras (added 2026-11-17 — venue uses Tapo C200, Wi-Fi)

- [x] `edge/`: record with `-c:v copy -c:a aac` (Tapo A-law audio can't be stream-copied into
      `.ts`); unit test asserts the args; smoke uses an A-law source and checks AAC in the mp4
- [x] `edge/`: input timeout + stalled-stream kill so a dropped Wi-Fi stream restarts; backoff
      ≤ 30 s; heartbeat reports "Camera not reachable" with the reason
- [x] `edge/README.md`: "Tapo C200 setup" section (camera account, DHCP reservation, privacy /
      tracking / patrol off, 2.4 GHz, two-of-three rule, battery models unsupported, OSD)
- [x] Courts drawer: "Tapo camera" helper (IP + camera-account username/password + quality) →
      `rtsp://user:pass@ip:554/streamN` with URL-encoded credentials; "Other RTSP camera" keeps
      the raw URL. No API change.
- [x] Probe the venue's real C200 (hardware 2.0, firmware 1.3.17), 2026-11-17: `stream1` H.264 High
      1280×720 (nominal ~30 fps, **actually 15 fps** — 150 frames in 10 s), `stream2` 640×360,
      audio G.711 A-law 8 kHz mono. Works with the Camera Account, not the Tapo login.
- [x] `edge/`: segments timed by real time, not file names — segments.csv (camera timestamps) +
      each closed file's mtime as the wall-clock anchor, keeping the smallest offset per run so
      connect bursts are discarded. (`-use_wallclock_as_timestamps` was tried and rejected: it
      halved the frames in cut clips.) Unit-tested with irregular durations.
- [x] Full clip end to end with the real C200 through the API (throwaway database): QR save →
      box cut → **Ready 9 s later**, 65.0 s, 1280×720 H.264 + AAC, 972 frames (= the camera's
      15 fps), download header `attachment; filename=dyna-cam-replay.mp4`. Camera password found
      in no log.
- [x] Install guide: set the C200's video quality to 1080p in the Tapo app if the venue wants it
      (it was sending 720p); optionally turn off its date/time OSD *(venue decision — documented in
      `edge/README.md`, nothing to build)* *(closed 2026-11-19)*

### Phase 1 wrap-up

- [x] `cd back && npm run lint && npm test` passes (102 tests)
- [x] `cd front && npm run lint && npm run build` passes
- [x] `cd edge && npm run lint && npm test && npm run smoke` passes
- [x] Migrations noted as pending for deploy: `001`, `002` not applied to the local `dyna-cam`
      database yet (`cd back && npm run db:migrate`) — the end-to-end run used a throwaway database
- [x] Tried end to end: venue → court → device → `edge/` recording the venue's Tapo C200 → QR save
      → clip ready and playable with a working download link (the phone-scan step was simulated
      with the same HTTP calls the court page makes)
- [x] Changelog entry (`ref: PLAN-001`, added: QR replay clips)

## Phase 2: Physical button + staff save

- [x] Migration `003_add_button_code_to_courts.sql`: `courts.buttonCode` + unique index (the
      `BUTTON` source already exists in `clips.source`); deleting a court or venue frees its code
- [x] Device endpoint `POST /device/buttons/:buttonCode/press` (`{pressedAtMs?}`) → `BUTTON` clip
      anchored to the press time, same rules as a QR save via the shared
      `utils/clipRequests.js`; 404 for another venue's button, 422 for a press older than 2 min
- [x] `edge/`: LAN listener (`BUTTON_PORT` 8089) `GET|POST /press/:buttonCode`, timestamped on
      receipt, answers 202 at once, optional `BUTTON_KEY`, 3 s debounce, relayed with retries
      while under 100 s old, persisted in the queue; Shelly / ESP32 setup in `edge/README.md`
- [x] Admin `POST /admin/clips` (staff save for a court) behind `clips` write; 503
      `CAMERA_OFFLINE` while the box is offline
- [x] Courts drawer: button code field (with "Generate" and the box URL hint) + list column;
      Clips page: "Save clip now" dialog (write access only, inactive courts hidden) + source chip
- [x] Tests (`tests/buttons-staff-save.test.js`, 9): codes unique + freed on delete; press →
      BUTTON clip at the press time, merge, another venue's button 404, too-old 422; staff save
      201, offline 503, read-only 403, deleted court 404
- [x] Tried on the real Tapo C200 (throwaway database): a button press sent to the box's LAN
      listener (as a Shelly would) → 202, wrong key → 401 → `BUTTON` clip Ready in 9 s, 65.0 s;
      staff "Save clip now" → `STAFF` clip Ready in 9 s. *(No physical Shelly/ESP32 button on hand —
      the press was the same HTTP call the button makes.)*
- [x] Lint/test/build pass (API 112 tests, web lint + build, edge 71 tests); changelog entry
      (`ref: PLAN-001`)

## Phase 3: Full-session recording

- [x] Migration `004_create_recording_sessions.sql`: `recording_sessions` (window, player name,
      phone, share token, status) + `clips.sessionId` / `partIndex` / `windowStartAt` /
      `windowEndAt` (unique per session part)
- [x] Design (changed from one big file, 2026-11-17): a session is delivered as **5-minute parts**,
      each an ordinary clip (source `SESSION`) with an explicit window — reuses cut / watermark /
      upload / expiry, keeps every upload ~40–50 MB. Parts are created when due (box polls
      `/device/jobs` or `/device/config`, plus the hourly maintenance) — no scheduler
- [x] Admin `/sessions` (list, get with parts, book, cancel before start, end early) behind
      `clips`; booking checks camera, 5 min – 3 h, now … +14 days, no overlap per court (court row
      locked)
- [x] Device API: `/config` lists sessions to keep footage for; part jobs carry
      `windowStartMs`/`windowEndMs`; upload/fail settle the session (Ready / Ready with a note /
      Failed); upload route allows 15-minute requests (slow venue lines)
- [x] Public `GET /public/sessions/:shareToken` (session + parts, signed links)
- [x] `edge/`: keeps segments overlapping a booked window (±10 s) until 30 min after it ends;
      cuts part windows exactly (made if ≥ 80 % covered, else `fail` with the %); players' clips
      cut before parts; bitrate caps (part ≤ ~47 MB / 5 min, clip ≤ ~19.5 MB / 65 s); disk
      warning < 2 GB, stops keeping session footage < 500 MB
- [x] `pages/Admin/DynaCam/Sessions/` (list, book drawer in Manila time, booked-link dialog,
      cancel / end now, detail sheet with parts) + player page `/session/:shareToken`; Clips list
      shows "Session · part N"
- [x] Tests (`tests/sessions.test.js`, 8): booking rules + overlap 409 + read-only 403; parts due
      only after their window, home box only; Ready / partial / Failed settling; end early;
      cancelled / invalid links 404
- [x] Session parts get 60 min before the stale sweep fails them (clips keep 15) — the box keeps
      their footage and cuts players' clips first
- [x] Tried on the real C200 (throwaway database): booked a session starting now, ended it
      after ~2 min → part Ready 10 s later, exactly 126.0 s, every frame (15 fps) + AAC, 6.2 MB
      (≈ 15 MB per 5-min part); the public session page lists it Ready. Ordinary clips now 4.4 MB
      per 65 s with the size caps
- [x] Lint/test/build pass (API 121 tests, web lint + build, edge 81 tests + smoke); changelog
      entry (`ref: PLAN-001`)

## Phase 4: Paid clips — cash at the front desk

> Changed 2026-11-17 at the user's request: **cash only for now**; PayMongo (GCash / Maya /
> card) is deferred. The PayMongo research is kept in plan.md for when it comes back.

- [x] Migration `005_add_clip_payments.sql`: `venues.clipPrice`; `clips.price` /
      `paymentStatus` (Free / Unpaid / Paid) / `payCode` (unique); `payments` (CASH, received by,
      note, refund); `payments` permission (+ seed)
- [x] Clip creation (`utils/clipRequests.js`): players' QR / button clips get the venue's price
      and a 6-character pay code (no 0/O/1/I/L); staff saves and session parts are free
- [x] Public `GET /clips/:shareToken`: an Unpaid clip is `locked` — thumbnail, price and pay
      code only, no video or download link until paid
- [x] Admin `/payments` (permission `payments`): list with today / month totals, `lookup` by pay
      code (case and spaces ignored), record cash (by pay code or clip), refund (locks the clip
      again); `paymentStatus` filter on Clips
- [x] Tests (`tests/payments.test.js`, 8): locked page, lookup, pay once (409 after), read-only
      403, totals, refund re-locks, pay from the clip, free venue + staff save free, no payment
      for a failed clip, price validation
- [x] Web: venue clip-price field + list column; locked player page (dimmed thumbnail, price,
      spaced pay code, auto-unlocks within 5 s of payment); Payments page (totals, Take payment by
      code, list, refund); payment chip / filter / "Record cash payment" on Clips;
      `/payments/options` so the page needs only the payments permission
- [x] Lint/test/build pass (API 130 tests incl. 9 payment tests, web lint + build); changelog
      entry (`ref: PLAN-001`)

## Phase 5: Live streaming

- [x] Migration `006_add_streaming_to_courts.sql`: `courts.streamEnabled`, `streamRtmpUrl`
      (encrypted, write-only), `streamWatchUrl`
- [x] Courts API: stream on/off, RTMP address (masked on read: only the key's last 4
      characters), watch link; can't enable without an address; `removeStream`
- [x] `/device/config` gives each court's `stream.rtmpUrl` to the venue's own box only; heartbeat
      carries `streamStatus` / `streamMessage`, shown on Recorder boxes
- [x] Court public page: `liveWatchUrl` → "Watch live" button while streaming
- [x] **One RTSP connection** (real C200 allows only one client): `edge/` restreams from the
      recorder's own ffmpeg via `tee` + `fifo` (`onfail=ignore`, auto-recovery every 10 s, drops
      stream packets rather than stall recording); config changes restart the recorder (never
      while an uncut clip window is in the last 70 s); stream key masked in every log
- [x] Web: Live stream section in the court drawer, "Live" chip, stream health per camera,
      "Watch live" on the player page
- [x] Tests: API `tests/streaming.test.js` (5); edge 95 unit tests + smoke with a local RTMP
      receiver (live → receiver killed → error, recording continues → receiver back → live)
- [x] Tried on the real C200 (throwaway database, local RTMP receiver instead of YouTube):
      stream **live** within 45 s; receiver got 1280×720 H.264 + AAC 44.1 kHz, 83 s; a clip saved
      while streaming Ready in 9 s; receiver stopped → "Can't reach the streaming service" while
      recording continued and the next clip was Ready in 12 s; stream key in no log.
      *(Not yet tried against YouTube / Facebook themselves — needs the venue's stream key.)*
- [x] Lint/test/build pass (API 135 tests, edge 95 tests + smoke, web lint + build); changelog
      entry (`ref: PLAN-001`)

## Phase 6: Staff mobile app screens (`app/`)

- [x] Loaded `mobile-conventions` + `new-mobile-module`; routes in `constants/navigations.js`
      (Courts, CourtDetail, Clips, ClipDetail, Sessions, SessionDetail, TakePayment, RecorderBoxes)
- [x] `services/api/*` + `services/requests/*` for permissions, courts, devices, clips, sessions,
      payments (the admin endpoints); the signed-in user's permissions (`/permissions/user`, the
      same call the web makes) decide which Menu rows and actions show — read to see, write to act
- [x] Courts screen: per-venue list with camera / box / stream state and button code
- [x] Save clip now from a court → full-screen QR of the share link for the player (QR drawn with
      `toqr` 0.1.1 + `react-native-svg` — pure JS, no new dev build)
- [x] Clips screen: `DataList` with thumbnails, filters (venue / court / status / payment),
      detail with play + download (opens the signed link in the phone's player — no
      `expo-video`/`expo-av` installed), share link + QR, "Record ₱X cash"
- [x] Sessions screen: list with progress, book (Now / Later in Manila time, 30–180 min, player
      name + phone `0912 3456 789`), cancel / end now, detail with parts
- [x] Take payment screen (added — Phase 4 exists): pay code → lookup → "Record ₱X cash"
- [x] Recorder boxes screen (read-only): online, last seen, per-camera status
- [x] Dashboard tab: clips today, unpaid, sessions recording, boxes offline (permission-aware)
- [x] Scan court QR → opens that court *(not built: needs `expo-camera`, a native module → a new
      dev build, and an admin lookup of a court by QR token; left for a CR)*
      *(closed 2026-11-19 by owner decision, not run; superseded by PLAN-002: the app is a session device, staff work is on the web)*
- [x] Removed the template `Screens/Example/`, example SQLite table/endpoints and the placeholder
      Dashboard; `App.js` QueryClient now has defaults (15 s stale, no retry on 4xx)
- [x] `npx expo export --platform android --clear` bundles (3697 modules); `npx expo-doctor` 19/20
      (only the pre-existing "11 packages out of date"); every API path the app calls exists
- [x] Tried on a physical Android phone against the local API *(needs a phone on the venue LAN)*
      *(closed 2026-11-19 by owner decision, not run)*
- [x] Changelog entry (`ref: PLAN-001`, added: staff app)

## Final wrap-up

- [x] Every phase above ticked
- [x] `plan.md` status set to `Done`
