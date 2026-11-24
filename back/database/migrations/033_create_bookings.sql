-- 033_create_bookings.sql
-- PLAN-003: court bookings, their link to the game they become, their payments,
-- and the ADMIN permission bookings (granted to the Owner role at write level).
--
-- bookings — a reservation of court time. Only check-in creates its game.
--  • status: Pending (waiting for payment; holds the slot until holdExpiresAt)
--    → Confirmed (Paid or Free) → CheckedIn (sessionId set) → Completed;
--    or NoShow, Cancelled (cancelledBy / cancelReason), Expired (hold ran out),
--    Deleted (soft delete).
--  • paymentStatus: Unpaid · Paid · Refunded · Free (staff comp).
--  • payMethod: how it's paid (Online = Xendit, Desk = cash); source: who made it.
--  • bookingCode: short code the player types at the court QR and reads to the desk.
--  • manageToken: the player's booking link (/booking/<manageToken>).
--  • checkoutId / checkoutUrl: the open Xendit invoice and its hosted page.
--  • rescheduledCount: player moves (one allowed).
--
-- recording_sessions.bookingId: the booking a game was checked in from.
--
-- payments
--  • bookingId: a booking's payment — each row has exactly one of clipId,
--    sessionId or bookingId.
--  • method ONLINE (Xendit) beside CASH; provider / providerRef (the paid invoice,
--    unique so a retried webhook records nothing twice); providerRefundRef and
--    refundError (a refund Xendit refused — shown as "Refund failed").

CREATE TABLE IF NOT EXISTS bookings (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  bookingId VARCHAR(50) NOT NULL UNIQUE,
  venueId VARCHAR(50) NOT NULL,
  courtId VARCHAR(50) NOT NULL,
  startAt DATETIME NOT NULL,
  endAt DATETIME NOT NULL,
  playerName VARCHAR(100) NOT NULL,
  phone VARCHAR(20) NULL,
  email VARCHAR(255) NULL,
  price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  paymentStatus ENUM('Unpaid','Paid','Refunded','Free') NOT NULL DEFAULT 'Unpaid',
  payMethod ENUM('Online','Desk') NOT NULL DEFAULT 'Desk',
  source ENUM('Online','Desk') NOT NULL DEFAULT 'Desk',
  bookingCode VARCHAR(12) NOT NULL UNIQUE,
  manageToken VARCHAR(64) NOT NULL UNIQUE,
  holdExpiresAt DATETIME NULL,
  checkoutId VARCHAR(100) NULL,
  checkoutUrl VARCHAR(500) NULL,
  sessionId VARCHAR(50) NULL UNIQUE,
  rescheduledCount INT NOT NULL DEFAULT 0,
  cancelledAt DATETIME NULL,
  cancelledBy ENUM('Player','Staff','System') NULL,
  cancelReason VARCHAR(255) NULL,
  confirmationSentAt DATETIME NULL,
  reminderSentAt DATETIME NULL,
  createdByAccountId VARCHAR(50) NULL,
  status ENUM('Pending','Confirmed','CheckedIn','Completed','NoShow','Cancelled','Expired','Deleted')
    NOT NULL DEFAULT 'Pending',
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  INDEX idx_bookings_court_window (courtId, startAt, endAt),
  INDEX idx_bookings_venue_start (venueId, startAt),
  INDEX idx_bookings_status_hold (status, holdExpiresAt),
  INDEX idx_bookings_status_start (status, startAt),
  INDEX idx_bookings_checkoutId (checkoutId),
  CONSTRAINT fk_bookings_venue FOREIGN KEY (venueId) REFERENCES venues(venueId),
  CONSTRAINT fk_bookings_court FOREIGN KEY (courtId) REFERENCES courts(courtId),
  CONSTRAINT fk_bookings_session FOREIGN KEY (sessionId) REFERENCES recording_sessions(sessionId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE recording_sessions
  ADD COLUMN bookingId VARCHAR(50) NULL AFTER startedByPlayer,
  ADD UNIQUE INDEX uq_sessions_bookingId (bookingId),
  ADD CONSTRAINT fk_sessions_booking FOREIGN KEY (bookingId) REFERENCES bookings(bookingId);

ALTER TABLE payments
  MODIFY COLUMN method ENUM('CASH','ONLINE') NOT NULL DEFAULT 'CASH',
  ADD COLUMN bookingId VARCHAR(50) NULL AFTER sessionId,
  ADD COLUMN provider VARCHAR(30) NULL AFTER method,
  ADD COLUMN providerRef VARCHAR(100) NULL AFTER provider,
  ADD COLUMN providerRefundRef VARCHAR(100) NULL AFTER providerRef,
  ADD COLUMN refundError VARCHAR(255) NULL AFTER providerRefundRef,
  ADD UNIQUE INDEX uq_payments_providerRef (providerRef),
  ADD INDEX idx_payments_bookingId (bookingId),
  ADD CONSTRAINT fk_payments_booking FOREIGN KEY (bookingId) REFERENCES bookings(bookingId);

-- ── permission (idempotent; matches what setup-database.js seeds) ───────────
INSERT INTO permissions (permissionId, module, submodule, description, portal, status, dateCreated, dateUpdated)
SELECT UUID(), 'bookings', NULL, 'Court bookings', 'ADMIN', 'Active',
       CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'),
       CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE module = 'bookings' AND submodule IS NULL);

INSERT INTO role_permissions (roleId, permissionId, accessLevel, dateCreated)
SELECT r.roleId, p.permissionId, 'write', CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')
FROM roles r
CROSS JOIN permissions p
WHERE r.roleName = 'Owner'
  AND p.module = 'bookings' AND p.submodule IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.roleId = r.roleId AND rp.permissionId = p.permissionId
  );
