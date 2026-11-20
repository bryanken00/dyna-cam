-- 023_session_added_minutes.sql
-- CR-016: a game is created with a game time (it records at once and stops by
-- itself at endAt), and staff can Add time while it records. addedMinutes is
-- the total time added after New game, shown on the game's details. Adding
-- time moves endAt and never changes the payment.

ALTER TABLE recording_sessions
  ADD COLUMN addedMinutes INT NOT NULL DEFAULT 0 AFTER maxCaptures;
