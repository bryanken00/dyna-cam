-- 008_add_device_pairing.sql
-- PLAN-002 Phase B: 6-digit pairing keys. Staff create a short, single-use,
-- 10-minute key in the Admin portal; a staff phone (kind APP) or a recorder box
-- (kind RECORDER) exchanges it once for its own long-lived token, so nobody
-- copies a token by hand. Only a keyed hash of the key is stored.
--
-- paired_apps: staff phones paired to one venue — they open straight to that
-- venue's courts (Record → QR), can re-show a clip's QR and take cash, with no
-- staff login. Revoking one stops it at its next request.
-- clips.pairedAppId / payments.pairedAppId record which phone saved the clip /
-- took the cash.
-- Adds the ADMIN permission paired_apps, granted to the Owner role.

CREATE TABLE IF NOT EXISTS pairing_codes (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  pairingCodeId VARCHAR(50) NOT NULL UNIQUE,
  kind ENUM('APP','RECORDER') NOT NULL,
  venueId VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  codeHash CHAR(64) NOT NULL,
  expiresAt DATETIME NOT NULL,
  usedAt DATETIME NULL,
  resultId VARCHAR(50) NULL,
  createdByAccountId VARCHAR(50) NULL,
  status ENUM('Active','Used','Expired','Cancelled') NOT NULL DEFAULT 'Active',
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  INDEX idx_pairing_codes_hash_status (codeHash, status),
  INDEX idx_pairing_codes_venue_kind (venueId, kind, status),
  CONSTRAINT fk_pairing_codes_venue FOREIGN KEY (venueId) REFERENCES venues(venueId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS paired_apps (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  pairedAppId VARCHAR(50) NOT NULL UNIQUE,
  venueId VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  tokenHash CHAR(64) NOT NULL UNIQUE,
  platform VARCHAR(30) NULL,
  appVersion VARCHAR(50) NULL,
  lastSeenAt DATETIME NULL,
  pairedByAccountId VARCHAR(50) NULL,
  status ENUM('Active','Revoked','Deleted') NOT NULL DEFAULT 'Active',
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  INDEX idx_paired_apps_venueId (venueId),
  INDEX idx_paired_apps_status (status),
  CONSTRAINT fk_paired_apps_venue FOREIGN KEY (venueId) REFERENCES venues(venueId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE clips
  ADD COLUMN pairedAppId VARCHAR(50) NULL AFTER deviceId,
  ADD CONSTRAINT fk_clips_paired_app FOREIGN KEY (pairedAppId) REFERENCES paired_apps(pairedAppId);

ALTER TABLE payments
  ADD COLUMN pairedAppId VARCHAR(50) NULL AFTER receivedByAccountId,
  ADD CONSTRAINT fk_payments_paired_app FOREIGN KEY (pairedAppId) REFERENCES paired_apps(pairedAppId);

INSERT INTO permissions (permissionId, module, submodule, description, portal, status, dateCreated, dateUpdated)
SELECT UUID(), 'paired_apps', NULL, 'Paired staff phones (pairing keys)', 'ADMIN', 'Active',
       CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'),
       CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE module = 'paired_apps' AND submodule IS NULL);

INSERT INTO role_permissions (roleId, permissionId, accessLevel, dateCreated)
SELECT r.roleId, p.permissionId, 'write', CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')
FROM roles r
CROSS JOIN permissions p
WHERE r.roleName = 'Owner'
  AND p.module = 'paired_apps' AND p.submodule IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.roleId = r.roleId AND rp.permissionId = p.permissionId
  );
