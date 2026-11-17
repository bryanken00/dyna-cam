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
- [ ] Sign in on a device against the local API (`http://<LAN-IP>:4021`) and log out cleanly

### Phase 0 wrap-up

- [x] `cd back && npm run lint && npm test` passes
- [x] `cd front && npm run lint && npm run build` passes
- [x] `cd app && npx expo export --platform android --clear` bundles (3642 modules)
- [ ] `cd app && npx expo-doctor@latest` passes — **fails 1 check: 11 Expo packages behind SDK 58's
      pinned versions** (pre-existing; fix with `npx expo install --check`, then a new dev build)
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
- [ ] Load test: 6 courts recording, 3 simultaneous clip jobs on the target box — record CPU and
      job time in `edge/README.md` *(needs the real box hardware; table left as TODO)*

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
- [ ] Install guide: set the C200's video quality to 1080p in the Tapo app if the venue wants it
      (it was sending 720p); optionally turn off its date/time OSD *(venue decision — documented in
      `edge/README.md`, nothing to build)*

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

- [ ] Migration: `recording_sessions` table; `clips.sessionId` FK
- [ ] Admin `/sessions` (list, create, cancel) behind `clips`; overlap check per court in one
      transaction with `FOR UPDATE`
- [ ] Device jobs include session start/stop; `POST /device/sessions/:sessionId/state`
- [ ] `edge/`: copy segments to a session folder while active; concat + watermark + upload on end
- [ ] `pages/Admin/Sessions/` (schedule with court, start, end, player name, optional phone via
      `zPhone`/`formatPhoneOnChange`; cancel)
- [ ] Tests: overlapping session → 409; cross-venue isolation on session state
- [ ] Tried: schedule a 10-minute session → one `SESSION` clip delivered after it ends
- [ ] Lint/test/build pass; changelog entry (`ref: PLAN-001`)

## Phase 4: Paid clips

- [ ] Migration: `payments` table + `payments` permission row
- [ ] `lib/paymongo/`: create checkout session (GCash, Maya, card), verify webhook signature;
      env `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET`
- [ ] Clip creation sets `price` / `paymentStatus` from the venue (`0` → `Free`)
- [ ] Public `POST /clips/:shareToken/checkout`; `POST /payments/webhook` idempotent on
      `providerRef`; `GET /clips/:shareToken` withholds the video link while `Unpaid`
- [ ] Admin `/payments` (list, get) behind `payments`; dashboard revenue card
- [ ] Clip page: thumbnail + "Pay with GCash / Maya / Card" when unpaid; return URL re-polls
- [ ] Tests: forged webhook signature → 401; replayed webhook → no double-paid; unpaid clip never
      returns a video link
- [ ] Tried with PayMongo test keys: pay with test GCash → clip unlocks
- [ ] Lint/test/build pass; changelog entry (`ref: PLAN-001`)

## Phase 5: Live streaming

- [ ] Courts drawer: stream on/off + RTMP URL/key (encrypted, masked on read)
- [ ] `/device/config` includes stream targets for the device's own venue only
- [ ] `edge/`: per-court restream process (`-c copy` to RTMP), restart on failure, status in
      heartbeat
- [ ] Court public page shows "Watch live" link when streaming
- [ ] Tried: toggle stream on → court visible on the YouTube/Facebook live page within 30s
- [ ] Lint/test/build pass; changelog entry (`ref: PLAN-001`)

## Phase 6: Staff mobile app screens (`app/`)

- [ ] Load `mobile-conventions` + `new-mobile-module`; add routes to
      `constants/navigations.js`
- [ ] `services/api/*` + `services/requests/*` for venues, courts, clips, sessions (reuse the
      admin endpoints; permissions drive which tabs show)
- [ ] Courts screen: per-venue list with camera / box / stream status
- [ ] Save clip now from a court → shows a QR of the share link for the player
- [ ] Clips screen: `DataList` with thumbnails, video player, share / copy link
- [ ] Sessions screen: start / schedule / cancel a session
- [ ] Scan court QR (`useCamera`) → opens that court's admin view
- [ ] Remove the template `Screens/Example/`, example SQLite table/endpoints and placeholder
      Dashboard once the real screens replace them
- [ ] `npx expo-doctor@latest` + `npx expo export --platform android --clear` pass; tried on a
      physical Android phone against the local API
- [ ] Changelog entry (`ref: PLAN-001`, added: staff app)

## Final wrap-up

- [ ] Every phase above ticked
- [ ] `plan.md` status set to `Done`
