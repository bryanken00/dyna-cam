# CR-013 · Save the last few minutes of a game — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Video type: copy like game videos · Price: free (2026-11-19)

## Build

### API (`back/`)

- [x] Migration `020`: `session_captures`; `session_videos.captureId` + unique (session, save, camera)
- [x] `utils/sessionCaptures.js`: make a save (window = now − N … now, inside the game; per camera
      rows), list a game's saves; limits (≥ 1 min played, Recording only, cooldown, max per game)
- [x] `POST /app/session/captures` (paired device); `GET /app/session` lists saves
- [x] `/device/jobs`: a save's window comes from the save, not the game
- [x] Whole-game logic ignores saves: settle, Admin counts, retry, device upload %, game page videos
- [x] Game page (`/public/sessions/:token`) and Admin session detail list saves
- [x] Drive file name for a save
- [x] Tests: window, per camera, limits, box job window, whole game unaffected, page lists, 404s

### Web (`front/`)

- [x] Player's game page: the saves under the whole game (watch, download, saving progress)

### App (`app/`)

- [x] Game screen: "Save the last …" slider (1 min … time played), the stretch it covers, Save — 15-second steps from 1 min (revision)
- [x] The device's saves with progress
- [x] Revision: queue instead of a cooldown ("Queued" / "In queue", double tap = same save), max 5
      saves (`CAPTURE_MAX_PER_GAME`), `DELETE /app/session/captures/:captureId` + delete button with
      a confirm, "Finishing…" at 99%; tests for queue, limit, delete and its 404s
- [x] Revision: preview on the device — picture in the list, tap to play (`CapturePreviewSheet`,
      expo-video, Cam 1 / Cam 2), `mediaUrl()` turns the API's signed links into full addresses

## Acceptance

- [ ] 10 min in, 2 min → a video of 8:00–10:00 (on a device, real box)
- [x] Two cameras → one video each *(API test; real box still to try)*
- [ ] Game page lists, plays and downloads saves
- [x] Whole-game video and game finish unchanged *(API test)*
- [x] Refused before 1 min, after the game, and at 5 saves; queued, not refused, while another is
      made *(API tests)*
- [ ] Delete on a device removes it from the game's page
- [ ] Preview plays a finished save on a device (both cameras on a two-camera court)

## Wrap-up

- [x] `cd back && npm run lint && npm test` passes (`tests/session-captures.test.js`, 9)
- [x] `cd front && npm run lint && npm run build` passes
- [x] `cd app && npx expo export --platform android --clear` bundles
- [x] Migration applied on the development database (2026-11-19); pending for deploy elsewhere
- [x] Changelog entry added (`ref: CR-013`)
- [ ] Requester shown the result and signed off
- [ ] `request.md` status set to `Done`
