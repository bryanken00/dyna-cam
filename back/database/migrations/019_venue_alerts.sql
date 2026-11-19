-- 019_venue_alerts.sql
-- CR-008: venue health problems and staff alerts.
--
-- A problem (a box offline, a camera not recording, a box's disk almost full,
-- its clock off, its uploads piling up) is found by the venue-alerts job from
-- the recorder boxes' heartbeats. It starts Pending; once it has lasted the
-- grace period it becomes Open and is sent to staff: the Discord channel
-- (ALERT_DISCORD_WEBHOOK_URL) and, once SMTP is set up, an email to everyone
-- with the `alerts` permission. When it clears, an Open problem becomes
-- Resolved (sent as fixed) and a Pending one Cleared (it never reached anyone).
-- Rows are kept as the venue's history.
--
--  • alertKey: what the problem is about, e.g. CAMERA_DOWN:<deviceId>:<courtId>:2.
--    activeKey repeats it only while the problem is Pending or Open, so there is
--    at most one live row per problem (NULLs don't clash in a UNIQUE index).
--  • firstSeenAt: when the job first saw it; openedAt: when it became Open.
--  • notifiedAt / resolvedNotifiedAt: when a channel (Discord or email) took the
--    message (NULL = not sent, e.g. neither is configured).

CREATE TABLE IF NOT EXISTS venue_alerts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  alertId VARCHAR(50) NOT NULL UNIQUE,
  venueId VARCHAR(50) NOT NULL,
  deviceId VARCHAR(50) NULL,
  courtId VARCHAR(50) NULL,
  camera TINYINT NULL,
  kind ENUM('BOX_OFFLINE','CAMERA_DOWN','DISK_LOW','CLOCK_OFF','UPLOAD_BACKLOG') NOT NULL,
  alertKey VARCHAR(191) NOT NULL,
  activeKey VARCHAR(191) GENERATED ALWAYS AS
    (IF(status IN ('Pending','Open'), alertKey, NULL)) STORED,
  message VARCHAR(255) NOT NULL,
  status ENUM('Pending','Open','Resolved','Cleared') NOT NULL DEFAULT 'Pending',
  firstSeenAt DATETIME NOT NULL,
  openedAt DATETIME NULL,
  resolvedAt DATETIME NULL,
  notifiedAt DATETIME NULL,
  resolvedNotifiedAt DATETIME NULL,
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  UNIQUE INDEX uq_venue_alerts_active (activeKey),
  INDEX idx_venue_alerts_status (status),
  INDEX idx_venue_alerts_venue_status (venueId, status),
  CONSTRAINT fk_venue_alerts_venue FOREIGN KEY (venueId) REFERENCES venues(venueId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- read = sees the open problems on the Dashboard and gets the alert emails
INSERT INTO permissions (permissionId, module, submodule, description, portal, status, dateCreated, dateUpdated)
SELECT UUID(), 'alerts', NULL, 'Venue alerts (open problems and alert emails)', 'ADMIN', 'Active',
       CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'),
       CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE module = 'alerts' AND submodule IS NULL);

INSERT INTO role_permissions (roleId, permissionId, accessLevel, dateCreated)
SELECT r.roleId, p.permissionId, 'write', CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')
FROM roles r
CROSS JOIN permissions p
WHERE r.roleName = 'Owner'
  AND p.module = 'alerts' AND p.submodule IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.roleId = r.roleId AND rp.permissionId = p.permissionId
  );
