-- 028_player_start_game.sql
-- CR-027: players start their own game from a court's Start-a-game QR.
--
-- courts
--  • startToken: the unguessable code in the Start-a-game QR (/start/<startToken>).
--    NULL = the court has no Start-a-game QR (off until staff generate one).
--    Issue new code replaces it; Turn off clears it. Separate from qrToken
--    (the 60-second save sign), which is unchanged.
--
-- recording_sessions
--  • startedByPlayer: 1 = a player started it from that QR (no staff account,
--    no paired device). Admin shows it as started by "Player (QR)".

ALTER TABLE courts
  ADD COLUMN startToken VARCHAR(64) NULL AFTER qrToken,
  ADD UNIQUE INDEX uq_courts_startToken (startToken);

ALTER TABLE recording_sessions
  ADD COLUMN startedByPlayer TINYINT NOT NULL DEFAULT 0 AFTER createdByAccountId;
