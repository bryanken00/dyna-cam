-- 042_no_counter_payments.sql
-- CR-046: no payment at the counter. Staff can no longer record cash for a game
-- (Admin → Sessions → Record payment) or a 60-second clip (Payments → Take
-- payment), so a game or clip still waiting for that payment could never be
-- unlocked. Every one left is made Free, so its videos open for the player.
-- Games have started free since CR-039; this also makes Free the column default.
-- Payments already recorded are kept as they are.

UPDATE recording_sessions
SET paymentStatus = 'Free', dateUpdated = UTC_TIMESTAMP() + INTERVAL 8 HOUR
WHERE paymentStatus = 'Unpaid';

UPDATE clips
SET paymentStatus = 'Free', dateUpdated = UTC_TIMESTAMP() + INTERVAL 8 HOUR
WHERE paymentStatus = 'Unpaid';

ALTER TABLE recording_sessions
  MODIFY COLUMN paymentStatus ENUM('Free','Unpaid','Paid') NOT NULL DEFAULT 'Free';
