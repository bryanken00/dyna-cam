-- 053_clubs_coaching.sql
-- PLAN-009 phase F: clubs and coaching.
--
-- clubs                 a venue's club (staff create it). publicToken is its link
--                       (/clubs/:publicToken). joinPolicy Open: a player who joins is in;
--                       Approval: staff (or a club admin) approve them first.
-- club_members          a player in a club: Pending (asked) · Active · Removed (left or taken
--                       out — joining again brings the row back). role Admin can approve.
-- play_sessions.clubId  an Open Play session (or clinic) only that club's Active members may join.
-- play_sessions.coachName / play_series.*  a clinic (kind 'Clinic') is a coached session: its coach.

CREATE TABLE IF NOT EXISTS clubs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  clubId VARCHAR(50) NOT NULL UNIQUE,
  venueId VARCHAR(50) NOT NULL,
  publicToken VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(1000) NULL,
  joinPolicy ENUM('Open','Approval') NOT NULL DEFAULT 'Open',
  createdByAccountId VARCHAR(50) NULL,
  status ENUM('Active','Inactive','Deleted') NOT NULL DEFAULT 'Active',
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  INDEX idx_clubs_venue (venueId, status),
  CONSTRAINT fk_clubs_venue FOREIGN KEY (venueId) REFERENCES venues(venueId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS club_members (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  clubMemberId VARCHAR(50) NOT NULL UNIQUE,
  clubId VARCHAR(50) NOT NULL,
  playerId VARCHAR(50) NOT NULL,
  role ENUM('Member','Admin') NOT NULL DEFAULT 'Member',
  status ENUM('Pending','Active','Removed') NOT NULL DEFAULT 'Pending',
  joinedAt DATETIME NULL,
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  UNIQUE INDEX uq_club_members_club_player (clubId, playerId),
  INDEX idx_club_members_player (playerId, status),
  CONSTRAINT fk_club_members_club FOREIGN KEY (clubId) REFERENCES clubs(clubId),
  CONSTRAINT fk_club_members_player FOREIGN KEY (playerId) REFERENCES players(playerId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE play_sessions
  ADD COLUMN clubId VARCHAR(50) NULL AFTER seriesId,
  ADD COLUMN coachName VARCHAR(100) NULL AFTER description,
  ADD INDEX idx_play_sessions_club (clubId),
  ADD CONSTRAINT fk_play_sessions_club FOREIGN KEY (clubId) REFERENCES clubs(clubId);

ALTER TABLE play_series
  ADD COLUMN clubId VARCHAR(50) NULL AFTER venueId,
  ADD COLUMN coachName VARCHAR(100) NULL AFTER description,
  ADD CONSTRAINT fk_play_series_club FOREIGN KEY (clubId) REFERENCES clubs(clubId);

-- ── permission (idempotent; matches what setup-database.js seeds) ───────────
INSERT INTO permissions (permissionId, module, submodule, description, portal, status, dateCreated, dateUpdated)
SELECT UUID(), 'clubs', NULL, 'Clubs', 'ADMIN', 'Active',
       CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'),
       CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE module = 'clubs' AND submodule IS NULL);

INSERT INTO role_permissions (roleId, permissionId, accessLevel, dateCreated)
SELECT r.roleId, p.permissionId, 'write', CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')
FROM roles r
CROSS JOIN permissions p
WHERE r.roleName = 'Owner'
  AND p.module = 'clubs' AND p.submodule IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.roleId = r.roleId AND rp.permissionId = p.permissionId
  );
