-- 024_auto_delete_videos.sql
-- CR-017: saved videos go after the venue's days — now 1 day (24 hours) by
-- default and for every venue — on the server AND in the court's Google Drive.
--
--  • driveStatus 'Deleted': the Drive copy was moved to the Drive's trash
--    (Google empties it after 30 days) once the server's copy expired
--    (jobs/driveCleanup.js). driveDeleteAttempts / driveDeletedAt are its
--    bookkeeping; driveNextAttemptAt doubles as its lease and retry time.
--  • recording_sessions.driveFolderNextAttemptAt: retry time for trashing a
--    game's Drive folder once nothing in it is left.
--  • Videos already saved keep at most 24 hours from this migration — never
--    less than they had, nothing goes without notice.

ALTER TABLE clips
  MODIFY COLUMN driveStatus ENUM('Pending','Uploading','Uploaded','Failed','Skipped','Deleted') NULL,
  ADD COLUMN driveDeleteAttempts INT NOT NULL DEFAULT 0 AFTER driveUploadedAt,
  ADD COLUMN driveDeletedAt DATETIME NULL AFTER driveDeleteAttempts;

ALTER TABLE session_videos
  MODIFY COLUMN driveStatus ENUM('Pending','Uploading','Uploaded','Failed','Skipped','Deleted') NULL,
  ADD COLUMN driveDeleteAttempts INT NOT NULL DEFAULT 0 AFTER driveUploadedAt,
  ADD COLUMN driveDeletedAt DATETIME NULL AFTER driveDeleteAttempts;

ALTER TABLE recording_sessions
  ADD COLUMN driveFolderNextAttemptAt DATETIME NULL AFTER driveUrl;

ALTER TABLE venues
  MODIFY COLUMN clipRetentionDays INT NOT NULL DEFAULT 1;

UPDATE venues SET clipRetentionDays = 1;

-- Manila time, as every DATETIME here is stored
SET @cr017_keep_until = DATE_ADD(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'), INTERVAL 24 HOUR);

UPDATE clips SET expiresAt = @cr017_keep_until
WHERE status = 'Ready' AND expiresAt > @cr017_keep_until;

UPDATE session_videos SET expiresAt = @cr017_keep_until
WHERE status = 'Ready' AND expiresAt > @cr017_keep_until;
