# CR-003 · Whole-game video, one per camera — Checklist

> Request: [request.md](request.md)
> Built with the recommended answers (server joins parts · separate Cam 1 / Cam 2 · parts "so far"
> while the game is going · part files deleted after joining · replays unchanged).

## Design notes (as built)

- **Per-camera parts only from capable boxes.** A box reports `capabilities:
  ["session-part-camera"]` in its heartbeat. When a game's first part is due, the API fixes
  `recording_sessions.partCameras`: 2 when the court has camera 2 and every box of the venue seen
  in the last 10 min reports it, else 1. Jobs carry `camera` (0 = the box's usual output, 1, 2).
- **Joining** (`jobs/sessionJoin.js`, every 20 s): a settled game gets a `session_videos` row per
  camera with footage; each is claimed with a lease and joined with `ffmpeg -f concat -c copy
  -movflags +faststart` (a one-part game is copied). Missing parts become named gaps. Part files
  are deleted and the parts marked `joinedAt`. Three failed attempts → Failed (parts kept),
  Admin → Sessions → Try again. Without ffmpeg, multi-part games wait and keep showing parts.
- **Downloads** are named `dyna-cam-game.mp4` / `dyna-cam-game-cam1.mp4` / `-cam2.mp4`.
- **Google Drive** (CR-001) gets "Whole game.mp4" / "Cam N – whole game.mp4" in the game's
  folder; parts are no longer sent one by one.
- **Games recorded before migration 016** are marked `wholeVideo = 'Skipped'` and keep their parts.

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered

## Build

### API (`back/`)

- [x] Migration: `session_videos` (sessionVideoId, sessionId, camera 1|2, status
      Pending/Joining/Ready/Failed/Expired, videoPath, thumbnailPath, sizeBytes, durationSeconds,
      gaps JSON, failureReason, expiresAt, Drive columns, timestamps); `clips.camera` (NULL = stacked /
      single camera); replace `uq_clips_session_part` with (sessionId, partIndex, camera)
- [x] Session parts: one job per camera on a two-camera court, only for boxes whose
      `agentVersion` supports it; older boxes keep getting one stacked job
- [x] Join job (`jobs/sessionJoin.js`): once every part of a camera is settled, `ffmpeg -f concat
      -c copy -movflags +faststart` the Ready parts in order → one file; record gaps; thumbnail from
      the first part; delete part files on success; retries, then Failed with a reason
- [x] Startup check: ffmpeg present (warn and leave parts as they are when missing)
- [x] Public `GET /public/sessions/:shareToken`: `videos[]` per camera (signed video/download/
      thumbnail links, gaps, status) plus `parts` while not yet joined
- [x] Admin sessions: videos per camera, join status, `POST /admin/sessions/:id/videos/:camera/retry`
- [x] Retention: whole videos expire with the venue's retention days, like clips
- [x] Google Drive (CR-001): upload `session_videos` instead of session parts
- [x] Tests: join (ffmpeg present / missing), gaps, per-camera parts, old-box fallback, public
      page shapes, retry 404 for a Deleted/foreign session

### Recorder box (`edge/`)

- [x] Session part jobs carry `camera`: cut that camera only (no stacking); a job without
      `camera` keeps today's stacked behaviour
- [x] Report the new capability in `agentVersion`
- [x] Tests + `npm run smoke` (per-camera part cut)

### Web (`front/`)

- [x] Player game page: one video per camera with Cam 1 / Cam 2 tabs, Download, Share, gaps note,
      "So far" parts while joining, Open in Google Drive
- [x] Admin → Sessions detail: whole video(s) per camera, status, Try again

## Acceptance

- [x] One-camera court: one whole video, one download
- [x] Two-camera court: Cam 1 and Cam 2 tabs, each full size
- [x] A camera drop-out shows as a named missing stretch
- [x] Parts "so far" while the game is going, then the whole video on its own
- [x] Replays unchanged
- [x] Google Drive gets one file per camera
- [x] A 3-hour video plays on a phone without downloading it first

## Wrap-up

- [x] `cd back && npm run lint && npm test` passes
- [x] `cd edge && npm run lint && npm test && npm run smoke` passes
- [x] `cd front && npm run lint && npm run build` passes
- [x] Migration applied, or noted as pending for deploy; ffmpeg on the server noted
- [x] Changelog entry added (`ref: CR-003`)
- [x] Requester shown the result and signed off
- [x] `request.md` status set to `Done`
