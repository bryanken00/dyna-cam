-- 013_second_camera.sql
-- PLAN-002 Phase H: a court can have a second camera. Clips and whole-game
-- videos on a 2-camera court show Cam 1 over Cam 2; the venue's court stream
-- and a player's own stream can show Cam 1, Cam 2 or both stacked.
--
--  • courts.camera2RtspUrl: camera 2's RTSP address, encrypted like
--    cameraRtspUrl (utils/crypto/secretBox.js); snapshot2Path/snapshot2At: its
--    preview picture for camera setup
--  • courts.streamLayout: what the venue's court stream shows
--  • recording_sessions.streamLayout: what a player's own stream shows (NULL = no stream)

ALTER TABLE courts
  ADD COLUMN camera2RtspUrl TEXT NULL AFTER cameraRtspUrl,
  ADD COLUMN snapshot2Path VARCHAR(255) NULL AFTER snapshotAt,
  ADD COLUMN snapshot2At DATETIME NULL AFTER snapshot2Path,
  ADD COLUMN streamLayout ENUM('CAM1','CAM2','STACKED') NOT NULL DEFAULT 'CAM1' AFTER streamWatchUrl;

ALTER TABLE recording_sessions
  ADD COLUMN streamLayout ENUM('CAM1','CAM2','STACKED') NULL AFTER streamPlatform;
