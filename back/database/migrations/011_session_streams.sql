-- 011_session_streams.sql
-- PLAN-002 Phase G: a player streams their session to their own Facebook or
-- YouTube. They paste the stream key on their own phone, on a page the session
-- device's QR opens (a short-lived setup code); the recorder box restreams the
-- court's live view to it while the session records.
--
--  • streamUrl: the full RTMP(S) address incl. the key, encrypted like camera
--    URLs (utils/crypto/secretBox.js); never returned, cleared when the session ends
--  • streamPlatform / streamUpdatedAt: what the player chose, and when
--  • streamSetupTokenHash / streamSetupExpiresAt: the QR's code (SHA-256 only)

ALTER TABLE recording_sessions
  ADD COLUMN streamUrl TEXT NULL AFTER failureReason,
  ADD COLUMN streamPlatform ENUM('FACEBOOK','YOUTUBE','OTHER') NULL AFTER streamUrl,
  ADD COLUMN streamUpdatedAt DATETIME NULL AFTER streamPlatform,
  ADD COLUMN streamSetupTokenHash CHAR(64) NULL AFTER streamUpdatedAt,
  ADD COLUMN streamSetupExpiresAt DATETIME NULL AFTER streamSetupTokenHash,
  ADD UNIQUE INDEX uq_sessions_stream_setup (streamSetupTokenHash);
