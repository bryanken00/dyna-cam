-- 029_court_qr_starts_game.sql
-- CR-027 revision: the court's one QR sign (qrToken, /court/<qrToken>) now
-- starts a game, and "Save the last 60 seconds" is gone — from the QR and from
-- the court's Wi-Fi button.
--
--  • courts.startToken (028): the separate Start-a-game QR is dropped — the
--    court's qrToken does that job.
--  • courts.buttonCode (003): court buttons no longer save clips; the API
--    refuses presses (the recorder box drops them).
--
-- Clips already saved (and their payments) are untouched and expire as usual.

ALTER TABLE courts
  DROP INDEX uq_courts_startToken,
  DROP COLUMN startToken;

ALTER TABLE courts
  DROP INDEX uq_courts_buttonCode,
  DROP COLUMN buttonCode;
