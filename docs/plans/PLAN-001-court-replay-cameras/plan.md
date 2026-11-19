# PLAN-001 · Court replay cameras ("Pickle Cam"-style)

> **Status:** Done · **Created:** 2026-11-17 · **Owner:** — · **Checklist:** [checklist.md](checklist.md)
> **Related:** —

## Goal

Turn this template into **Dyna Cam**: a court-camera service for pickleball venues. Each court has
a fixed camera. A player scans the court's QR code or presses a button to save the last 60 seconds
as a replay clip, or books a full-session recording. They get the clip on their phone through a
share link, with the venue's logo burned in. Venue staff manage venues, courts, cameras, clips,
payments and live streams from the Admin portal. A **staff mobile app** (`app/`, Expo) handles the
on-court jobs. Before any of that, the repo is consolidated into one monorepo with one set of docs,
skills and `CLAUDE.md`, and the template leftovers are cleaned out.

## Context

**What "Pickle Cam" means here.** Philippine pickleball venues (for example in Antipolo and
Alabang) advertise a "Pickle Cam" or "play cam" so players can "relive your best rallies". There is
no single public product spec behind the name. The common pattern, also used by Wingfield Cam+,
PlaySight and Save My Play abroad, is:
camera per court → always-on rolling recording → player triggers "save" → short clip delivered to
their phone. This plan builds that pattern, with these decisions taken on 2026-11-17:

| Decision | Choice |
| --- | --- |
| How a highlight is saved | **QR scan** on court, **physical button**, and **full-session recording** |
| Camera setup | Off-the-shelf **RTSP IP cameras** per court + a small **on-site recorder box** per venue. The venue's cameras today are **TP-Link Tapo C200** (Wi-Fi), connected over RTSP; see [Camera: TP-Link Tapo](#camera-tp-link-tapo) |
| Who gets clips | **Anyone, via a share link / QR**. No player accounts in v1. |
| Extras in v1 | **Venue logo watermark**, **live streaming**, **paid clips** |

**What exists today.** The template has one Admin portal over one shared dataset:

- Auth, users, roles and permissions: [`schema.sql`](../../../back/database/schema.sql),
  [`routes/v1/admin/index.js`](../../../back/server/src/routes/v1/admin/index.js),
  [`AdminRoute.jsx`](../../../front/src/routes/pageRoutes/AdminRoute.jsx).
- Private uploads served only through signed, expiring links:
  [`signedUpload.middleware.js`](../../../back/server/src/middlewares/signedUpload.middleware.js),
  [`utils/file/signedUrl.js`](../../../back/server/src/utils/file/signedUrl.js).
- Public frontend routes are just the landing page and auth pages
  ([`routes/index.jsx`](../../../front/src/routes/index.jsx)).
- `back/database/migrations/` is empty, so this plan's first migration is `001_`.

**`app/` (added 2026-11-17)** is a separate Expo SDK 58 / React Native 0.88 starter
(`expo-template-2026`). It has its own copy of the repo tooling:

- `app/CLAUDE.md` and `app/README.md`.
- `app/.claude/skills/`. Its `plan-doc`, `change-request`, `bug-report`, `changelog` and
  `publish` have the **same names but different content** from the root skills. Its
  `frontend-conventions` and `new-module` describe the mobile app, not `front/`.
- `app/.claude/settings.json`, identical to the root one.
- `app/docs/`: three convention docs (`DESIGN_GUIDELINES.md`, `MODULE_PATTERN.md`,
  `ENGINEERING_CHECKLIST.md`) and empty `plans/`, `change-requests/`, `bug-reports/` and
  `changelog/` scaffolding.

Its auth already calls this API (`/api/v1/admin/auth`), but it still carries template
leftovers: the name "Expo Template", bundle ID `com.example.apptemplate`,
`EXPO_PUBLIC_API_URL=http://localhost:3000` (the API is now on 4021), `Screens/Example/`, the
SQLite example table and endpoints, demo fixtures, and a placeholder Dashboard. Claude Code
reads one `.claude/` from the session root, so the nested skills clash with the root ones and are
never picked up when working from the repo root.

**What's missing:** venues, courts, cameras, an on-site recorder, video handling, a public
(no-login) player flow, device authentication, payments and streaming. None of these exist yet,
so this is new work, not a change to an existing module.

> **Note:** the root `CLAUDE.md` describes companies, branches and a SuperAdmin portal, but the code has
> none of those (no `companies`/`branches` tables, one Admin portal). This plan uses
> **venues** as its own concept and does not depend on company/branch tenancy. See Open
> questions.

## Approach

### System overview

```
 ┌──────────── Venue (LAN) ────────────┐            ┌──────────── Cloud ─────────────┐
 │ IP camera ×N ──RTSP──▶ Recorder box │──HTTPS────▶│ back/ API   (device + public + │
 │ Wi-Fi button ──HTTP──▶ (edge/)      │  outbound  │              admin routes)     │
 │                         │ ffmpeg    │            │ MySQL · clip files (uploads)  │
 │                         └──RTMP────────────────▶ YouTube / Facebook Live (stream) │
 └─────────────────────────────────────┘            │ front/  Admin portal + public  │
       Player phone ──scan QR──────────────────────▶│         court & clip pages     │
                                                    └────────────────────────────────┘
```

