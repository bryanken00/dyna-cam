-- 044_companies.sql
-- PLAN-008: DGSports becomes multi-company (SaaS). A company is a client that DGSports
-- onboards from the back office; its staff use the Admin portal and see only their own
-- company's data.
--
-- companies         one per client. Xendit (PLAN-008 phase C): each company's own keys,
--                   encrypted (never returned), and the key in its own webhook URL.
-- venues.companyId  the venue's company; everything under a venue (courts, boxes, games,
--                   bookings, payments, clips, …) belongs to it through the venue
-- users.companyId   the company a staff account works for (one email = one company)
-- roles.companyId   roles are per company (each company has its own Owner role)
-- settings          per company: unique (companyId, settingKey) instead of settingKey
-- audit_trail       the company an entry belongs to (NULL: not a company's, e.g. a
--                   back-office action or a failed sign-in for an unknown email)
--
-- Switch-over: on an existing install, one "Default company" owns every existing row,
-- so today's deployment keeps working as one company. A fresh install gets no company:
-- `npm run db:setup` creates only the first super admin, who onboards companies in the
-- back office. Timestamps are Manila time (UTC + 8 h).

CREATE TABLE IF NOT EXISTS companies (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  companyId VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(60) NOT NULL UNIQUE,
  contactEmail VARCHAR(100) NULL,
  contactPhone VARCHAR(20) NULL,
  -- Phase C: the company's own Xendit account (AES-GCM, utils/crypto); NULL = not connected
  xenditSecretKeyEnc TEXT NULL,
  xenditCallbackTokenEnc TEXT NULL,
  xenditMode ENUM('test','live') NULL,
  xenditWebhookKey VARCHAR(64) NULL UNIQUE,
  status ENUM('Active','Suspended','Deleted') NOT NULL DEFAULT 'Active',
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL,
  INDEX idx_companies_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO companies (companyId, name, slug, status, dateCreated, dateUpdated)
SELECT UUID(), 'Default company', 'default', 'Active',
       UTC_TIMESTAMP() + INTERVAL 8 HOUR, UTC_TIMESTAMP() + INTERVAL 8 HOUR
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM companies WHERE slug = 'default')
  AND (EXISTS (SELECT 1 FROM users) OR EXISTS (SELECT 1 FROM roles)
       OR EXISTS (SELECT 1 FROM venues) OR EXISTS (SELECT 1 FROM settings)
       OR EXISTS (SELECT 1 FROM audit_trail));

-- NULL on a fresh install: the backfills below then touch no rows
SET @defaultCompany = (SELECT companyId FROM companies WHERE slug = 'default');

-- ── venues ──────────────────────────────────────────────────────────────────
ALTER TABLE venues ADD COLUMN companyId VARCHAR(50) NULL AFTER venueId;
UPDATE venues SET companyId = @defaultCompany WHERE companyId IS NULL;
ALTER TABLE venues
  MODIFY companyId VARCHAR(50) NOT NULL,
  ADD INDEX idx_venues_companyId (companyId),
  ADD CONSTRAINT fk_venues_company FOREIGN KEY (companyId) REFERENCES companies(companyId);

-- ── roles ───────────────────────────────────────────────────────────────────
ALTER TABLE roles ADD COLUMN companyId VARCHAR(50) NULL AFTER roleId;
UPDATE roles SET companyId = @defaultCompany WHERE companyId IS NULL;
ALTER TABLE roles
  MODIFY companyId VARCHAR(50) NOT NULL,
  ADD INDEX idx_roles_company_name (companyId, roleName),
  ADD CONSTRAINT fk_roles_company FOREIGN KEY (companyId) REFERENCES companies(companyId);

-- ── users ───────────────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN companyId VARCHAR(50) NULL AFTER accountId;
UPDATE users SET companyId = @defaultCompany WHERE companyId IS NULL;
ALTER TABLE users
  MODIFY companyId VARCHAR(50) NOT NULL,
  ADD INDEX idx_users_companyId (companyId),
  ADD CONSTRAINT fk_users_company FOREIGN KEY (companyId) REFERENCES companies(companyId);

-- ── settings: per company ───────────────────────────────────────────────────
ALTER TABLE settings ADD COLUMN companyId VARCHAR(50) NULL AFTER id;
UPDATE settings SET companyId = @defaultCompany WHERE companyId IS NULL;
ALTER TABLE settings
  MODIFY companyId VARCHAR(50) NOT NULL,
  DROP INDEX settingKey,
  ADD UNIQUE INDEX uq_settings_company_key (companyId, settingKey),
  ADD CONSTRAINT fk_settings_company FOREIGN KEY (companyId) REFERENCES companies(companyId);

-- ── audit_trail ─────────────────────────────────────────────────────────────
ALTER TABLE audit_trail ADD COLUMN companyId VARCHAR(50) NULL AFTER auditId;
UPDATE audit_trail a
  LEFT JOIN users u ON u.accountId = a.accountId
SET a.companyId = COALESCE(u.companyId, @defaultCompany)
WHERE a.companyId IS NULL;
ALTER TABLE audit_trail
  ADD INDEX idx_audit_trail_company_date (companyId, dateCreated);
