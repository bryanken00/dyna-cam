---
type: improved
impact: major
audience: user
ref: CR-017
---

Saved replays, game videos and saves are now deleted 24 hours after they're saved, and their copy
in the court's Google Drive goes to the Drive's trash at the same time (Google empties it after 30
days). Every venue is set to keep videos 1 day; a venue can still choose longer in Setup → Venues.
Videos saved before this update get 24 hours from the update. The player's page and the court's
device say how long a video is kept.

## Dev notes

- back/: run `npm run db:migrate` — `024_auto_delete_videos.sql` sets every venue's
  `clipRetentionDays` to 1 (new default 1), pulls every Ready video's `expiresAt` to at most
  24 h from the migration, adds `driveStatus` `Deleted` + `driveDeleteAttempts` /
  `driveDeletedAt` (clips, session_videos) and `recording_sessions.driveFolderNextAttemptAt`.
- back/: once applied, every Drive copy already uploaded is moved to that Google account's trash
  when its video expires — within about 24 hours of the update for existing videos.
- back/: new `jobs/driveCleanup.js` runs after each Drive upload pass (every 30 s): trashes the
  Drive copy of an expired video, then the game's Drive folder once empty. Courts that need
  reconnecting (or were disconnected) wait. `jobs/clipMaintenance.js` now runs every 10 minutes
  (was hourly).
- back/: the player's page no longer offers the Drive link once the server's copy expired; the
  court device's session gains `keepDays`.
- app/: JavaScript only (over-the-air update) — "Download it within 24 hours after the game".
- edge/: no recorder box update.
