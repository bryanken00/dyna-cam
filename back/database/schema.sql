-- ============================================================================
-- Database Schema — THE BASELINE
--
-- This file IS the schema and IS applied. `scripts/migrate.js` runs it first
-- (recorded in `_migrations` as `schema.sql`), then applies any numbered files
-- in database/migrations/ on top. Reached via `npm run db:migrate`, or
-- db:setup / db:setup:clean which migrate then seed.
--
-- Every statement is CREATE TABLE IF NOT EXISTS, so re-running it against an
-- already-provisioned database is a no-op.
--
-- ⚠️  Editing this file only affects databases provisioned from scratch — an
--     existing database has already recorded it as applied and will never
--     re-run it. To change a live schema, add a numbered migration in
--     database/migrations/ (001_*.sql, 002_*.sql, …) AND edit this file to
--     match, so the two never drift.
--
-- Conventions: every table has a surrogate `id BIGINT AUTO_INCREMENT` plus a
-- business ID (`varchar`, the value used in the API/URLs/FKs); timestamps are
-- DATETIME stored in Asia/Manila local time; rows are soft-deleted via
-- `status = 'Deleted'`, never physically removed.
--
-- Tables are ordered so inline FOREIGN KEY references always point at an
-- already-created table. FKs reference the business ID column (UNIQUE), never
-- the surrogate `id`. Default ON DELETE RESTRICT is intentional — with soft
-- deletes it never fires in normal operation but blocks accidental hard deletes
-- that would orphan children.
-- ============================================================================

-- ── Roles & users ───────────────────────────────────────────────────────────

