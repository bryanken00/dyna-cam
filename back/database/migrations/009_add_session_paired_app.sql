-- 009_add_session_paired_app.sql
-- PLAN-002 Phase D: a paired staff phone can start and end a whole-game
-- recording (a recording session that starts now). recording_sessions.pairedAppId
-- records which phone started it; createdByAccountId stays NULL then.

ALTER TABLE recording_sessions
  ADD COLUMN pairedAppId VARCHAR(50) NULL AFTER createdByAccountId,
  ADD CONSTRAINT fk_sessions_paired_app FOREIGN KEY (pairedAppId) REFERENCES paired_apps(pairedAppId);
