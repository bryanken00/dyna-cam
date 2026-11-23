-- 034_booking_cancel_email.sql
-- PLAN-003 Phase G: booking emails.
--
-- bookings.cancelledEmailSentAt — when the player was told their booking was
-- cancelled or its unpaid hold released. Like confirmationSentAt and
-- reminderSentAt (033), it is claimed before sending, so the request that
-- cancels a booking and the booking job (which emails released holds) never
-- both send it.

ALTER TABLE bookings
  ADD COLUMN cancelledEmailSentAt DATETIME NULL AFTER reminderSentAt;
