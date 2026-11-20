# CR-017 · Delete saved videos after 24 hours, on the server and on Google Drive — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered (2026-11-20: venue setting at 1 day, from saved, Drive trash,
      existing videos get 24 h from the update)

## Build

### API (`back/`)

- [x] Migration: `driveStatus` ENUM gains `Deleted` on `clips` and `session_videos`; delete-retry
      bookkeeping; `venues.clipRetentionDays` default 1 and every venue set to 1; Ready videos'
      `expiresAt` = LEAST(expiresAt, migration time + 24 h)
- [x] `utils/googleDrive.js`: move a file / folder to the trash (`trashed: true`); a 404 counts as already gone
- [x] New `jobs/driveCleanup.js` (after each Drive upload pass, every 30 s): an expired video with
      `driveStatus = 'Uploaded'` → trash its Drive file → `Deleted`; a failure retries with
      back-off (8 tries); a court needing reconnect waits; the game's Drive folder goes once
      empty. `jobs/clipMaintenance.js` now runs every 10 minutes (was hourly)
- [x] A Drive upload still pending when the server copy expires is skipped (already so: the upload
      needs the server's file); one finishing just after expiry is trashed on the next pass
- [x] Expiry stays "saved + venue days" (paid or not); validator default 1
- [x] Player's page / device payloads: deleted state, no Drive link after delete
- [x] Tests: expiry at 24 h removes files and marks Drive `Deleted` (Drive calls stubbed);
      reconnect-needed court waits; 404 from Drive counts as deleted; nothing deleted early
- [x] `cd back && npm run lint && npm test` — 284 pass, no new lint warnings

### Web (`front/`)

- [x] Setup → Venues: "Keep videos for (days)", default 1, says the Drive copy follows it
- [x] Player's page: "Available until …" and "This video has been deleted" wording
- [x] Sessions / Clips details: deleted state; Drive copy left behind (court needs reconnecting)
- [x] Court setup → Google Drive: says copies go to the trash at the keep time; disconnecting
      leaves copies Dyna Cam can no longer delete
- [x] Landing page: how long videos are kept
- [x] `cd front && npm run lint && npm run build`

### App (`app/`)

- [x] QR card: "Download it within 24 hours after the game"
- [x] Ended screen: "Download within 24 hours — then it's deleted." (`keepDays` from the API)
- [x] `cd app && npx expo export --platform android --clear` bundles (expo-doctor: only the
      existing version-mismatch warning)

## Acceptance

Items marked "(API test)" are covered by `back/tests/google-drive.test.js` against a fake Google;
the rest need a check in the running app with a real Google Drive.

- [ ] A video saved now shows "Available until <tomorrow, same time>" on the player's page
- [ ] After 24 hours the player's page says it has been deleted and it no longer downloads
- [x] Its Google Drive copy is gone at the same time (API test)
- [x] A court whose Drive needs reconnecting keeps its copies until reconnected, then they go (API test)
- [x] Nothing else in the Drive is touched (API test)

## Wrap-up

- [x] `cd back && npm run lint` passes
- [x] `cd front && npm run lint && npm run build` passes
- [x] App export passes
- [x] Migration pending — **not applied on the development database**: it holds 70 Drive
      copies in a real Google Drive that a running dev server would trash within ~24 h. Apply
      with `npm run db:migrate` when that is wanted
- [x] Changelog entry added (`ref: CR-017`, impact `major`)
- [ ] Requester shown the result and signed off
- [ ] `request.md` status set to `Done`
