# PLAN-005 · Videos stay on the venue box and go straight to Google Drive; the cloud keeps only data

> **Status:** In progress · **Created:** 2026-11-24 · **Owner:** bryanken00 · **Checklist:** [checklist.md](checklist.md)
> **Related:** [CR-040](../../change-requests/CR-040-videos-local-drive-only/request.md) (the request), CR-001 (Drive per court), CR-006 (one file per game), CR-013 / CR-025 (saves), CR-017 / CR-026 (keep times), CR-018 (Drive-link email), CR-029 (save preview), [cloud deployment runbook](../../cloud-deployment-runbook.md)

## Goal

Run the API and database in the cloud while **no video file is ever stored on or sent through the
cloud**: each venue's recorder box keeps its games' videos and uploads them straight to the
court's Google Drive, and players get their game only as a Drive link.

## Context

Today the cloud API's disk is the only lasting copy of a game:

- The box joins a camera's footage into `game.mp4` ([edge/src/game.js](../../../edge/src/game.js)
  `makeGameFile`) and uploads it in 8 MB chunks to `/device/game-videos/:id/{start,chunk,finish}`
  ([game-videos.controller.js](../../../back/server/src/controllers/v1/device/game-videos.controller.js)),
  then deletes its own copy (`drop()`, [edge/src/jobs.js](../../../edge/src/jobs.js)).
- The API stores it under `back/public/uploads/admin/clips/…` (`utils/file/clipFiles.js`) and
  serves it through signed links (`utils/sessionVideos.js` `toPublicVideo`) to the game page, the
  app and the Admin.
- Google Drive is an *extra* copy made by the API from its own file
  ([jobs/driveUploads.js](../../../back/server/src/jobs/driveUploads.js),
  [utils/googleDrive.js](../../../back/server/src/utils/googleDrive.js) `uploadFile`), trashed after
  2 days ([jobs/driveCleanup.js](../../../back/server/src/jobs/driveCleanup.js),
  `utils/driveKeep.js`).
- Saves ("Save the last …") are `session_videos` rows with a `captureId` and travel the same way.
- Live view and the CR-029 save preview already stream from the box over the venue Wi-Fi
  (`utils/sessionDevices.js` `liveLink` / `replayLink`, [edge/src/live.js](../../../edge/src/live.js));
  they never touch the API's disk.

Two constraints shape the design:

1. The court's Google sign-in uses the `drive.file` scope: the app sees only files **its own OAuth
   client** created. The client secret and the encrypted refresh token (`courts.driveRefreshToken`,
   `DEVICE_SECRET_KEY`) live only in the cloud and must stay there.
2. Boxes are updated venue by venue, so the API must keep serving old boxes until every box has
   the new version.

## Approach

### The upload: the cloud opens it, the box sends the bytes to Google

Google Drive's **resumable upload** works in two steps:

1. Open a session: one call with the file's name, folder and size, made with the court's token.
2. Send the bytes in chunks to the session URI Google returns. The URI alone is the credential,
   so no token is needed for this part; it's valid about a week and can be resumed.

The cloud does step 1 and the box does step 2, so:

- **file bytes never pass through the cloud**;
- **no Google secret or token goes to a venue**;
- the file is created by our OAuth client, so `drive.file` still sees it for sharing and clean-up.

### New box API (behind the box's `Device` token, scoped to its venue)

| Route | Does |
| --- | --- |
| `POST /device/game-videos/:id/drive-session` `{ sizeBytes }` | Checks the court's Drive is connected and healthy. Makes the court and game folders if missing (as today). Opens a Drive resumable session with the file name (as today: "Cam 1 – whole game.mp4", "Save 8m00s–10m00s – Cam 1.mp4"). Stores the session URI encrypted (`secretBox`) and returns `{ uploadUrl, chunkBytes }`. Returns 409 `NO_DRIVE` / `DRIVE_RECONNECT` when the court has no usable Drive: the box keeps the file and tries again later. |
| `POST /device/game-videos/:id/progress` `{ uploadedBytes }` | Upload progress for the game page and Admin (rate-limited). |
| `POST /device/game-videos/:id/drive-done` `{ driveFileId }` | The API reads the file back from Drive with the court's token (size, parent folder: never trusted from the box), shares it "anyone with the link", and stores `driveFileId`, `driveUrl` and `driveUploadedAt`. The Drive-link email follows as today (`jobs/driveEmails.js`). |
| `POST /device/game-videos/:id/fail` | Unchanged: the box can't make the file at all. |

### What the box keeps, and the sync

- **Capability negotiation:** the heartbeat already sends `capabilities` (`["game-file"]` today).
  A new box adds `"drive-direct"`.
  - For a box with it, a game job says `delivery: "drive"`; for an old box, the old upload to the
    API continues unchanged.
  - Once every active box reports `drive-direct`, the old path is switched off (Phase 4).
