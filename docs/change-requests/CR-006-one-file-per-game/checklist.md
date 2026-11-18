# CR-006 · One file per game — Checklist

> Request: [request.md](request.md)

## Before starting

- [ ] Approved (see request.md → Approval)
- [x] Open questions answered
- [ ] Plan written (`plan-doc`): the box's whole-game job, the resumable upload protocol, removal
      order (pieces, join job), rollout of the box update

## Build

### Recorder box (`edge/`)

- [ ] Game job after End game: one file per camera for the game window by **copying** the
      recorded segments (no re-encode, no logo); gaps found from the segment timeline and reported
- [ ] Footage kept until the game's files are uploaded (not until end + 30 min)
- [ ] Resumable chunked upload (8 MB), progress persisted in the job queue; resumes after a
      network drop or a restart
- [ ] Capability reported in the heartbeat; tests; `npm run smoke` with a whole-game file

### API (`back/`)

- [ ] Migration: upload progress on `session_videos` (upload id, bytes received)
- [ ] Device API: game-video jobs after End game; start / chunk / finish upload endpoints
      (Content-Range, idempotent chunks, size limit per game, venue-scoped)
- [ ] Remove 5-minute piece jobs, the join job (`jobs/sessionJoin.js`) and part settling — no
      fallback (nothing deployed yet); ffmpeg no longer needed on the server
- [ ] Progress (`uploadPercent`) on the public, admin and app session responses
- [ ] Google Drive: the uploaded file
- [ ] Tests: upload start/chunks/resume/finish, wrong venue 404, oversize refused, progress,
      no pieces for new games, replays unchanged

### Web (`front/`) and app (`app/`)

- [ ] Player's page: "Saving your game… uploading N%"
- [ ] Admin game detail: video + upload progress per camera, no pieces
- [ ] Session device end screen: "Saving your game… uploading N%"

## Acceptance

- [ ] No 5-minute pieces anywhere for a new game
- [ ] Upload progress, then one video per camera with one Download
- [ ] Network drop / box restart mid-upload resumes, doesn't restart
- [ ] Camera drop-out shown as a named missing stretch
- [ ] Server works without ffmpeg
- [ ] Replays unchanged

## Wrap-up

- [ ] `cd edge && npm run lint && npm test && npm run smoke` passes
- [ ] `cd back && npm run lint && npm test` passes
- [ ] `cd front && npm run lint && npm run build` passes
- [ ] `cd app && npx expo export --platform android --clear` passes
- [ ] Migration and box update noted for deploy
- [ ] Changelog: CR-003 is unreleased, so update its entry
- [ ] Requester shown the result and signed off
- [ ] `request.md` status set to `Done`
