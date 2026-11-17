# PLAN-001 · Court replay cameras ("Pickle Cam"-style) — Checklist

> Tick items as they land. Plan: [plan.md](plan.md). Phases ship independently; finish one
> phase's wrap-up before starting the next.

## Phase 0: Repo consolidation + cleanup

### Docs, skills, CLAUDE.md → root

- [ ] Diff each `app/.claude/skills/{plan-doc,change-request,bug-report,changelog}/SKILL.md`
      against the root copy, fold any useful additions (e.g. `argument-hint`) into the root
      version, then delete the `app/` copy
- [ ] Widen the root workflow skills' "when to run" wording to cover `front/`, `back/`, `app/`
      and `edge/`
- [ ] Extend root `publish` to also bump `app/package.json`, `app/app.json` `expo.version` and
      `app/src/constants/version.js`; delete `app/.claude/skills/publish`
- [ ] `git mv app/.claude/skills/frontend-conventions .claude/skills/mobile-conventions`; rename
      its `name:` and rewrite its description so it triggers on `app/src` / `app/App.js`
- [ ] `git mv` `app/docs/{DESIGN_GUIDELINES,MODULE_PATTERN,ENGINEERING_CHECKLIST}.md` into
      `.claude/skills/mobile-conventions/references/` (kebab-case names) and add them to the
      skill's routing table
- [ ] Move `app/CLAUDE.md`'s Architecture / Theming / Typography / Traps / Commands content into
      `mobile-conventions` references; replace `app/CLAUDE.md` with a short pointer modelled on
      [`front/CLAUDE.md`](../../../front/CLAUDE.md)
- [ ] `git mv app/.claude/skills/new-module .claude/skills/new-mobile-module`; rename `name:`;
      point the root `new-module` skill at it for the mobile half
- [ ] Delete `app/.claude/settings.json` (identical to root) and the now-empty `app/.claude/`
- [ ] Delete `app/docs/` (empty `plans/`, `change-requests/`, `bug-reports/`, `changelog/`
      scaffolding + its README) after the moves above
- [ ] Trim `app/README.md` to run / build / env instructions for the app
- [ ] Root `CLAUDE.md`: fix the tenancy paragraph (no SuperAdmin/company/branch in code), add
      `app/` (and later `edge/`) to the layout + skills tables, add the app's verification loop
      (`npx expo-doctor@latest`, `npx expo export --platform android --clear`)
- [ ] Root `README.md`: Dyna Cam overview + quick start for `back/`, `front/`, `app/`
- [ ] Grep the repo for dead links to `app/docs/…`, `docs/DESIGN_GUIDELINES.md`,
      `docs/MODULE_PATTERN.md`, `docs/ENGINEERING_CHECKLIST.md` and fix them

### Template cleanup

- [ ] `app/app.json`: name, slug, `android.package`, `ios.bundleIdentifier` → Dyna Cam values;
      `app/package.json` `name` → `dyna-cam-app`
- [ ] `app/.env.example`: `EXPO_PUBLIC_API_URL=http://localhost:4021`, LAN-IP hint updated
- [ ] `app/eas.json`: `production` profile sets `EXPO_PUBLIC_DEMO_MODE=false` explicitly
- [ ] `back/package.json` → `dyna-cam-api`, `front/package.json` → `dyna-cam-web` (names and
      descriptions only — **no** version bump by hand)
- [ ] Delete root `.DS_Store`; add `.DS_Store` to [`.gitignore`](../../../.gitignore)
- [ ] `run.sh` / `run-mac.sh`: optional `app` target running `npx expo start` in `app/`
- [ ] Landing page decision applied (see Open questions) — either replaced with a Dyna Cam page
      or left for a later CR

### Connect `app/` to this API

- [ ] `app/src/services/api/auth.js` + `requests/auth.js`: unwrap the
      `{ success, message, data }` envelope (two `.data` hops), store access + refresh tokens
- [ ] `app/src/services/api/axios.js`: refresh-token rotation on 401 via `/admin/auth/refresh`
- [ ] Handle 403 `PASSWORD_CHANGE_REQUIRED`: route the user to a change-password screen
- [ ] Sign in on a device against the local API (`http://<LAN-IP>:4021`) and log out cleanly

