-- 040_schedule_confirmed_until.sql
-- CR-043: a venue's weekly hours and prices open for online booking one week at a
-- time. Staff confirm next week (Monday to Sunday, Manila time) before players can
-- book it; scheduleConfirmedUntil is the last date (a Sunday) confirmed so far.
-- NULL = never confirmed: online booking has no open date (staff can still book).
--
-- Switch-over: every venue counts as confirmed through the end of next week, so
-- nothing players can book today closes when this ships. Manila's date comes from
-- UTC (+8 h) so the session time zone doesn't matter; WEEKDAY() is 0 on Monday, so
-- today + (13 - WEEKDAY) days is next week's Sunday.

ALTER TABLE venues
  ADD COLUMN scheduleConfirmedUntil DATE NULL AFTER checkInEarlyMinutes;

UPDATE venues
SET scheduleConfirmedUntil = DATE_ADD(
  DATE(UTC_TIMESTAMP() + INTERVAL 8 HOUR),
  INTERVAL (13 - WEEKDAY(DATE(UTC_TIMESTAMP() + INTERVAL 8 HOUR))) DAY
)
WHERE status != 'Deleted';
