-- 020_session_captures.sql
-- CR-013: during a game, the paired courtside device can save "the last N
-- minutes" as a separate video (a capture). It is made exactly like the
-- whole-game video (CR-006) — the recorder box copies that stretch of footage
-- per camera and uploads it in chunks — only over a shorter window.
--
-- session_captures: one row per save.
--  • startAt / endAt: the stretch of the game it covers (Manila time); endAt is
--    the moment Save was tapped, startAt = endAt − seconds, never before the
--    game's start
--  • seconds: what was asked for (the window can be shorter at the very start)
--  • pairedAppId: the device that saved it
--
-- session_videos
--  • captureId: NULL = the game's whole video; set = this save's video. The
--    whole-game logic (settling the game, counts, retry, upload %) only looks
--    at rows with captureId IS NULL.
--  • captureKey repeats captureId ('' for the whole game) so one UNIQUE key
--    keeps a single video per camera for the game and for each save — a NULL
--    captureId would never clash in a UNIQUE index.

CREATE TABLE IF NOT EXISTS session_captures (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  captureId VARCHAR(50) NOT NULL UNIQUE,
  sessionId VARCHAR(50) NOT NULL,
  venueId VARCHAR(50) NOT NULL,
  startAt DATETIME NOT NULL,
  endAt DATETIME NOT NULL,
  seconds INT NOT NULL,
  pairedAppId VARCHAR(50) NULL,
  status ENUM('Active','Deleted') NOT NULL DEFAULT 'Active',
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  INDEX idx_session_captures_session (sessionId, status),
  CONSTRAINT fk_session_captures_session FOREIGN KEY (sessionId) REFERENCES recording_sessions(sessionId),
  CONSTRAINT fk_session_captures_venue FOREIGN KEY (venueId) REFERENCES venues(venueId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE session_videos
  ADD COLUMN captureId VARCHAR(50) NULL AFTER sessionId,
  ADD COLUMN captureKey VARCHAR(50) GENERATED ALWAYS AS (COALESCE(captureId, '')) STORED AFTER captureId,
  ADD UNIQUE INDEX uq_session_videos_capture_camera (sessionId, captureKey, camera),
  ADD INDEX idx_session_videos_capture (captureId),
  ADD CONSTRAINT fk_session_videos_capture FOREIGN KEY (captureId) REFERENCES session_captures(captureId);

ALTER TABLE session_videos DROP INDEX uq_session_videos_camera;
