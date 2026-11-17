-- 005_add_clip_payments.sql
-- PLAN-001 Phase 4: paid clips, cash only for now (online payment deferred).
-- A venue sets a clip price (0 = free). A player's clip (QR / button) gets that
-- price; until it is paid the player sees only the thumbnail and a short pay
-- code to show at the front desk, where staff record the cash payment.
-- Staff saves and session parts are always free.
-- Adds the ADMIN permission payments, granted to the Owner role.

ALTER TABLE venues
  ADD COLUMN clipPrice DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER clipRetentionDays;

ALTER TABLE clips
  ADD COLUMN price DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER durationSeconds,
  ADD COLUMN paymentStatus ENUM('Free','Unpaid','Paid') NOT NULL DEFAULT 'Free' AFTER price,
  ADD COLUMN payCode VARCHAR(12) NULL AFTER paymentStatus,
  ADD UNIQUE INDEX uq_clips_payCode (payCode),
  ADD INDEX idx_clips_paymentStatus (paymentStatus);

-- One row per payment taken. method is CASH today; a later migration can add
-- online providers. Refunding a payment locks the clip again.
CREATE TABLE IF NOT EXISTS payments (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  paymentId VARCHAR(50) NOT NULL UNIQUE,
  clipId VARCHAR(50) NOT NULL,
  venueId VARCHAR(50) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  method ENUM('CASH') NOT NULL DEFAULT 'CASH',
  receivedByAccountId VARCHAR(50) NULL,
  note VARCHAR(255) NULL,
  status ENUM('Paid','Refunded') NOT NULL DEFAULT 'Paid',
  paidAt DATETIME NOT NULL,
  refundedAt DATETIME NULL,
  refundedByAccountId VARCHAR(50) NULL,
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  INDEX idx_payments_clipId (clipId),
  INDEX idx_payments_venue_paidAt (venueId, paidAt),
  INDEX idx_payments_status (status),
  CONSTRAINT fk_payments_clip FOREIGN KEY (clipId) REFERENCES clips(clipId),
  CONSTRAINT fk_payments_venue FOREIGN KEY (venueId) REFERENCES venues(venueId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO permissions (permissionId, module, submodule, description, portal, status, dateCreated, dateUpdated)
SELECT UUID(), 'payments', NULL, 'Clip payments (cash)', 'ADMIN', 'Active',
       CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'),
       CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE module = 'payments' AND submodule IS NULL);

INSERT INTO role_permissions (roleId, permissionId, accessLevel, dateCreated)
SELECT r.roleId, p.permissionId, 'write', CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')
FROM roles r
CROSS JOIN permissions p
WHERE r.roleName = 'Owner'
  AND p.module = 'payments' AND p.submodule IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.roleId = r.roleId AND rp.permissionId = p.permissionId
  );