### Phase 0 wrap-up

- [ ] `cd back && npm run lint && npm test` passes
- [ ] `cd front && npm run lint && npm run build` passes
- [ ] `cd app && npx expo-doctor@latest && npx expo export --platform android --clear` passes
- [ ] Changelog entry (`ref: PLAN-001`, internal: repo consolidation + app auth)

## Phase 1: Foundation + QR clips + watermark

### Backend

- [ ] Migration `001_create_venues_courts_devices.sql`: `venues`, `courts`, `devices` tables +
      permission rows `venues/list`, `venues/courts`, `venues/devices` (idempotent
      `WHERE NOT EXISTS`) granted to Owner
- [ ] Migration `002_create_clips.sql`: `clips` table + `clips` permission row
- [ ] Add the same permissions to the seed array in
      [`setup-database.js`](../../../back/scripts/setup-database.js)
- [ ] `utils/crypto/secretBox.js`: encrypt/decrypt RTSP & RTMP URLs with `DEVICE_SECRET_KEY`;
      add `DEVICE_SECRET_KEY`, `CLIP_MAX_UPLOAD_MB`, `PUBLIC_APP_URL` to `back/.env.example`
- [ ] Validators: `venues`, `courts`, `devices`, `clips` (`_helpers.js` wrappers, `optionalPhone()`
      on venue phone, `optionalUploadPath()` on `logoUrl`)
- [ ] `venues.controller.js`: CRUD behind `checkPermission("venues", "list", …)`; `logoUrl`
      returned via `signUploadUrl()`
- [ ] `courts.controller.js`: CRUD + `POST /:courtId/rotate-qr` behind `venues/courts`;
      `cameraRtspUrl` never returned in lists (masked in get-one)
- [ ] `devices.controller.js`: CRUD + revoke behind `venues/devices`; create returns the
      plaintext token once, stores SHA-256 `tokenHash`
- [ ] `clips.controller.js` (admin): list with filters, get-one with signed video/thumbnail links,
      soft delete, behind `clips`
- [ ] Mount the four groups in [`routes/v1/admin/index.js`](../../../back/server/src/routes/v1/admin/index.js)
      with `requireAuth` + `auditTrail(...)`
- [ ] `middlewares/deviceAuth.middleware.js`: `Authorization: Device <token>` → `req.device`
      (`deviceId`, `venueId`); updates `lastSeenAt`; 401 on revoked/deleted
- [ ] `routes/v1/device/index.js` + controllers: `heartbeat`, `config`, `jobs` (long-poll),
      `clips/:clipId/{processing,upload,fail}`; mounted at `/v1/device` in
      [`route.js`](../../../back/server/src/routes/route.js)
- [ ] Clip upload: multer to `uploads/admin/clips/{venueId}/{clipId}/` via `uploadFolderId()`,
      `uploadLimiter`, size cap `CLIP_MAX_UPLOAD_MB`, mp4 + jpeg only
- [ ] `routes/v1/public/index.js` + controllers: `GET /courts/:qrToken`,
      `POST /courts/:qrToken/clips` (20s cooldown merge, per-IP + per-court rate limit),
      `GET /clips/:shareToken`; mounted at `/v1/public`
- [ ] Confirm the signed-upload static handler serves HTTP `Range` (video seeking on iOS Safari);
      fix if not
- [ ] `jobs/expireClips.js`: daily — mark clips past `expiresAt` `Expired`, unlink their files
- [ ] Tests: CRUD + 404-on-Deleted for venues/courts/devices/clips; device cross-venue
      isolation (device A can't fetch/upload venue B's clip); public cooldown merge; revoked
      device 401

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

### Phase 1 wrap-up

- [ ] `cd back && npm run lint && npm test` passes
- [ ] `cd front && npm run lint && npm run build` passes
- [ ] Migrations applied locally (`npm run db:migrate`), or noted as pending for deploy
- [ ] Tried end to end: create venue → court → device → run `edge/` against a test RTSP
      camera → scan court QR on a phone → clip with logo plays on `/clip/:shareToken`
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
