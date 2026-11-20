---
type: improved
impact: major
audience: user
ref: CR-026
---

Saved replays, game videos and saves are now kept for 7 days instead of 24 hours, so players have
a week to watch and download them. Every venue is set to 7 days, and videos saved before this
update get 7 days from when they were saved. The copy in the court's Google Drive now goes to the
Drive's trash 2 days after the video is saved, so the venue's Drive doesn't fill up.

## Dev notes

- back/: run `npm run db:migrate` — `027_keep_7_days_drive_2_days.sql` sets every venue's
  `clipRetentionDays` to 7 (new default 7) and gives every Ready video at least 7 days from its
  `dateCreated`.
- back/: `jobs/driveCleanup.js` trashes a Drive copy 2 days after `dateCreated`
  (`utils/driveKeep.js` `DRIVE_KEEP_DAYS`), or once the server copy expired; a game's Drive folder
  goes once none of its videos is still in Drive. Drive copies older than 2 days are trashed on the
  first pass after deploy.
- back/: a Drive upload still waiting after 2 days is marked Skipped; Sessions → Re-upload refuses
  videos older than 2 days. The Drive-link email's "download before" is the Drive deadline.
- front/: venue form default 7 days; Drive wording on venue form, court setup, Sessions, landing page.
- app/: JavaScript only (demo data, comment) — the device already reads `keepDays` ("within 7 days").
- edge/: no recorder box update.