- **Local keep:** the box keeps each finished `game.mp4` in its work folder until the venue's keep
  time from `/config` (`keepUntil` per video), whether or not it's on Drive yet. It deletes:
  - after `keepUntil`;
  - earlier only under the existing `DISK_CRITICAL_MB` rule, oldest already-on-Drive first.

  It reports each deletion, so the Admin can say "removed from the venue box".
- **Sync:**
  - The box already checks in every 15–60 s (`/config`, heartbeat, job long-poll) and keeps a
    persisted queue (`queue.json`).
  - Drive uploads join that queue. They resume after a restart or an outage: the box asks Google
    which bytes it already has, or opens a new session when the old one has expired.
  - `/config` keeps listing a game's videos until they're on Drive **and** past `keepUntil`, so
    the box never drops footage the cloud still expects.
- **Retry from Admin** (`POST /admin/sessions/:id/videos/:camera/retry`) re-opens a Drive session.
  The box re-sends from its own copy while it still has it.

### What players and staff see

- **Player's game page** (`front/src/pages/Public/Session`):
  - Each whole-game video and each save becomes a card with its state: "Saving at the venue",
    "Uploading to Google Drive 45%", **Open in Google Drive** (link + QR), or "Not shared — this
    court has no Google Drive".
  - No `<video>` and no download from our server.
  - Live view and the save preview keep coming from the box on the venue Wi-Fi (open question).
- **Admin → Sessions detail:** video rows show where the video is (on the venue box until …,
  on Drive) and its Drive link. No player.
- **Court's device app:** the end screen's QR (game page) is unchanged; a save's preview player is
  replaced by its Drive link / QR.
- **Court setup:** "Google Drive not connected" warns that players won't get videos for this court.

### The cloud stops holding files (Phase 4, once every box is updated)

Remove:

- the old `/device/game-videos/:id/{start,chunk,finish}` upload and the device clip upload;
- `toPublicVideo`'s signed video and thumbnail links;
- `jobs/driveUploads.js`'s upload-from-disk path;
- `clipMaintenance.js`'s file deletion;
- the legacy clip and part players (`/clip/:shareToken`, game-page `parts`).

`driveCleanup.js` stays: it trashes Drive copies after the Drive keep time, using the court's
token. Existing files on the server age out under the current 7-day rule.

### Data (migration 036)

`session_videos`:

| Column | Holds |
| --- | --- |
| `delivery ENUM('Server','Drive') DEFAULT 'Server'` | Which path the video takes |
| `driveSessionUrl VARCHAR(2048) NULL` | Encrypted session URI |
| `driveSessionAt DATETIME NULL` | When the session was opened |
| `driveUploadedBytes BIGINT NULL` | Upload progress |
| `boxKeepUntil DATETIME NULL` | How long the box keeps its copy |
| `boxDeletedAt DATETIME NULL` | When the box removed its copy |

`videoPath` and `thumbnailPath` stay (old rows) but aren't set for `Drive` videos. No thumbnails
for Drive videos: Drive shows its own.

### Alternatives considered

- **Give the box the court's refresh token:** puts a long-lived Google secret on every venue
  machine. Without the client secret it can't use it anyway, and sharing that secret is worse.
- **Give the box short-lived access tokens:** works, but tokens last an hour, so long uploads need
  refreshes, and the box would be making Drive calls with our credentials. The session URI is
  narrower: one file, write-only.
- **Relay through the cloud without storing:** breaks "cloud is database only" in spirit, and
  every byte would cost cloud bandwidth.
- **Players watch from the box (tunnel or LAN):** ruled out by the request ("no internal link").

## Affected areas

| Area | Files / tables | Change |
| --- | --- | --- |
| Database | `back/database/migrations/036_…sql` | `session_videos` delivery / Drive-session / box-keep columns |
| API (box) | `controllers/v1/device/game-videos.controller.js`, `device.controller.js` (`/config`, heartbeat capabilities, game jobs), `validators/device-api.validator.js` | drive-session / progress / drive-done; capability routing; keep list |
| API (Drive) | `utils/googleDrive.js` (open session, read file back), `utils/courtDrive.js`, `jobs/driveUploads.js`, `jobs/driveCleanup.js`, `utils/driveKeep.js`, `jobs/driveEmails.js`, `utils/gameEmails.js` | sessions instead of uploads; keep times |
| API (shapes) | `utils/sessionVideos.js`, `utils/sessionCaptures.js`, `controllers/v1/public/public.controller.js`, `app.controller.js`, `admin/sessions.controller.js` | Drive state + link, no file links |
| Box | `edge/src/jobs.js`, `game.js`, `api.js`, `segments.js`, `config.js`, `health.js`, a new `drive.js` (resumable PUT / resume) | deliver to Drive, keep locally, report |
| Web | `front/src/pages/Public/Session/*`, `pages/Public/Clip`, `pages/Admin/DynaCam/Sessions/components/SessionDetailSheet.jsx`, `GameDriveDialog.jsx`, court setup Drive section | Drive-only video cards; states |
| App | `app/src/Screens/Session/SaveMinutes.js`, `CapturePreviewSheet.js`, `Screens/Ended` | Drive link instead of player |
| Docs | runbook, `edge/README.md`, `CLAUDE.md`, edge/backend skills | the new storage model |