There are four deployables. `app/` is the fourth and is described under
[Staff mobile app](#staff-mobile-app-app).

1. **`back/` (existing API)**: new tables and Admin endpoints, plus two new route families:
   **public** (no login, rate-limited) and **device** (recorder boxes, device-token auth).
2. **`front/` (existing client)**: new Admin pages, plus mobile-first **public pages** for the
   court QR and the clip share link.
3. **`edge/` (new top-level folder)**: the on-site **recorder box** app. Node 20 + ffmpeg, run
   under pm2 on a mini PC (for example an Intel N100 with an SSD) at each venue. It only makes
   outbound connections, so venues need no port-forwarding.

### Phase 0: Repo consolidation and cleanup

The goal is one repo with one source of truth for docs, skills and Claude instructions, and no
template leftovers.

**Target layout:**

```
dyna-cam/
├── CLAUDE.md            ← the only full CLAUDE.md; layout table lists front/ back/ app/ edge/ docs/
├── README.md            ← Dyna Cam overview + quick start for all four parts
├── .claude/
│   ├── settings.json    ← single copy (app's identical copy deleted)
│   └── skills/
│       ├── frontend-conventions/   (front/ — unchanged)
│       ├── backend-conventions/    (back/ — unchanged)
│       ├── mobile-conventions/     ← app/.claude/skills/frontend-conventions, renamed
│       │   └── references/         ← + app/docs/{DESIGN_GUIDELINES,MODULE_PATTERN,ENGINEERING_CHECKLIST}.md
│       ├── new-module/             ← root; gains a "mobile half" step that defers to new-mobile-module
│       ├── new-mobile-module/      ← app/.claude/skills/new-module, renamed
│       ├── edge-conventions/       ← new, written in Phase 1 with edge/
│       └── plan-doc, change-request, bug-report, changelog, publish  ← root copies only
├── docs/                ← the only docs/ (plans, CRs, bugs, changelog for every part)
├── front/  back/        ← unchanged structure
├── app/                 ← code + short app/CLAUDE.md pointer + app/README.md (run instructions only)
└── edge/                ← new (Phase 1)
```

**Merge rules:**

- **Workflow skills** (`plan-doc`, `change-request`, `bug-report`, `changelog`): keep the root
  versions and delete the `app/` copies. Merge anything useful from the app versions (such as
  their `argument-hint`) into the root ones, and widen their "when to run" wording from
  `front/`/`back/` to `front/`/`back/`/`app/`/`edge/`.
- **`publish`:** keep the root version and extend it to bump `app/package.json`,
  `app/app.json` (`expo.version`) and `app/src/constants/version.js` alongside `front/` and
  `back/`, so there is still one version for the whole product. This takes over the app copy's
  bump logic.
- **App conventions:** rename `app/.claude/skills/frontend-conventions` to
  `mobile-conventions`, and move the three `app/docs/*.md` convention docs into its
  `references/` (root rule: "coding conventions for a side live in that side's skill"). Fix
  every link that pointed at `docs/…`. Rename `app/.claude/skills/new-module` to
  `new-mobile-module`.
- **`app/CLAUDE.md`:** cut it down to a short pointer like [`front/CLAUDE.md`](../../../front/CLAUDE.md)
  ("load `mobile-conventions` before touching `app/src`"). Its architecture, theming and traps
  sections move into `mobile-conventions` references, so nothing is lost.
- **`app/docs/`:** remove it after the move. Its empty `plans/`, `change-requests/`,
  `bug-reports/` and `changelog/` folders are replaced by the root `docs/`.
- **`app/README.md`:** keep only the run, build and env instructions for the app. The template
  sales pitch ("What it looks like", "Make it yours") goes.
- **Root `CLAUDE.md`:** fix the inaccurate tenancy paragraph (there is no SuperAdmin, company or
  branch in the code), add the `app/` and `edge/` rows to the layout and skills tables, and add
  the app's verification loop (`npx expo-doctor`, `npx expo export --platform android`), since
  `app/` has no lint or test scripts.

**Template cleanup** (product name **Dyna Cam**):

| Where | Leftover | Action |
| --- | --- | --- |
| `app/` | `app.json` name/slug `Expo Template`/`expo-template`, bundle ID `com.example.apptemplate`, `package.json` name `expo-template-2026` | Rename to Dyna Cam and a real bundle ID (Open question) |
| `app/` | `Screens/Example/`, `store/database/tables/example.table.js`, `endpoints/example.endpoints.js`, `Screens/Home/Dashboard/` placeholder | Delete them and remove their registrations, once the first real screen exists to copy from instead |
| `app/` | `.env.example` `EXPO_PUBLIC_API_URL=http://localhost:3000` | Change to `4021` and update the LAN-IP hint |
| `app/` | `constants/demo.js` + demo mode | Keep for UI work, but make sure the release profile in `eas.json` can't ship with demo mode on |
| `back/`, `front/` | `package.json` `name: "template"` and descriptions | Rename to `dyna-cam-api` / `dyna-cam-web` |
| `front/` | Template landing page (`pages/LandingPage/`) | Replace with a Dyna Cam page (Open question) |
| Root | `.DS_Store` | Delete and add to `.gitignore` |
| `run.sh` / `run-mac.sh` | Start only `back` and `front` | Add an optional `app` target (`expo start`), and later `edge` |

### Staff mobile app (`app/`)

The app is for **venue staff**, since players use the no-login web pages. It signs in with the
same Admin accounts and permissions as the web portal and covers the jobs done standing at a
court:

- **Courts:** a live status list per venue (camera online, recorder box online, streaming on or
  off).
- **Save clip now:** the same `POST /admin/clips` as the web portal, with a QR to show the player
  so they can take the link.
- **Clips:** recent clips with a thumbnail, a player, and share or copy link.
- **Sessions:** start or schedule a full-session recording for a court.
- **Scan court QR:** uses the existing `useCamera` hook to open a court's admin view, which is
  handy during installs.

It follows `mobile-conventions` (the `services/api` + `services/requests` split, `pattern/` kit,
`DataList`). The SQLite offline layer is not needed for v1. Before building screens, make the app
work with this API's auth: the `{ success, message, data }` envelope (the app's `auth.js` comments
expect `{ message, token, user }`), refresh-token rotation, and the 403
`PASSWORD_CHANGE_REQUIRED` hold.

