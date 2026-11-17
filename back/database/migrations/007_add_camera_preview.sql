-- 007_add_camera_preview.sql
-- PLAN-002 Phase A: guided camera setup in the Admin portal. While someone has
-- a court's setup page open, the API asks the venue's recorder box for a
-- preview picture (previewWantedUntil); the box uploads a JPEG from its own
-- latest recording — it can't open a second camera connection (a Tapo C200
-- serves one RTSP client). The newest snapshot's stored path and time are kept
-- here; the picture is returned signed like every upload.

ALTER TABLE courts
  ADD COLUMN previewWantedUntil DATETIME NULL AFTER streamWatchUrl,
  ADD COLUMN snapshotPath VARCHAR(255) NULL AFTER previewWantedUntil,
  ADD COLUMN snapshotAt DATETIME NULL AFTER snapshotPath;