## Out of scope

- Booking, payments, the TV board.
- Live view (unchanged; open question).
- Other cloud storage than Google Drive.
- Showing the court Drive's free space (deferred 2026-11-24; a storage estimate is shown instead).

## Risks

- **Google Drive storage:** a free Google account has **15 GB**. One camera over 10 hours a day is
  about 5 GB/day, so a week's keep is ~35 GB per camera. → Each court's Google account needs paid
  storage (Google One / Workspace), or a short Drive keep time. The court setup page should show
  Drive free space (`about.get`), and alerts should fire when it runs low.
- **Venue upload bandwidth:** ~1.1 Mbit/s per recording camera (runbook §10). → The box queues and
  resumes; the backlog alert already exists (CR-008).
- **Box disk:** ~0.5 GB per camera-hour × keep days. → A 1–2 TB SSD per box; the disk alert
  already exists.
- **Session URI is a bearer credential** (anyone with it can write that one file). → Stored
  encrypted, sent only to the court's own box, valid about a week, one file only.
- **Old boxes during roll-out.** → Capability negotiation; the old path stays until the last box
  is updated.
- **No Drive on a court = no video for players.** → Court setup warns; open question whether to
  block games there.

## Open questions

All answered 2026-11-24 ("go with your proposals"):

- [x] Keep time: box and Drive both keep the venue's keep time (7 days) — `DRIVE_KEEP_DAYS` (2)
      stops applying to `Drive` videos.
- [x] Courts without Drive: no video for players; court setup warns; check-in not blocked.
- [x] Saves: each its own Drive file.
- [x] Live view and save previews on the venue Wi-Fi: kept.
- [x] Existing server-stored videos: age out.
- [x] No staff download for a court without Drive: kept on the box, Retry sends it once Drive is connected.

## Revisions

- 2026-11-24: Created from CR-040.
- 2026-11-24: Approved with the proposed answers; Phase 1 started.
- 2026-11-24: Phase 1 (API) done. Adjustments while building: upload progress reuses
  `receivedBytes` (no `driveUploadedBytes`), so the game page's existing percentage works
  unchanged; a court with no usable Drive gets `{ drive: false, reason }` (not a 409) and the video
  is Ready + `driveStatus = 'Skipped'` ("kept on the venue box"); connecting or reconnecting Drive,
  and Admin retry, put such videos back as jobs for the same box (`utils/boxVideos.js`); added
  `POST …/box-deleted`; folder / file naming moved to `utils/driveFolders.js` (shared with the
  server-side Drive job). Box-sent videos have no thumbnail.
- 2026-11-24: Phase 2 (recorder box) done. The box keeps its copies in `DATA_DIR/videos/`
  (`videos.js`, index `videos.json`) apart from the job folders; a fresh `/config` `keepVideos`
  decides what stays (a video touched after that `/config` was asked for, or with a job, is never
  removed). The box doesn't store the upload address: after a restart it asks the API again, which
  returns the same session. If Google returns the file but `drive-done` doesn't get through, the
  file ID is kept in the queue and no second upload is made. If Google refuses the file (Drive
  full, forbidden), the box reports `/fail` and keeps its copy. API follow-ups: Failed Drive videos
  stay on `keepVideos`, and Admin retry keeps the `deviceId` of a Drive video the box still holds,
  so Retry sends that box's copy.
- 2026-11-24: Phase 3 (web and app) done. Videos the server already holds keep their player and
  Download until they age out, so removing those moves to Phase 4 with server video serving.
  Drive free space on court setup (`about.get`) is deferred; the Drive section shows the keep time
  and a storage estimate instead. Also fixed: the session's "Re-upload to Drive" now sends
  box-kept videos from the box instead of queueing them for the server's Drive job.
- 2026-11-24: Phase 4 (switch-over) built. Adjustments: an old box gets **no game jobs** (rather
  than failing them) so its games wait for the update, and a new "Recorder box needs updating"
  alert (`BOX_OUTDATED`) says so; `clipMaintenance.js` keeps deleting **old** server files on
  expiry (otherwise they would never leave the disk) — it only stopped being the video's home;
  the edge box keeps its old upload code for an older API (unused against this one). Deploy order
  is in the runbook §12: every box updated, then 7 days, then this release.
- 2026-11-24: Fix: `clipMaintenance.js` gave up on any video still uploading 24 h after the game;
  a video the box is already sending to Drive now gets until its `boxKeepUntil` (test added).
  `back/.env.example`: `CLIP_MAX_UPLOAD_MB` and `RATE_LIMIT_DEVICE_UPLOAD_POINTS` removed (nothing
  reads them), `RATE_LIMIT_DEVICE_PROGRESS_POINTS` added, Google Drive marked required.