### Recorder box (`edge/`)

- **Rolling buffer per court:**
  `ffmpeg -rtsp_transport tcp -i <rtsp> -map 0:v:0 -map 0:a? -c:v copy -c:a aac -f segment -segment_time 2 …`
  This writes 2-second `.ts` segments in a ring of about 3 minutes. Video is stream-copied, so
  recording costs almost no CPU. Audio is re-encoded to AAC because Tapo cameras commonly send
  G.711 A-law audio, which MPEG-TS can't carry. A plain `-c copy` doesn't error; it silently
  stores the audio as unplayable data (tested 2026-11-17).
- **Clip job:** select the segments that cover `[requestedAt − 60s, requestedAt + 5s]`, concat,
  overlay the venue logo, and encode H.264 MP4 at 1080p. It uses hardware encoding (`h264_qsv` /
  `h264_vaapi`) when available and falls back to `libx264 -preset veryfast`. It also makes a JPEG
  thumbnail, then uploads both to the API.
- **Full session:** while a session is active, the box copies its segments to a session folder
  instead of letting the ring overwrite them. At the end it concatenates them, adds the watermark
  and uploads the result.
- **Physical button:** a Wi-Fi button (for example a Shelly Button 1 or an ESP32) sends an HTTP
  request to the box on the LAN (`POST /press/:buttonCode`). The box timestamps the press locally,
  so it works even when the internet is slow, and reports it to the API to create the clip.
- **Talking to the API:** heartbeat every 30s, `GET /device/config` (courts, RTSP URLs, logo,
  stream targets), and long-polling `GET /device/jobs` for pending clip and session jobs. Clip
  uploads use a multipart POST, with retry and resume on failure.
- **Clock:** the box runs NTP. The API stamps QR requests with server time (Asia/Manila) and the
  box matches segments by wall-clock.
- **Live streaming:** for each court with streaming on, a second ffmpeg process restreams RTSP to
  the configured RTMP target (YouTube or Facebook Live key), using `-c copy` and adding no
  watermark in v1.

### Camera: TP-Link Tapo

The venue uses **Tapo C200** cameras: indoor, pan/tilt, 1080p, 2.4 GHz Wi-Fi only (no Ethernet
port). Tapo cameras support RTSP and ONVIF Profile S once a camera account is set up. Nothing
Tapo-specific is needed on the API, which takes any RTSP URL. The work is in the Admin portal, the
recorder box and the install guide.

- **Connection:** `rtsp://<camera-account-user>:<password>@<camera-ip>:554/stream1`. `stream1` is
  high quality (1080p on the C200) and `stream2` is low quality. The **camera account** is created
  in the Tapo app (Camera settings → Advanced settings → Camera Account). It is separate from the
  Tapo cloud login, and its username and password must each be 6–32 characters. The ONVIF port is
  2020; we don't need ONVIF.
- **Admin portal:** the court drawer gets a **"Tapo camera" helper**. Staff enter the camera's
  IP, the camera account's username and password, and the quality (`stream1`/`stream2`). The
  page builds the RTSP URL with the credentials URL-encoded, so nobody hand-types it. "Other RTSP
  camera" keeps the raw URL field. The URL is still stored encrypted and never shown back.
- **Recorder box:** uses `-rtsp_transport tcp`, transcodes audio to AAC (see above), and uses an
  input timeout so a dropped Wi-Fi stream ends the ffmpeg process instead of hanging. It reconnects
  with backoff and reports "Camera not reachable" in its heartbeat, which the Recorder boxes page
  shows.
- **Camera settings for a court** (go in the install guide):
  - Reserve the camera's IP in the router (DHCP reservation) so the URL doesn't change.
  - Turn off privacy mode, motion tracking and patrol so the pan/tilt view stays fixed on the
    court.
  - Pick the best fixed position with the Tapo app's pan/tilt.
