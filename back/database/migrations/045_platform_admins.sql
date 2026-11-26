-- 045_platform_admins.sql
-- PLAN-008 phase B: the back office (/backoffice) — DGSports' own people ("super
-- admins") who onboard and manage companies. Kept apart from staff accounts on
-- purpose: their own table, their own sign-in and their own token audience
-- (utils/platformTokens.js), so a back-office token never passes a staff check and a
-- staff token never passes a back-office one. The first one is seeded by
-- `npm run db:setup` from SUPERADMIN_EMAIL (scripts/_seed-superadmin.js).
--
-- platform_admins                  one per super admin (email unique; Argon2 hash;
--                                  the same lockout and must-change-password rules as staff)
-- platform_admin_refresh_tokens    issued refresh tokens (rotation + reuse detection), by jti

CREATE TABLE IF NOT EXISTS platform_admins (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  platformAdminId VARCHAR(50) NOT NULL UNIQUE,
  firstName VARCHAR(50) NOT NULL,
  lastName VARCHAR(50) NOT NULL,
  email VARCHAR(100) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  status ENUM('Active','Inactive','Deleted') NOT NULL DEFAULT 'Active',
  mustChangePassword TINYINT(1) NOT NULL DEFAULT 0,
  failedLoginAttempts INT NOT NULL DEFAULT 0,
  lockedUntil DATETIME NULL,
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  INDEX idx_platform_admins_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_admin_refresh_tokens (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  jti VARCHAR(64) NOT NULL UNIQUE,
  platformAdminId VARCHAR(50) NOT NULL,
  expiresAt DATETIME NOT NULL,
  revokedAt DATETIME NULL,
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  INDEX idx_platform_refresh_admin (platformAdminId),
  CONSTRAINT fk_platform_refresh_admin FOREIGN KEY (platformAdminId)
    REFERENCES platform_admins(platformAdminId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
