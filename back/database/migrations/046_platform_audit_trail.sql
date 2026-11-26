-- 046_platform_audit_trail.sql
-- PLAN-008 phase E: the back office's own audit trail — every super-admin action
-- (sign-in, failed sign-in, lockout, sign-out, password change, company onboarding /
-- edits / suspend / reactivate / Owner password reset, super-admin management).
-- Kept apart from audit_trail, which belongs to companies (each company's Owner sees
-- its own); a company action is ALSO written to that company's audit_trail with the
-- actor "dgsports" (module "company"), so the company sees what DGSports did.
--
-- platformAdminId  who did it; NULL for a failed sign-in with an unknown email
-- companyId        the company acted on (NULL: not about a company)
-- metadata         never passwords, tokens or secrets (utils/platformAudit.js redacts)

CREATE TABLE IF NOT EXISTS platform_audit_trail (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  auditId VARCHAR(50) NOT NULL UNIQUE,
  platformAdminId VARCHAR(50) NULL,
  action VARCHAR(100) NOT NULL,
  companyId VARCHAR(50) NULL,
  description TEXT NULL,
  metadata JSON NULL,
  ipAddress VARCHAR(45) NULL,
  userAgent TEXT NULL,
  dateCreated DATETIME NOT NULL,
  INDEX idx_platform_audit_date (dateCreated),
  INDEX idx_platform_audit_company (companyId),
  INDEX idx_platform_audit_admin (platformAdminId),
  CONSTRAINT fk_platform_audit_company FOREIGN KEY (companyId) REFERENCES companies(companyId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
