-- 021_session_payments.sql
-- CR-015: a game's videos open only after it is paid at the front desk.
--
-- recording_sessions
--  • paymentStatus: Unpaid for every new game until staff record a payment;
--    Paid after; Free = a game from before this change (stays open).
--  • payCode: the short code the courtside device and the locked game page
--    show (e.g. K7QM2P). Staff find the game by it; Find a game on the device's
--    pairing screen looks it up. NULL for older games.
--
-- payments: one row per payment, for a clip (clipId) or a game (sessionId) —
-- exactly one of the two. A game's amount is what staff typed. Refunding it
-- locks the game again.

ALTER TABLE recording_sessions
  ADD COLUMN paymentStatus ENUM('Free','Unpaid','Paid') NOT NULL DEFAULT 'Unpaid' AFTER status,
  ADD COLUMN payCode VARCHAR(12) NULL AFTER paymentStatus,
  ADD UNIQUE INDEX uq_sessions_payCode (payCode),
  ADD INDEX idx_sessions_paymentStatus (paymentStatus);

-- Games recorded before this change were free: keep them open
UPDATE recording_sessions SET paymentStatus = 'Free';

ALTER TABLE payments
  MODIFY COLUMN clipId VARCHAR(50) NULL,
  ADD COLUMN sessionId VARCHAR(50) NULL AFTER clipId,
  ADD INDEX idx_payments_sessionId (sessionId),
  ADD CONSTRAINT fk_payments_session FOREIGN KEY (sessionId) REFERENCES recording_sessions(sessionId);
