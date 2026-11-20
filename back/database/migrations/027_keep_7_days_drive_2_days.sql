-- 027_keep_7_days_drive_2_days.sql
-- CR-026: saved videos are kept 7 days on the server (was 1, CR-017) — the new
-- default and every venue's setting. Their Google Drive copy now goes on its
-- own clock, 2 days after the video was saved (jobs/driveCleanup.js, from
-- dateCreated) — no schema change for that.
--
--  • Videos still kept get 7 days from when they were saved — never less than
--    they have now. Expired ones are already gone and stay so.

ALTER TABLE venues
  MODIFY COLUMN clipRetentionDays INT NOT NULL DEFAULT 7;

UPDATE venues SET clipRetentionDays = 7;

UPDATE clips SET expiresAt = DATE_ADD(dateCreated, INTERVAL 7 DAY)
WHERE status = 'Ready' AND expiresAt IS NOT NULL
  AND expiresAt < DATE_ADD(dateCreated, INTERVAL 7 DAY);

UPDATE session_videos SET expiresAt = DATE_ADD(dateCreated, INTERVAL 7 DAY)
WHERE status = 'Ready' AND expiresAt IS NOT NULL
  AND expiresAt < DATE_ADD(dateCreated, INTERVAL 7 DAY);
