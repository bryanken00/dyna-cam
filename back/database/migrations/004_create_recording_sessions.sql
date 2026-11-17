-- 004_create_recording_sessions.sql
-- PLAN-001 Phase 3: full-session recording. Staff book a court for a time
-- window; the venue's recorder box keeps that window's footage, and it is
-- delivered as 5-minute parts — each part is an ordinary clip (source
-- 'SESSION') with an explicit window, so it reuses the clip pipeline (cut,
-- watermark, upload, expiry). The player gets one share link for the session.
--
-- Session status: Scheduled → Recording → Processing → Ready (or Failed), or
-- Cancelled by staff before it ends.

CREATE TABLE IF NOT EXISTS recording_sessions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  sessionId VARCHAR(50) NOT NULL UNIQUE,
  venueId VARCHAR(50) NOT NULL,
  courtId VARCHAR(50) NOT NULL,
  startAt DATETIME NOT NULL,
  endAt DATETIME NOT NULL,
  playerName VARCHAR(100) NULL,
  phone VARCHAR(20) NULL,
  shareToken VARCHAR(64) NOT NULL UNIQUE,
  createdByAccountId VARCHAR(50) NULL,
  failureReason VARCHAR(255) NULL,
  status ENUM('Scheduled','Recording','Processing','Ready','Failed','Cancelled') NOT NULL DEFAULT 'Scheduled',
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  INDEX idx_sessions_court_window (courtId, startAt, endAt),
  INDEX idx_sessions_venue_status (venueId, status),
  INDEX idx_sessions_status_end (status, endAt),
  CONSTRAINT fk_sessions_venue FOREIGN KEY (venueId) REFERENCES venues(venueId),
  CONSTRAINT fk_sessions_court FOREIGN KEY (courtId) REFERENCES courts(courtId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A session part is a clip with its own window (windowStartAt..windowEndAt)
-- instead of "the 60 s before requestedAt". Ordinary clips leave these NULL.
ALTER TABLE clips
  ADD COLUMN sessionId VARCHAR(50) NULL AFTER courtId,
  ADD COLUMN partIndex INT NULL AFTER sessionId,
  ADD COLUMN windowStartAt DATETIME NULL AFTER requestedAt,
  ADD COLUMN windowEndAt DATETIME NULL AFTER windowStartAt,
  ADD CONSTRAINT fk_clips_session FOREIGN KEY (sessionId) REFERENCES recording_sessions(sessionId),
  ADD UNIQUE INDEX uq_clips_session_part (sessionId, partIndex);