- **Wi-Fi:** the C200 is 2.4 GHz only. Check the signal at each court's mounting point, keep
  the recorder box wired to the router, and expect some drop-outs. Wired Tapo models (for example
  the C310 or C320WS, which have an Ethernet port) suit outdoor courts and larger venues better.
- **Not usable:** battery-powered Tapo cameras. TP-Link says battery models such as the C410,
  C420, C425 and D230 don't support RTSP.
- **Tapo's own limit:** SD-card recording, Tapo Care and NVR/RTSP streaming can't all run at
  once; only two of the three can. Turn Tapo Care or SD recording off if RTSP stops working.
- **Not used:** the Tapo S200B smart button. It works only through a Tapo hub, and TP-Link
  publishes no API for it, so the Phase 2 button stays a Shelly or ESP32 button that calls the box.
- **Tested on the venue's C200 (2026-11-17):**
  - `stream1` is H.264 1280×720 at about 30 fps (720p was the camera's quality setting at the
    time). Audio is G.711 A-law, 8 kHz mono.
  - Recording, cutting and watermarking all work.
  - Segments split only on keyframes, so their lengths vary (1.7–6.1 s).
  - When the camera connects it sends a burst of buffered video, so file-creation times run
    ahead of the content. The recorder therefore times segments by real receive time, not by
    file name.
  - The camera burns its own date/time stamp (top-left) and "tapo" logo (bottom-left) into the
    picture, so our watermark goes bottom-right.
- **One RTSP client at a time (tested 2026-11-17).** With one connection streaming, a second and
  a third were refused with a 4xx. So the recorder box takes the camera's only RTSP slot, and no
  NVR or other RTSP viewer can pull it at the same time. Phase 5 live streaming goes out over the
  recorder's own connection: a second `tee` output with `onfail=ignore`, so a failing stream
  never stops recording.

### Data model (one new migration per table group; `schema.sql` stays untouched)

All tables follow [schema conventions](../../../.claude/skills/backend-conventions/references/schema-conventions.md):
surrogate `id`, a varchar business ID from `SELECT UUID()`, Manila `dateCreated`/`dateUpdated`,
soft delete through `status`, and FKs on business IDs.

| Table | Key columns |
| --- | --- |
| `venues` | `venueId`, `name`, `address`, `phone VARCHAR(20) NULL`, `logoUrl` (watermark, upload path), `clipPrice DECIMAL(10,2) DEFAULT 0` (0 = free), `sessionPricePerHour DECIMAL(10,2) DEFAULT 0`, `clipRetentionDays INT DEFAULT 30`, `status ENUM('Active','Inactive','Deleted')` |
| `courts` | `courtId`, `venueId` FK, `name`, `cameraRtspUrl` (encrypted at rest), `qrToken VARCHAR(32) UNIQUE` (public, rotatable), `buttonCode VARCHAR(32) NULL UNIQUE`, `streamEnabled TINYINT`, `streamRtmpUrl` (encrypted), `status` |
| `devices` | `deviceId`, `venueId` FK, `name`, `tokenHash CHAR(64)`, `lastSeenAt DATETIME NULL`, `agentVersion`, `status ENUM('Active','Revoked','Deleted')` |
| `clips` | `clipId`, `courtId` FK, `venueId` FK, `sessionId NULL` FK, `source ENUM('QR','BUTTON','SESSION','STAFF')`, `requestedAt`, `durationSeconds`, `shareToken VARCHAR(32) UNIQUE`, `videoPath NULL`, `thumbnailPath NULL`, `sizeBytes NULL`, `price DECIMAL(10,2)`, `paymentStatus ENUM('Free','Unpaid','Paid')`, `status ENUM('Pending','Processing','Ready','Failed','Expired','Deleted')`, `failureReason NULL`, `expiresAt` |
| `recording_sessions` | `sessionId`, `courtId` FK, `startAt`, `endAt`, `bookedBy` (name, optional `phone`), `createdByAccountId` (staff), `status ENUM('Scheduled','Recording','Processing','Ready','Failed','Cancelled')` |
| `payments` | `paymentId`, `clipId` FK, `amount`, `provider ENUM('PAYMONGO')`, `providerRef UNIQUE`, `method` (gcash/maya/card), `status ENUM('Pending','Paid','Failed','Expired','Refunded')`, `paidAt NULL`, `rawEvent JSON NULL` |

Indexes go on every FK, on `clips(status, expiresAt)` for the expiry sweep, and on
`clips(courtId, requestedAt)` for de-duplication.

### API

**Admin** (`/api/v1/admin/*`, `requireAuth` + `auditTrail`, one permission per group):

| Group | Endpoints | Permission (`module` / `submodule`) |
| --- | --- | --- |
| `/venues` | list, get, create, update, delete | `venues` / `list` |
| `/courts` | list (`?venueId`), get, create, update, delete, `POST /:courtId/rotate-qr` | `venues` / `courts` |
| `/devices` | list, get, create (returns the plaintext token **once**), update, revoke | `venues` / `devices` |
| `/clips` | list (filters: venue, court, source, status, date), get (signed video link), `POST` staff save, delete | `clips` / `null` |
| `/sessions` | list, create (schedule), cancel | `clips` / `null` |
| `/payments` | list, get | `payments` / `null` |
| `/dashboard` | add cards: clips today, revenue today, devices offline | existing `dashboard` |

