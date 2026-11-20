# CR-026 · Keep videos 7 days; Google Drive copies 2 days — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered

## Build

- [x] `back/database/migrations/027_keep_7_days_drive_2_days.sql`: default 7, every venue 7, Ready videos kept ≥ saved + 7 days
- [x] `back/server/src/utils/driveKeep.js`: `DRIVE_KEEP_DAYS = 2` and the cut-off
- [x] `jobs/driveCleanup.js`: trash a Drive copy 2 days after saving or once the server copy expired; a game's folder once nothing in it is still in Drive
- [x] `jobs/driveUploads.js`: skip a Drive upload of a video already past the 2 days
- [x] `sessions.controller.js` Re-upload: only videos still inside the 2 days
- [x] `utils/gameEmails.js`: email's "download before" = the Drive deadline
- [x] `validators/venues.validator.js`: default 7
- [x] Tests: default 7 days, Drive copy trashed after 2 days while the server keeps it, late upload skipped
- [x] `front/`: venue form default 7 + hint; Drive setup, Sessions dialog, landing page wording
- [x] `app/`: demo `keepDays` 7, comments

## Acceptance

Covered by `back/tests/google-drive.test.js` and `session-devices.test.js`; to be seen in the
running app by the requester.

- [x] A new venue shows 7 days; existing venues show 7 days (migration applied locally)
- [x] A replay plays from its share link for 7 days
- [x] Its Drive copy is in the Drive's trash 2 days after saving, while the share link still plays
- [x] A game's Drive folder goes once its videos' Drive copies are gone
- [x] The Drive email's deadline is 2 days after the game
- [x] The court device says "Download it within 7 days after the game"

## Wrap-up

- [x] `cd back && npm run lint && npm test` passes (0 errors; 316/316 tests)
- [x] `cd front && npm run lint && npm run build` passes (changed files lint clean; build OK)
- [ ] `cd app && npx expo export --platform android --clear` — fails before bundling with
      "No platforms are configured to use the Metro bundler" (project config, not this change;
      the app change is a comment and demo value)
- [x] Migration applied, or noted as pending for deploy (applied locally; deploy: `npm run db:migrate`)
- [x] Changelog entry added (`ref: CR-026`)
- [ ] Requester shown the result and signed off
- [x] `request.md` status set to `Done`
