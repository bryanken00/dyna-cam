-- 025_session_email.sql
-- CR-018: the player's email on a game, and the "your game is in Google Drive"
-- email sent to it once the game's videos are in the court's Drive and the game
-- is paid (or free).
--
--  • email: optional, typed on New game; staff can fix it later.
--  • driveEmailStatus: NULL = not sent yet (waiting for Drive / payment, or
--    retrying), Sending = claimed by the send step (driveEmailNextAttemptAt is
--    its lease), Sent, Failed = SendGrid kept refusing (driveEmailError says why).
--    Changing the email clears it, so the new address gets the link.
--  • driveEmailTo / driveEmailSentAt: where and when it went.

ALTER TABLE recording_sessions
  ADD COLUMN email VARCHAR(255) NULL AFTER phone,
  ADD COLUMN driveEmailStatus ENUM('Sending','Sent','Failed') NULL AFTER driveFolderNextAttemptAt,
  ADD COLUMN driveEmailTo VARCHAR(255) NULL AFTER driveEmailStatus,
  ADD COLUMN driveEmailSentAt DATETIME NULL AFTER driveEmailTo,
  ADD COLUMN driveEmailAttempts INT NOT NULL DEFAULT 0 AFTER driveEmailSentAt,
  ADD COLUMN driveEmailNextAttemptAt DATETIME NULL AFTER driveEmailAttempts,
  ADD COLUMN driveEmailError VARCHAR(255) NULL AFTER driveEmailNextAttemptAt;