**Public** (`/api/v1/public/*`, no login, `rateLimiter` per IP + per court):

| Endpoint | What |
| --- | --- |
| `GET /courts/:qrToken` | Court and venue name, logo, price, and whether the box is online |
| `POST /courts/:qrToken/clips` | Saves the last 60s and returns `shareToken`. **Cooldown:** a request within 20s of the previous one on the same court returns that clip instead of making a new one. |
| `GET /clips/:shareToken` | Status, plus thumbnail and video **signed links** when `Ready` and (`Free` or `Paid`) |
| `POST /clips/:shareToken/checkout` | Creates a PayMongo checkout (GCash, Maya, card) and returns its redirect URL |
| `POST /payments/webhook` | PayMongo webhook. Verifies the signature, marks the payment and clip `Paid`, and is idempotent on `providerRef`. |

**Device** (`/api/v1/device/*`, `Authorization: Device <token>` checked against
`devices.tokenHash`; a revoked or deleted device gets 401):

`POST /heartbeat`, `GET /config`, `GET /jobs` (long-poll ≤ 25s), `POST /buttons/:buttonCode/press`,
`POST /clips/:clipId/processing`, `POST /clips/:clipId/upload` (multipart video + thumbnail),
`POST /clips/:clipId/fail`, `POST /sessions/:sessionId/state`. A device can only touch courts,
clips and sessions of its own `venueId`. Each of these gets a cross-venue isolation test.

**Clip files:** saved under `public/uploads/admin/clips/{venueId}/{clipId}/` (`uploadFolderId()`
on both IDs) and returned only through `signUploadUrl()`. Video playback needs HTTP `Range`
support on the signed-upload static handler, so check it. A daily job marks clips past
`expiresAt` as `Expired` and removes their files. That is a soft delete of the row, and only the
file is removed, so the disk doesn't fill up.

### Frontend

**Admin portal** (Modern list page + Sheet drawer per [`new-module`](../../../.claude/skills/new-module/SKILL.md)):

- **Venues:** list and drawer, with logo upload (used as the watermark), clip price, session price
  per hour, retention days and phone.
- **Courts:** list filtered by venue, and a drawer with name, camera RTSP URL, button code and
  stream settings. A **"Print QR"** action renders a printable A5 sign with the court name, the
  QR (to `/{origin}/court/{qrToken}`) and short instructions.
- **Devices:** list with online/offline status from `lastSeenAt` and the agent version. "Add
  device" shows the token once, with copy-to-clipboard, and devices can be revoked.
- **Clips:** list with a thumbnail column and a preview player in a sheet. Filters are venue,
  court, source, status and date. Staff can "Save clip now" for a court, copy the share link, and
  delete a clip.
- **Sessions:** schedule a full-session recording (court, start, end, player name, optional phone)
  and cancel one.
- **Payments:** read-only list.
- **Dashboard:** new stat cards.

**Public pages** (no login, mobile-first, same design tokens):

- `/court/:qrToken`: venue logo and court name, a big **"Save last 60 seconds"** button, the price
  if it isn't free, and a notice that recording is in progress (privacy).
- `/clip/:shareToken`: polls while `Pending`/`Processing`, then shows the player, Download, and
  Share (Web Share API, falling back to copy link). If unpaid it shows the thumbnail and a
  **Pay with GCash / Maya / Card** button.
- `/live/:courtId` is optional. In v1 the stream lives on YouTube/Facebook, so the court page just
  links to it.

### Delivery phases

The checklist follows these phases. Each phase is shippable on its own.

0. **Repo consolidation + cleanup:** merge `app/`'s docs, skills and `CLAUDE.md` into the root,
   strip the template leftovers, and connect `app/` to this API's auth.
1. **Foundation + QR clips + watermark:** venues, courts, devices, the recorder box ring buffer,
   the QR flow, clip processing and upload, the share page, and expiry.
2. **Physical button + staff save.**
3. **Full-session recording.**
4. **Paid clips** (PayMongo).
5. **Live streaming** (RTMP restream).
6. **Staff mobile app screens.** They can start right after Phase 1's admin endpoints land and run
   alongside Phases 2–5.

### Alternatives considered

- **Cloud-only recording (cameras stream straight to the server):** this needs constant
  high-bitrate upload from every court (about 4–8 Mbps each). Many PH venue connections can't
  sustain that, and you pay to ingest video nobody saves. The edge box uploads only saved clips.
- **Phone or tablet as the camera:** cheaper, but phones overheat, get moved and stop recording.
  It was rejected for a paid service.
- **Self-hosted live streaming (MediaMTX + HLS):** this gives full control over the player and
  overlays, but adds a media server to run and pay bandwidth for. Restreaming to YouTube or
  Facebook is free and already where players share. It can be revisited later.
- **Player accounts:** the user ruled these out for v1. Share links keep the flow down to "scan →
  tap → get clip".
- **Cloud object storage (S3 / R2) for clips:** the right long-term home. v1 keeps the existing
  private-uploads convention and signed links, and the move is listed as an open question.

## Affected areas

