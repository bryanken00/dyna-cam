# PLAN-005 · Videos stay on the venue box and go straight to Google Drive — Checklist

> Tick items as they land. Plan: [plan.md](plan.md)

## Phase 1 — API (old boxes keep working)

- [x] Migration `036_videos_on_box_and_drive.sql`: `session_videos.delivery`, `driveSessionUrl`,
      `driveSessionAt`, `boxKeepUntil`, `boxDeletedAt` (progress reuses `receivedBytes`)
- [x] `utils/googleDrive.js`: `openResumableSession(token, { name, parentId, sizeBytes })` and
      `getFile(token, fileId)` (size, parents)
- [x] Heartbeat: store the box's capabilities; game jobs carry `delivery: "drive"` for a
      `drive-direct` box (old boxes: unchanged)
- [x] `POST /device/game-videos/:id/drive-session` (venue-scoped, court Drive checks, encrypted
      session URI, 409 `NO_DRIVE` / `DRIVE_RECONNECT`)
- [x] `POST /device/game-videos/:id/progress` (rate-limited) and `POST …/drive-done` (read back from
      Drive, share by link, store link, queue the email)
- [x] `/config`: each kept video's `keepUntil`; keep listing a game until it's on Drive and past keep
- [x] Admin retry re-opens a Drive session for `Drive` videos
- [x] Shapes: `toPublicVideo` / captures / app / admin return Drive state, progress and link — no
      file links for `Drive` videos
- [x] Tests (`back/tests/drive-direct.test.js`, fake Google moved to `tests/helpers/fakeGoogle.js`):
      another venue's box → 404; no Drive → kept on the box, connecting Drive re-sends; a size or
      folder mismatch on drive-done → refused; progress; config keep list; old-box path unchanged;
      Admin retry; box-deleted; Drive keeps 7 days then trashed on expiry; a Deleted video → 404
- [x] Drive jobs keep off box-sent videos (`driveUploads.js`), and `driveCleanup.js` / the email's
      "download before" use the keep time for them, not 2 days
- [x] `POST /device/game-videos/:id/box-deleted` (the box removed its copy)

## Phase 2 — Recorder box

- [x] `edge/src/drive.js`: resumable PUT to the session URI in chunks; ask Google what it has
      (`Content-Range: bytes */size`) to resume; a new session when the old one has expired
      (Google's PUTs in `api.js`, no Authorization header, `upload_id` masked in logs)
- [x] `jobs.js`: `delivery: "drive"` → make the file, keep it, open the session, upload, report
      progress and done; persisted across restarts; backoff on 409 / offline
- [x] Local keep (`edge/src/videos.js`, `DATA_DIR/videos/`): Drive deliveries are kept, not
      dropped; removed after `keepUntil` or when a fresh `/config` no longer lists them, oldest
      on Drive first under `DISK_CRITICAL_MB`; removals reported (`box-deleted`)
- [x] Heartbeat `capabilities` adds `"drive-direct"`; `health.js` reports the local video store size
      (`localVideos`, `localVideoMb`; API validator and dashboard pass them through)
- [x] `npm run lint && npm test && npm run smoke`; a fake Drive server in tests
      (`test/drive.test.js`) and a Drive stand-in in the smoke run

## Phase 3 — Web and app

- [x] Game page: Drive video cards for whole videos and saves (`components/DriveVideo.jsx`):
      "Saving… sending to Google Drive N%", **Open in Google Drive** (+ QR on wide screens),
      "not on Google Drive yet — ask the front desk"; keep-time text. Videos the server already
      holds keep their player until they age out (removed in Phase 4)
- [x] Admin Sessions detail: where the video is (being made on the box, to Google Drive N%, on
      Google Drive, only on the venue box until …, removed from the box) and its link; **Send to
      Drive** for a box-only video; no player for Drive videos. "Re-upload to Drive" sends
      box-kept videos from the box (API fix + test)
- [x] Court setup: Drive-not-connected warning ("players get no video from this court"), keep
      time and storage note (~35 GB a week per camera)
- [x] Dashboard box health: videos kept on the box (`system.localVideos` / `localVideoMb`)
- [x] App: a save on Drive shows its link as a QR (`CapturePreviewSheet`), "Not on Drive" when
      kept at the venue; texts
- [x] `cd front && npm run lint && npm run build`; `cd app && npx expo-doctor@latest && npx expo export --platform android --clear`
      (expo-doctor's one failed check, "11 packages out of date", was there before)

## Phase 4 — Switch-over (deploy after every box reports `drive-direct`, and 7 days later)

- [x] Turn off the old upload: `/device/game-videos/:id/{start,chunk,finish}` answer 410
      `BOX_UPDATE_REQUIRED`; game jobs only to a `drive-direct` box (an older box's games wait for
      it); no clip jobs; device clip `/processing`, `/upload`, `/fail` removed
- [x] "Recorder box needs updating" problem (`BOX_OUTDATED`, migration 038) for a box without
      `drive-direct` — Dashboard, Discord, email
- [x] Remove server video serving: no `videoUrl` / `downloadUrl` / `thumbnailUrl` in any reply
      (game page, saves, app, Admin sessions, legacy clip page, Admin clips, payments); the game
      page's `parts`; `jobs/driveUploads.js` and `googleDrive.uploadFile` (Drive emails and clean-up
      now run from `jobs/driveJobs.js`); "Re-upload to Drive" only re-sends from the box;
      migration 037 marks server videos still waiting for the API's Drive upload Skipped
- [x] Web: game page, Admin sessions, legacy clip page and Take payment without players,
      downloads, thumbnails or `PartCard`; app: a save is only its Drive QR (no player)
- [x] Docs: runbook (videos at the venue and on Drive, sizing, the roll-out order), `edge/README.md`,
      `CLAUDE.md`, `back/CLAUDE.md`, the edge and backend skills
- [x] Backend tests rewritten for the new paths (old upload → 410, no jobs for an old box, no file
      links, Drive clean-up and emails through the box flow)

## Wrap-up

- [x] `cd back && npm run lint && npm test` passes (462 tests)
- [x] `cd front && npm run lint && npm run build` passes
- [x] `cd edge && npm run lint && npm test && npm run smoke` passes (305 tests; smoke with the Drive stand-in)
- [x] `cd app && npx expo-doctor@latest && npx expo export --platform android --clear` passes (expo-doctor's "11 packages out of date" was there before)
- [x] Migrations 036–038 applied on the dev database; pending for deploy (runbook §12 order)
- [ ] Tried end to end with a real box: game → kept on the box → on Drive → link on the game page
      and in the email; internet cut mid-upload resumes
- [ ] Changelog entry added in `docs/changelog/unpublished/` (`ref: PLAN-005` / CR-040)
- [ ] `plan.md` status set to `Done`
