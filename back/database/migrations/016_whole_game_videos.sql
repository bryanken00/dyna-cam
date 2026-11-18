-- 016_whole_game_videos.sql
-- CR-003: a recorded game reaches the player as ONE whole video per camera.
-- The recorder box still cuts and uploads 5-minute parts (safe on a weak venue
-- line); once every part is in, the API joins them (ffmpeg, stream copy) into
-- a session_videos row per camera and deletes the part files.
--
-- clips
--  • camera: which camera a session part shows — 0 = the box's usual output
--    (one camera, or both stacked), 1 = Cam 1 only, 2 = Cam 2 only. Ordinary
--    replays are always 0. NOT NULL so (sessionId, partIndex, camera) stays
--    unique (NULLs would not be).
--  • joinedAt: when the part went into its whole video (its files are gone)
--
-- recording_sessions
--  • partCameras: decided when the first part is made — 1 = one set of parts
--    (camera 0), 2 = a set per camera (two-camera court, and every recorder
--    box of the venue can cut per camera)
--  • wholeVideo: NULL = not joined yet, Pending = whole videos being made,
--    Done, Skipped (nothing to join, or a game from before this change)
--
-- session_videos: one whole-game video per session and camera, with the same
-- retention and Google Drive copy (CR-001) bookkeeping as a clip.

ALTER TABLE clips
  ADD COLUMN camera TINYINT NOT NULL DEFAULT 0 AFTER partIndex,
  ADD COLUMN joinedAt DATETIME NULL AFTER expiresAt,
  ADD UNIQUE INDEX uq_clips_session_part_camera (sessionId, partIndex, camera),
  DROP INDEX uq_clips_session_part;

ALTER TABLE recording_sessions
  ADD COLUMN partCameras TINYINT NULL AFTER failureReason,
  ADD COLUMN wholeVideo ENUM('Pending','Done','Skipped') NULL AFTER partCameras;

-- Games from before this change keep their parts
UPDATE recording_sessions SET wholeVideo = 'Skipped', partCameras = 1;

CREATE TABLE IF NOT EXISTS session_videos (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  sessionVideoId VARCHAR(50) NOT NULL UNIQUE,
  sessionId VARCHAR(50) NOT NULL,
  venueId VARCHAR(50) NOT NULL,
  camera TINYINT NOT NULL DEFAULT 0,
  status ENUM('Pending','Joining','Ready','Failed','Expired','Deleted') NOT NULL DEFAULT 'Pending',
  partsJoined INT NOT NULL DEFAULT 0,
  partsMissing INT NOT NULL DEFAULT 0,
  gaps JSON NULL,
  videoPath VARCHAR(255) NULL,
  thumbnailPath VARCHAR(255) NULL,
  sizeBytes BIGINT NULL,
  durationSeconds INT NULL,
  failureReason VARCHAR(255) NULL,
  attempts INT NOT NULL DEFAULT 0,
  nextAttemptAt DATETIME NULL,
  expiresAt DATETIME NULL,
  driveStatus ENUM('Pending','Uploading','Uploaded','Failed','Skipped') NULL,
  driveAttempts INT NOT NULL DEFAULT 0,
  driveNextAttemptAt DATETIME NULL,
  driveError VARCHAR(255) NULL,
  driveFileId VARCHAR(128) NULL,
  driveUrl VARCHAR(255) NULL,
  driveUploadedAt DATETIME NULL,
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  UNIQUE INDEX uq_session_videos_camera (sessionId, camera),
  INDEX idx_session_videos_status (status, nextAttemptAt),
  INDEX idx_session_videos_expires (status, expiresAt),
  INDEX idx_session_videos_drive (driveStatus, driveNextAttemptAt),
  CONSTRAINT fk_session_videos_session FOREIGN KEY (sessionId) REFERENCES recording_sessions(sessionId),
  CONSTRAINT fk_session_videos_venue FOREIGN KEY (venueId) REFERENCES venues(venueId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