-- `idx_roles_roleName` supports the constant `roleName != 'Owner'` filtering.
-- The Owner role is created by the setup script and holds every permission; it
-- is never listed or editable in the Admin portal.
CREATE TABLE IF NOT EXISTS roles (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  roleId VARCHAR(50) NOT NULL UNIQUE,
  roleName VARCHAR(50) NOT NULL,
  description TEXT NULL,
  status ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  INDEX idx_roles_roleName (roleName),
  INDEX idx_roles_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  accountId VARCHAR(50) NOT NULL UNIQUE,
  firstName VARCHAR(50) NOT NULL,
  lastName VARCHAR(50) NOT NULL,
  phone VARCHAR(20) NULL,
  imageUrl VARCHAR(255) NULL,
  signature VARCHAR(255) NULL,
  roleId VARCHAR(50) NOT NULL,
  status ENUM('Active','Inactive','Suspended','Deleted') NOT NULL DEFAULT 'Active',
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  INDEX idx_users_roleId (roleId),
  INDEX idx_users_status (status),
  CONSTRAINT fk_users_role FOREIGN KEY (roleId) REFERENCES roles(roleId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Auth ────────────────────────────────────────────────────────────────────

-- Sign-in credentials, one row per users row (keyed by accountId). Argon2's
-- encoded hash embeds the salt, so there is no separate salt column. See
-- utils/hashing/argonHash.js.
-- `mustChangePassword = 1` marks a password the account holder did not choose
-- (e.g. the seeded Owner). While set, the API refuses everything except
-- the auth routes; changing or resetting the password clears it.
-- `failedLoginAttempts` / `lockedUntil` implement the per-account lockout: too
-- many wrong passwords in a row lock sign-in until `lockedUntil` (Manila local).
-- A successful sign-in or a password reset clears both. See utils/loginLockout.js.
CREATE TABLE IF NOT EXISTS credentials (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  accountId VARCHAR(50) NOT NULL UNIQUE,
  email VARCHAR(100) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  type ENUM('ADMIN','USER') NOT NULL,
  status ENUM('Active','Inactive','Suspended','Deleted') NOT NULL DEFAULT 'Active',
  mustChangePassword TINYINT(1) NOT NULL DEFAULT 0,
  failedLoginAttempts INT NOT NULL DEFAULT 0,
  lockedUntil DATETIME NULL,
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Issued refresh tokens, keyed by the JWT's jti claim. Enables rotation (every
-- /refresh revokes the presented token), reuse detection, and logout
-- revocation. accountId is a users.accountId (not enforced by an FK).
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  jti VARCHAR(64) NOT NULL UNIQUE,
  accountId VARCHAR(50) NOT NULL,
  expiresAt DATETIME NOT NULL,
  revokedAt DATETIME NULL,
  replacedByJti VARCHAR(64) NULL,
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  INDEX idx_refresh_tokens_accountId (accountId),
  INDEX idx_refresh_tokens_expiresAt (expiresAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Single-use, TTL'd tokens for the forgot/reset-password flow. Only the SHA-256
-- hash of the token is stored (the plaintext lives only in the emailed link).
-- No FK on accountId, matching refresh_tokens.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  tokenHash VARCHAR(64) NOT NULL UNIQUE,
  accountId VARCHAR(50) NOT NULL,
  expiresAt DATETIME NOT NULL,
  usedAt DATETIME NULL,
  dateCreated DATETIME NOT NULL,
  INDEX idx_password_reset_tokens_accountId (accountId),
  INDEX idx_password_reset_tokens_expiresAt (expiresAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Permissions ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS permissions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  permissionId VARCHAR(50) NOT NULL UNIQUE,
  module VARCHAR(50) NOT NULL,
  submodule VARCHAR(50) NULL,
  description TEXT NULL,
  portal ENUM('ADMIN') NOT NULL DEFAULT 'ADMIN',
  status ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  roleId VARCHAR(50) NOT NULL,
  permissionId VARCHAR(50) NOT NULL,
  accessLevel ENUM('read','write') NOT NULL,
  dateCreated DATETIME NOT NULL,
  INDEX idx_role_permissions_roleId (roleId),
  INDEX idx_role_permissions_permissionId (permissionId),
  CONSTRAINT fk_rp_role       FOREIGN KEY (roleId)       REFERENCES roles(roleId),
  CONSTRAINT fk_rp_permission FOREIGN KEY (permissionId) REFERENCES permissions(permissionId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_permissions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  userPermissionId VARCHAR(50) NOT NULL UNIQUE,
  accountId VARCHAR(50) NOT NULL,
  permissionId VARCHAR(50) NOT NULL,
  accessLevel ENUM('none','read','write') NOT NULL DEFAULT 'read',
  dateCreated DATETIME NOT NULL,
  INDEX idx_user_permissions_accountId (accountId),
  INDEX idx_user_permissions_permissionId (permissionId),
  CONSTRAINT fk_up_user       FOREIGN KEY (accountId)    REFERENCES users(accountId),
  CONSTRAINT fk_up_permission FOREIGN KEY (permissionId) REFERENCES permissions(permissionId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Settings ────────────────────────────────────────────────────────────────

-- Generic application-wide key/value store. One row per settingKey. Values are
-- text (JSON-encoded by the controller when needed).
CREATE TABLE IF NOT EXISTS settings (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  settingKey VARCHAR(100) NOT NULL UNIQUE,
  settingValue TEXT NULL,
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Infrastructure ──────────────────────────────────────────────────────────

-- Cached responses for mutation requests carrying an Idempotency-Key header
-- (see middlewares/idempotency.middleware.js). Rows are immutable and TTL'd.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  idempotencyKey VARCHAR(100) NOT NULL UNIQUE,
  requestHash VARCHAR(64) NOT NULL,
  responseCode INT NOT NULL,
  responseBody JSON NULL,
  dateCreated DATETIME NOT NULL,
  expiresAt DATETIME NOT NULL,
  INDEX idx_idempotency_keys_expiresAt (expiresAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Audit rows must outlive their referents, so this table intentionally has no
-- foreign keys.
CREATE TABLE IF NOT EXISTS audit_trail (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  auditId VARCHAR(50) NOT NULL UNIQUE,
  accountId VARCHAR(50) NOT NULL,
  action VARCHAR(100) NOT NULL,
  module VARCHAR(50) NOT NULL,
  description TEXT NULL,
  metadata JSON NULL,
  ipAddress VARCHAR(45) NULL,
  userAgent TEXT NULL,
  dateCreated DATETIME NOT NULL,
  INDEX idx_audit_trail_accountId (accountId),
  INDEX idx_audit_trail_dateCreated (dateCreated)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