| Area | Files / tables | Change |
| --- | --- | --- |
| Database | `back/database/migrations/001_create_venues_courts.sql` … `00N_*.sql` | New tables above + permission rows (never `schema.sql`) |
| Seed | [`back/scripts/setup-database.js`](../../../back/scripts/setup-database.js) | New permissions in the seed array |
| API (admin) | `back/server/src/controllers/v1/admin/{venues,courts,devices,clips,sessions,payments}.controller.js`, [`routes/v1/admin/index.js`](../../../back/server/src/routes/v1/admin/index.js) | New CRUD groups |
| API (public) | `back/server/src/routes/v1/public/index.js`, `controllers/v1/public/*.controller.js` | New route family, mounted in [`routes/route.js`](../../../back/server/src/routes/route.js) |
| API (device) | `back/server/src/middlewares/deviceAuth.middleware.js`, `routes/v1/device/index.js`, `controllers/v1/device/*.controller.js` | New auth + route family |
| Validators | `back/server/src/validators/{venues,courts,devices,clips,sessions,payments,public,device}.validator.js` | Zod schemas using `_helpers.js` |
| Uploads | [`utils/file/uploads.js`](../../../back/server/src/utils/file/uploads.js), [`signedUpload.middleware.js`](../../../back/server/src/middlewares/signedUpload.middleware.js) | `clips/` folder, large video limit, Range support |
| Payments | `back/server/src/lib/paymongo/` | Checkout + webhook signature check |
| Jobs | `back/server/src/jobs/expireClips.js` | Daily expiry sweep |
| Edge app | `edge/` (new) | Recorder box agent, ffmpeg wrappers, button listener, `edge/CLAUDE.md` + README |
| UI (admin) | `front/src/pages/Admin/{Venues,Courts,Devices,Clips,Sessions,Payments}/`, [`AdminRoute.jsx`](../../../front/src/routes/pageRoutes/AdminRoute.jsx), Dashboard | New modules + sidebar |
| UI (public) | `front/src/pages/Public/{Court,Clip}/`, [`routes/index.jsx`](../../../front/src/routes/index.jsx), `front/src/services/api/public/*` | New no-login pages |
| Permissions | `venues`/`list`, `venues`/`courts`, `venues`/`devices`, `clips`/`null`, `payments`/`null` | New rows, granted to Owner |
| Env | `back/.env.example` | `CLIP_MAX_UPLOAD_MB`, `DEVICE_SECRET_KEY` (encrypts RTSP/RTMP URLs), `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET`, `PUBLIC_APP_URL` |
| Repo docs | Root `CLAUDE.md`, `README.md`, `app/CLAUDE.md`, `app/README.md`, `app/docs/` (removed) | Phase 0 merge: one CLAUDE.md, `app/` + `edge/` in the layout, Dyna Cam overview, tenancy paragraph corrected |
| Skills | `.claude/skills/*`, `app/.claude/` (removed) | `mobile-conventions` + `new-mobile-module` moved in; workflow skills cover all four parts; `publish` bumps `app/` too; `edge-conventions` added |
| Mobile app | `app/app.json`, `app/package.json`, `app/.env.example`, `app/eas.json`, `app/src/Screens/*`, `app/src/services/*`, `app/src/constants/navigations.js` | Rebrand, template cleanup, auth matched to the API, staff screens |
| Scripts | [`run.sh`](../../../run.sh), [`run-mac.sh`](../../../run-mac.sh), [`.gitignore`](../../../.gitignore) | Optional `app` target; ignore `.DS_Store` |

## Out of scope

