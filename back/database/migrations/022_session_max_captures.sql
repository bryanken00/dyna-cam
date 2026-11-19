-- 022_session_max_captures.sql
-- CR-013 revision: how many saves ("Save the last …" from the courtside
-- device) a game may hold at once is chosen per game on New game (default 5).
-- NULL = a game from before, or created without it: the API's
-- CAPTURE_MAX_PER_GAME (default 5) applies.

ALTER TABLE recording_sessions
  ADD COLUMN maxCaptures INT NULL AFTER openEnded;
