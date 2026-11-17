-- 002_create_clips.sql
-- PLAN-001 Phase 1: replay clips. A player (QR scan) or staff asks for the last
-- N seconds of a court; the venue's recorder box cuts the clip from its rolling
-- buffer, burns in the venue logo and uploads it.
-- Lifecycle: Pending → Processing → Ready → Expired (files removed by the
-- expiry sweep after the venue's clipRetentionDays), or Failed.
-- shareToken is the public, unguessable code in the player's link
-- (/clip/<shareToken>). videoPath / thumbnailPath are stored upload paths
-- (/public/uploads/...), always returned signed.
-- Adds the ADMIN permission clips (no submodule), granted to the Owner role.

CREATE TABLE IF NOT EXISTS clips (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  clipId VARCHAR(50) NOT NULL UNIQUE,
  venueId VARCHAR(50) NOT NULL,
  courtId VARCHAR(50) NOT NULL,
  source ENUM('QR','BUTTON','SESSION','STAFF') NOT NULL,
  requestedAt DATETIME NOT NULL,
  durationSeconds INT NOT NULL,
  shareToken VARCHAR(64) NOT NULL UNIQUE,
  videoPath VARCHAR(255) NULL,
  thumbnailPath VARCHAR(255) NULL,
  sizeBytes BIGINT NULL,
  deviceId VARCHAR(50) NULL,
  failureReason VARCHAR(255) NULL,
  expiresAt DATETIME NULL,
  status ENUM('Pending','Processing','Ready','Failed','Expired','Deleted') NOT NULL DEFAULT 'Pending',
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  INDEX idx_clips_venueId (venueId),
  INDEX idx_clips_court_requested (courtId, requestedAt),
  INDEX idx_clips_status_expires (status, expiresAt),
  INDEX idx_clips_dateCreated (dateCreated),
  CONSTRAINT fk_clips_venue FOREIGN KEY (venueId) REFERENCES venues(venueId),
  CONSTRAINT fk_clips_court FOREIGN KEY (courtId) REFERENCES courts(courtId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO permissions (permissionId, module, submodule, description, portal, status, dateCreated, dateUpdated)
SELECT UUID(), 'clips', NULL, 'Replay clips', 'ADMIN', 'Active',
       CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'),
       CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE module = 'clips' AND submodule IS NULL);

INSERT INTO role_permissions (roleId, permissionId, accessLevel, dateCreated)
SELECT r.roleId, p.permissionId, 'write', CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')
FROM roles r
CROSS JOIN permissions p
WHERE r.roleName = 'Owner'
  AND p.module = 'clips' AND p.submodule IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.roleId = r.roleId AND rp.permissionId = p.permissionId
  );
