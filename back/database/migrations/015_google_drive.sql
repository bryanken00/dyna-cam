-- 015_google_drive.sql
-- CR-001: every recording on a court can also be copied to a Google Drive the
-- venue owns. Staff connect one Google account per court on the court setup
-- page; the API uploads each Ready clip (replays and whole-game parts) to it.
--
-- courts
--  • driveRefreshToken: Google's offline refresh token, encrypted like camera
--    URLs (utils/crypto/secretBox.js); never returned
--  • driveEmail / driveConnectedAt / driveConnectedBy: who it uploads to, and
--    which staff account connected it
--  • driveFolderId: the court's "Dyna Cam · <venue> · <court>" folder in that
--    Drive (created on the first upload, re-created if it is deleted)
--  • driveStatus: Connected, or NeedsReconnect when Google refused the token
--    (access removed, password changed); driveProblem says why
--
-- clips
--  • driveStatus: NULL = not for Drive (court not connected when it became
--    Ready); Pending → Uploading → Uploaded, or Failed (gave up) / Skipped
--    (disconnected, or the server's copy was gone)
--  • driveAttempts / driveNextAttemptAt / driveError: retry bookkeeping
--  • driveFileId / driveUrl: the uploaded file and its "anyone with the link"
--    address, kept after the server's copy expires
--
-- recording_sessions
--  • driveFolderId / driveUrl: a whole game's own shared folder of parts

ALTER TABLE courts
  ADD COLUMN driveRefreshToken TEXT NULL AFTER streamLayout,
  ADD COLUMN driveEmail VARCHAR(255) NULL AFTER driveRefreshToken,
  ADD COLUMN driveFolderId VARCHAR(128) NULL AFTER driveEmail,
  ADD COLUMN driveStatus ENUM('Connected','NeedsReconnect') NULL AFTER driveFolderId,
  ADD COLUMN driveProblem VARCHAR(255) NULL AFTER driveStatus,
  ADD COLUMN driveConnectedAt DATETIME NULL AFTER driveProblem,
  ADD COLUMN driveConnectedBy VARCHAR(50) NULL AFTER driveConnectedAt;

ALTER TABLE clips
  ADD COLUMN driveStatus ENUM('Pending','Uploading','Uploaded','Failed','Skipped') NULL AFTER expiresAt,
  ADD COLUMN driveAttempts INT NOT NULL DEFAULT 0 AFTER driveStatus,
  ADD COLUMN driveNextAttemptAt DATETIME NULL AFTER driveAttempts,
  ADD COLUMN driveError VARCHAR(255) NULL AFTER driveNextAttemptAt,
  ADD COLUMN driveFileId VARCHAR(128) NULL AFTER driveError,
  ADD COLUMN driveUrl VARCHAR(255) NULL AFTER driveFileId,
  ADD COLUMN driveUploadedAt DATETIME NULL AFTER driveUrl,
  ADD INDEX idx_clips_drive_queue (driveStatus, driveNextAttemptAt);

ALTER TABLE recording_sessions
  ADD COLUMN driveFolderId VARCHAR(128) NULL AFTER failureReason,
  ADD COLUMN driveUrl VARCHAR(255) NULL AFTER driveFolderId;
