-- 039_booking_many_games.sql
-- CR-041: a booked game ended early can be resumed for the rest of the booked
-- time as a NEW game on the same booking, so one booking may now have several
-- games. bookings.sessionId keeps pointing at its current (latest) game; every
-- query from a booking to its game goes through that column.
--
-- The unique key becomes a plain index (the foreign key needs one, so the new
-- index is added before the unique one is dropped).

ALTER TABLE recording_sessions
  ADD INDEX idx_sessions_bookingId (bookingId);

ALTER TABLE recording_sessions
  DROP INDEX uq_sessions_bookingId;
