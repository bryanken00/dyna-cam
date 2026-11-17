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

- [ ] Scaffold `edge/` (Node 20, ESM, eslint + prettier matching `back/`), `edge/.env.example`
      (`API_URL`, `DEVICE_TOKEN`, `DATA_DIR`), pm2 `ecosystem.config.cjs`
- [ ] Config sync: fetch `/device/config` on start + every 60s; start/stop one ffmpeg ring-buffer
      process per active court (`-c copy`, 2s segments, ~3 min ring); auto-restart on exit
- [ ] Heartbeat every 30s with agent version + per-court camera status
- [ ] Job loop: long-poll `/device/jobs`; for each clip job select segments for
      `[requestedAt − 60s, requestedAt + 5s]`, concat, overlay venue logo, encode MP4
      (hw encoder if present, else `libx264 veryfast`), thumbnail, upload with retry/backoff
- [ ] Local queue persisted to disk so pending uploads survive a reboot
- [ ] `edge/README.md` (install on a mini PC, NTP, camera setup) + `edge/CLAUDE.md` pointer +
      `.claude/skills/edge-conventions/SKILL.md`; add `edge/` to root `CLAUDE.md` layout table
- [ ] Load test: 6 courts recording, 3 simultaneous clip jobs on the target box — record CPU and
      job time in `edge/README.md`

### Frontend

- [ ] `services/api/admin/{venues,courts,devices,clips}.js` + `services/requests/admin/*`
- [ ] `pages/Admin/Venues/` (list + drawer, logo upload, prices, retention days, phone)
- [ ] `pages/Admin/Courts/` (list filtered by venue + drawer; "Print QR" printable A5 sign;
      "Rotate QR")
- [ ] `pages/Admin/Devices/` (list with online/offline from `lastSeenAt`; "Add device" shows the
      token once with copy; revoke)
- [ ] `pages/Admin/Clips/` (thumbnail column, preview player sheet, filters, copy link, delete)
- [ ] Register all four in [`AdminRoute.jsx`](../../../front/src/routes/pageRoutes/AdminRoute.jsx)
      with matching `<ProtectedRoute module/submodule>`
- [ ] `services/api/public/*` (no auth header) + `pages/Public/Court/` (`/court/:qrToken`,
      "Save last 60 seconds", privacy notice) + `pages/Public/Clip/` (`/clip/:shareToken`,
      status polling, player, download, Web Share); routes in
      [`routes/index.jsx`](../../../front/src/routes/index.jsx)

### Tapo cameras (added 2026-11-17 — venue uses Tapo C200, Wi-Fi)

- [ ] `edge/`: record with `-c:v copy -c:a aac` (Tapo A-law audio can't be stream-copied into
      `.ts` — it silently becomes unplayable data); unit test asserts the args; smoke test uses an
      A-law source and checks the final mp4 has AAC audio
- [ ] `edge/`: input timeout so a dropped Wi-Fi stream ends ffmpeg instead of hanging; reconnect
      with backoff (≤ 30 s); heartbeat reports "Camera not reachable" with the reason
- [ ] `edge/README.md`: "Tapo C200 setup" — camera account (Tapo app → Advanced settings →
      Camera Account, 6–32 chars), DHCP reservation, privacy mode / motion tracking / patrol off,
      fixed pan-tilt position, 2.4 GHz signal check, the SD / Tapo Care / RTSP two-of-three rule,
      battery Tapo models unsupported
- [ ] Courts drawer: "Tapo camera" helper (camera IP + camera-account username + password +
      quality `stream1`/`stream2`) that builds `rtsp://user:pass@ip:554/streamN` with URL-encoded
      credentials; "Other RTSP camera" keeps the raw URL field. No API change.
- [x] Probe the venue's real C200 (hardware 2.0, firmware 1.3.17) from a laptop on the same LAN,
      2026-11-17. Results:
      - `stream1`: H.264 High 1280×720, about 30 fps. `stream2`: 640×360. Audio on both: G.711
        A-law (`pcm_alaw`) 8 kHz mono.
      - The first try was refused (401). It works with the Camera Account, not the Tapo login.
      - A 30 s recording with video copied and audio converted to AAC: 13 segments, all
        H.264 + AAC.
      - A 20 s cut with the logo overlay and libx264: exactly 20.000 s, 1280×720, about
        0.75 Mbps, so a 65 s clip is about 6 MB.
- [ ] `edge/`: give segments real wall-clock start/end times and pick segments by those, not by
      file name. On the real C200, segments split only on keyframes (1.7–6.1 s long), and the
      buffered burst at connect made file names run up to a few seconds ahead of their content.
      Use `-use_wallclock_as_timestamps 1` plus a segment list, or probe each segment. Unit test
      with uneven durations.
- [ ] Confirm a full clip end to end with the real C200 through the API (QR save → box cuts →
      clip plays on `/clip/:shareToken`)
- [ ] Install guide: set the C200's video quality to 1080p in the Tapo app if the venue wants it
      (it was sending 720p). Optionally turn off the camera's own date/time stamp; it and the
      "tapo" logo are burned into the video, which is why our watermark goes bottom-right.

### Phase 1 wrap-up

- [ ] `cd back && npm run lint && npm test` passes
- [ ] `cd front && npm run lint && npm run build` passes
- [ ] Migrations applied locally (`npm run db:migrate`), or noted as pending for deploy
- [ ] Tried end to end: create venue → court → device → run `edge/` against the venue's Tapo
      C200 → scan court QR on a phone → clip with logo plays on `/clip/:shareToken`
- [ ] Changelog entry (`ref: PLAN-001`, added: QR replay clips)

## Phase 2: Physical button + staff save

- [ ] Migration: `courts.buttonCode` unique index (if not already in 001), button press source
- [ ] Device endpoint `POST /device/buttons/:buttonCode/press` → creates a `BUTTON` clip using
      the box-supplied timestamp (same cooldown merge)
- [ ] `edge/`: LAN listener `POST /press/:buttonCode`, timestamped locally, queued if offline
- [ ] Admin `POST /admin/clips` (staff save for a court) behind `clips` write
- [ ] Courts drawer: button code field; Clips page: "Save clip now" action
- [ ] Tests: button press for another venue's button → 404; staff save permission 403 for
      read-only role
- [ ] Tried: press the Wi-Fi button on court → clip appears in Admin Clips with source `BUTTON`
- [ ] Lint/test/build pass; changelog entry (`ref: PLAN-001`)

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
