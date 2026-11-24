-- 036_videos_on_box_and_drive.sql
-- CR-040 / PLAN-005: videos stay on the venue's recorder box and go straight to
-- the court's Google Drive; the cloud keeps only the rows.
--
-- session_videos:
--   • delivery — 'Server': the box uploaded the file to the API (before CR-040,
--     and from boxes not yet updated). 'Drive': the box keeps the file and sends
--     it to Google Drive itself; the API never holds it (videoPath stays NULL).
--   • driveSessionUrl — the Google Drive resumable-upload session the API opened
--     for the box (encrypted with DEVICE_SECRET_KEY: whoever holds it can write
--     that one file); driveSessionAt — when it was opened (Google keeps one about
--     a week).
--   • boxKeepUntil — how long the box keeps its copy (the venue's keep time);
--     boxDeletedAt — when the box reported it removed its copy.

ALTER TABLE session_videos
  ADD COLUMN delivery ENUM('Server','Drive') NOT NULL DEFAULT 'Server' AFTER status,
  ADD COLUMN driveSessionUrl VARCHAR(4096) NULL AFTER driveUrl,
  ADD COLUMN driveSessionAt DATETIME NULL AFTER driveSessionUrl,
  ADD COLUMN boxKeepUntil DATETIME NULL AFTER expiresAt,
  ADD COLUMN boxDeletedAt DATETIME NULL AFTER boxKeepUntil,
  ADD INDEX idx_session_videos_box_keep (venueId, delivery, boxDeletedAt);