- Player accounts, clip history and player profiles.
- AI features: auto-highlight detection, ball tracking, line calls, stats.
- Score overlay or scoreboard.
- Court booking and scheduling beyond the recording sessions above.
- Self-hosted live streaming and watermarking the live stream.
- Company/branch multi-tenancy and a SuperAdmin portal (see Open questions).
- A **player** mobile app. The player flow is a mobile web page, and `app/` is for staff only.
- Offline mode (SQLite) in the staff app.
- App store publishing (EAS builds are set up, but store listings aren't part of this plan).

## Risks

- **Venue internet is slow or drops:** clips queue on the box and upload with retry. The public
  page says "processing" and the share link keeps working when the upload lands. Clips are capped
  at 1080p, about 8 Mbps.
- **Wi-Fi cameras (Tapo C200) drop out:** a lost stream leaves a gap in the ring buffer, and a
  clip saved during the gap fails with a clear reason. The recorder reconnects with backoff and
  the Admin portal shows each camera's state. Mitigations: DHCP reservation, a strong 2.4 GHz
  signal at the court, and wired models for venues where drop-outs persist.
- **Recorder box CPU when several courts save at once:** recording stream-copies (no re-encode).
  Only clip jobs encode, through a per-box queue with hardware encoding. Size the box to the court
  count and load-test with 6 courts.
- **Abuse of the public save endpoint** (someone with a photo of the QR spams saves): per-court
  cooldown with merge, per-IP rate limit, and a "Rotate QR" admin action.
- **Disk growth on the API server:** retention days per venue, the expiry sweep, and a disk-usage
  card. Move to object storage before scaling (Open question).
- **Camera credentials leak:** RTSP and RTMP URLs are encrypted at rest with `DEVICE_SECRET_KEY`,
  never returned in list endpoints, and sent only to the venue's own authenticated device.
- **Privacy (Data Privacy Act of 2012, RA 10173):** players are recorded constantly. The venue
  posts signage, the court page shows a notice, the ring buffer is overwritten every ~3 minutes,
  and saved clips expire. A privacy notice text is needed (Open question).
- **Payment webhook spoofing or replay:** verify the PayMongo signature, process idempotently on
  `providerRef`, and never mark a clip paid from the browser redirect alone.
- **Losing conventions in the Phase 0 merge:** move files with `git mv` so history follows them.
  Diff each app workflow skill against its root twin before deleting it, and grep for dead
  `docs/…` links afterwards.
- **Skills drift between `front/` and `app/`:** both claim the "Modern" design system. Keep the
  token values in one place in the docs (`mobile-conventions` points to the web tokens as the
  source) and record the known duplication (`global.css` ↔ `lib/theme.js`).
- **Clock drift between box and server:** NTP on the box. Button presses are timestamped on the
  box; QR requests by the server, with a +5s tail.

## Open questions

- [ ] **Who operates Dyna Cam?** Is it one operator running all venues (fits today's single
  Admin portal), or a SaaS where each venue owner logs in and sees only their venues (needs
  venue-scoped staff accounts or the company/branch tenancy described in `CLAUDE.md`)?
- [ ] **Paid-clip model:** pay to unlock each clip, pay per session, or a prepaid court pass?
  Does an unpaid clip show a short watermarked preview or only a thumbnail?
- [ ] **Clip length:** fixed 60s, or let the player pick 30/60/90s?
- [ ] **Hardware:** the cameras are Tapo C200 for now (2026-11-17). Still open: should larger or
  outdoor venues standardise on a wired Tapo model? Which recorder box, and which button (Shelly,
  ESP32 or other; not the Tapo S200B)? Who installs and supports it?
- [ ] **PayMongo account:** is there a merchant account, and is it per venue or one for Dyna
  Cam, with payouts to venues handled offline?
- [ ] **Storage:** keep clips on the API server's disk in v1, or go straight to S3 or
  Cloudflare R2?
- [ ] **Live streaming:** YouTube, Facebook, or both? Who owns the stream keys, the venue or Dyna
  Cam?
- [ ] **Privacy notice** wording and signage, and a default retention period (30 days proposed).
- [x] **Branding:** yes. The landing page is replaced in Phase 0 (the component gallery moves to
  `/components`). The app is named "Dyna Cam" with ID `com.dgsi.dynacam` (2026-11-17). App icons
  are still placeholder art.
- [ ] **Staff app scope:** is staff-only right, or should `app/` also be a player app later?
- [x] **One version or two:** one shared product version. `app/` was aligned to 1.0.0 on
  2026-11-17, and `/publish` bumps all three.

## Revisions

- 2026-11-17: Created. Trigger, camera, delivery and extras decisions taken with the user.
- 2026-11-17: Added Phase 0 (merge `app/` docs, skills and `CLAUDE.md` into the root; template
  cleanup) and the staff mobile app (`app/`), at the user's request.
- 2026-11-17: Phase 0 built on branch `plan/PLAN-001-court-replay-cameras`.
  - Scope added: the app's change-password screen (needed for the forced-change hold), CSRF and
    `Idempotency-Key` handling in the app's axios layer, an opt-in `app` target in the run
    scripts, and moving the component gallery to `/components` instead of deleting it.
  - `mobile-conventions` gained a 7th reference, `project-structure.md`, taken from the old app
    README.
  - Still open: a device sign-in test, and `expo-doctor`'s pre-existing "11 packages out of date"
    failure.
- 2026-11-17: Phase 1 API built. Changes from the design above:
  - Columns arrive with the phase that uses them. `venues.clipPrice`/`sessionPricePerHour` and
    `clips.price`/`paymentStatus` come in Phase 4, `courts.buttonCode` in Phase 2, `courts.stream*`
    in Phase 5, and `clips.sessionId` in Phase 3, each as its own migration.
  - Public links reuse `APP_URL` instead of a new `PUBLIC_APP_URL`.
  - The expiry job (`jobs/clipMaintenance.js`) runs hourly and also fails clips still pending
    after 15 min.
  - Saving a clip while the venue's box is offline returns 503 `CAMERA_OFFLINE`, rather than
    queueing a clip that can never be cut.
  - Admins can re-issue a box token (`POST /devices/:id/token`).
  - Fixed `setup-database.js` permission seeding. It skipped the whole base set whenever the table
    was non-empty, which a migration's permission row would have caused on every fresh
    install.
- 2026-11-17: Added Tapo camera support, at the user's request. The venue's cameras are Tapo
  C200 (Wi-Fi). New: the [Camera: TP-Link Tapo](#camera-tp-link-tapo) section, a Tapo helper in
  the court form, audio transcoded to AAC in the recorder (found by testing), Wi-Fi drop-out
  handling, a Tapo setup guide, and a check against a real C200. The Tapo S200B button was ruled
  out for Phase 2.
- 2026-11-17: Tested the venue's real C200 (720p, H.264 + A-law audio). The full recording and
  watermarked-clip pipeline worked. Found that segment timing is irregular, so the recorder must
  time segments by real receive time; added a checklist item for it.
- 2026-11-17: Phase 1 finished and run end to end on the real C200 (throwaway database). Changes
  made along the way:
  - **Recorder timing:** `-use_wallclock_as_timestamps` halved the frame count in cut clips. The
    recorder now times each segment from `segments.csv` plus the closed file's mtime, and trims
    with output-side `-ss`/`-t`.
  - **Real frame rate:** the C200 really sends 15 fps (its stated ~30 is nominal).
  - **Security fix:** the one-time recorder-box token was being stored in the idempotency cache.
    Added `noIdempotencyCache(res)`, with a test that fails without it.
  - **Exclusive claims:** only one box can make a given clip, so two boxes at one venue can't
    both cut it.
  - **Picker options:** added a per-page options endpoint so the venue and court pickers don't
    need the Venues permission.
  - **New fields:** courts now carry `venueLogoUrl`, devices `lastSeenSecondsAgo`, and clips
    `downloadUrl`, which serves the file as a `Content-Disposition` attachment.
  - **Ignore-rule fixes:** `back/.gitignore` and `back/eslint.config.js` ignored every folder
    named `public`. That kept `controllers/v1/public/` out of git (the Phase 1 API commit missed
    `public.controller.js`) and out of lint. Both now ignore only the top-level `public/` folder.
  - **Deferred to later phases:**
    - The API's 120 s server timeout against slow uplinks; clips are about 6–13 MB, so low risk
      for now.
    - No `Retry-After` header on 429 responses.
    - The heartbeat has no field for box-level problems (disk, clock).
    - The 6-court load test, which needs the box hardware.
- 2026-11-17: Phase 2 done and committed. Tested on the real C200: QR, button (pressed through
  the box's LAN listener) and staff saves each gave a 65 s clip in about 9 s.
- 2026-11-17: Phase 3 design changed. A session is no longer one big file. It is delivered as
  **5-minute parts**, each an ordinary clip with an explicit time window. Why: on the real camera,
  one hour is 0.7–1.3 GB, which is over the upload limit and the server's 120 s request timeout,
  and the box's buffer is only about 3 minutes. With parts:
  - The box keeps the booked window's segments.
  - Each part is cut when it's due and uploads at about 40–50 MB (bitrate capped).
  - Parts reuse the clip pipeline and expiry.
  - Parts are created when a box polls, so no scheduler is needed.
  - The player gets one session link listing every part.
  - Sessions can also be ended early.
- 2026-11-17: Phase 3 done and committed. Tested on the real C200: a session ended early gave
  one 126 s part, ready in 10 s.
- 2026-11-17: **Phase 4 changed to cash only**, at the user's request. PayMongo is deferred.
  - **How it works:** a venue sets a clip price. A priced player clip shows only its thumbnail
    and a 6-character pay code until staff record the cash in Admin → Payments. Staff saves and
    session parts are free. Refunding a payment locks the clip again.
  - **PayMongo notes, for later:** create a checkout with `POST /v2/checkout_sessions` (secret
    key as Basic auth; `data.attributes.line_items`, `payment_method_types`, `success_url`,
    `cancel_url`, `reference_number`). The pay link is `data.attributes.checkout_url`, and
    PayMongo sends the `checkout_session.payment.paid` webhook.
  - **Webhook check, for later:** the `Paymongo-Signature` header is
    `t=…,te=…,li=…`. The signature is HMAC-SHA256 with the webhook secret over `{t}.{raw body}`,
    compared with `te` in test mode or `li` in live mode.
  - **Adding it later:** a new migration adds a provider to `payments.method`.
- 2026-11-17: Phase 4 done and committed (cash only).
- 2026-11-17: Phase 5 done. Tested on the real C200 against a local RTMP receiver; YouTube and
  Facebook aren't tested yet (they need the venue's key).
  - **No watermark in v1:** the stream is the camera's own picture.
  - **Audio:** the stream's audio is the camera's 8 kHz G.711, resampled to 44.1 kHz AAC.
  - **Bitrate:** a 720p C200 runs about 1–2 Mbps, so YouTube may warn about low bitrate.
- 2026-11-17: Phase 6 built: the staff app with Courts, Clips, Sessions, Take payment, Recorder
  boxes and a Dashboard. It bundles; not yet tried on a device.
  - **Scan court QR:** not built. It needs `expo-camera` (a new dev build) and an admin lookup of
    a court by its QR token.
  - **Video:** plays in the phone's own player, because there's no `expo-video` yet.
- 2026-11-19: Closed as **Done** by owner decision. The items still open were ticked without being
  run: the device sign-in, the staff app's QR scan and the phone test (the staff app was replaced
  by PLAN-002's session device), the 6-court load test (CR-008's box health report covers CPU,
  memory and disk on the real box), `expo-doctor`'s 11 out-of-date packages, and the C200 1080p
  install note (a venue setting). Follow-ups: CR-008 (venue health and alerts), CR-009 (remote box
  updates), CR-010 (clip and video storage).
