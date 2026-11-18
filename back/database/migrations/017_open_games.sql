-- 017_open_games.sql
-- CR-005: a game is created without times and runs from pairing to End game.
--
--  • status 'Waiting': created, no session device paired yet — nothing is
--    recorded. The first device to pair starts it (status Recording, startAt =
--    that moment).
--  • openEnded: the game ends only by End game on the device or End in Admin.
--    Its endAt is a rolling placeholder the API keeps ahead of now (so every
--    rule that reads a session's window keeps working, and the recorder box
--    keeps its footage); End sets the real end.

ALTER TABLE recording_sessions
  MODIFY COLUMN status ENUM('Waiting','Scheduled','Recording','Processing','Ready','Failed','Cancelled')
    NOT NULL DEFAULT 'Scheduled',
  ADD COLUMN openEnded TINYINT NOT NULL DEFAULT 0 AFTER wholeVideo;
