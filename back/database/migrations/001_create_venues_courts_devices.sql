-- 001_create_venues_courts_devices.sql
-- PLAN-001 Phase 1: venues (pickleball venues), their courts (one camera each),
-- and the on-site recorder boxes ("devices") that record those cameras.
-- Adds the ADMIN permissions venues/list, venues/courts and venues/devices,
-- granted to the Owner role at write level.
-- MySQL DDL auto-commits per statement — keep this migration focused.

-- ── venues ──────────────────────────────────────────────────────────────────
-- logoUrl is an uploaded image's stored path (/public/uploads/...), burned into
-- every clip as a watermark. clipRetentionDays: how long a saved clip stays
-- downloadable before the expiry sweep removes its files.
CREATE TABLE IF NOT EXISTS venues (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  venueId VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  address VARCHAR(255) NULL,
  phone VARCHAR(20) NULL,
  logoUrl VARCHAR(255) NULL,
  clipRetentionDays INT NOT NULL DEFAULT 30,
  status ENUM('Active','Inactive','Deleted') NOT NULL DEFAULT 'Active',
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  INDEX idx_venues_status (status),
  INDEX idx_venues_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── courts ──────────────────────────────────────────────────────────────────
-- cameraRtspUrl holds the camera's RTSP URL (it usually embeds the camera's
-- username and password) encrypted with DEVICE_SECRET_KEY — see
-- server/src/utils/crypto/secretBox.js. It is never returned to the Admin
-- portal, only to the venue's own authenticated recorder box.
-- qrToken is the public, unguessable code printed on the court's QR sign
-- (/court/<qrToken>); rotating it retires old signs.
CREATE TABLE IF NOT EXISTS courts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  courtId VARCHAR(50) NOT NULL UNIQUE,
  venueId VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  cameraRtspUrl TEXT NULL,
  qrToken VARCHAR(64) NOT NULL UNIQUE,
  status ENUM('Active','Inactive','Deleted') NOT NULL DEFAULT 'Active',
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  INDEX idx_courts_venueId (venueId),
  INDEX idx_courts_status (status),
  CONSTRAINT fk_courts_venue FOREIGN KEY (venueId) REFERENCES venues(venueId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── devices (recorder boxes) ────────────────────────────────────────────────
-- A box authenticates with "Authorization: Device <token>"; only the token's
-- SHA-256 is stored. lastSeenAt/agentVersion/lastStatus come from its
-- heartbeat (lastStatus: per-court camera health as JSON).
CREATE TABLE IF NOT EXISTS devices (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  deviceId VARCHAR(50) NOT NULL UNIQUE,
  venueId VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  tokenHash CHAR(64) NOT NULL UNIQUE,
  lastSeenAt DATETIME NULL,
  agentVersion VARCHAR(50) NULL,
  lastStatus JSON NULL,
  status ENUM('Active','Revoked','Deleted') NOT NULL DEFAULT 'Active',
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  INDEX idx_devices_venueId (venueId),
  INDEX idx_devices_status (status),
  CONSTRAINT fk_devices_venue FOREIGN KEY (venueId) REFERENCES venues(venueId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── permissions (idempotent; matches what setup-database.js seeds) ──────────
INSERT INTO permissions (permissionId, module, submodule, description, portal, status, dateCreated, dateUpdated)
SELECT UUID(), 'venues', 'list', 'Venues management', 'ADMIN', 'Active',
       CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'),
       CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE module = 'venues' AND submodule = 'list');

INSERT INTO permissions (permissionId, module, submodule, description, portal, status, dateCreated, dateUpdated)
SELECT UUID(), 'venues', 'courts', 'Courts and cameras management', 'ADMIN', 'Active',
       CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'),
       CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE module = 'venues' AND submodule = 'courts');

INSERT INTO permissions (permissionId, module, submodule, description, portal, status, dateCreated, dateUpdated)
SELECT UUID(), 'venues', 'devices', 'Recorder boxes management', 'ADMIN', 'Active',
       CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'),
       CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE module = 'venues' AND submodule = 'devices');

-- Grant all three to the Owner role at write level
INSERT INTO role_permissions (roleId, permissionId, accessLevel, dateCreated)
SELECT r.roleId, p.permissionId, 'write', CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')
FROM roles r
CROSS JOIN permissions p
WHERE r.roleName = 'Owner'
  AND p.module = 'venues' AND p.submodule IN ('list', 'courts', 'devices')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.roleId = r.roleId AND rp.permissionId = p.permissionId
  );
