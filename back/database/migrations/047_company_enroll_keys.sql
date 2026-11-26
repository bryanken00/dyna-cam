-- 047_company_enroll_keys.sql
-- PLAN-008 phase F: each company's own recorder-box enroll key, made by a super admin in
-- the back office (company page → Generate enroll key) and shown once. Replaces the one
-- shared RECORDER_ENROLL_KEY: a key enrols a box only into a venue of its own company.
--
-- enrollKeyHash       hex SHA-256 of the key (utils/crypto/tokens.js hashToken) — the key
--                     itself is never stored; NULL = no key (the company can't enrol boxes)
-- enrollKeyCreatedAt  when the current key was made (Regenerate replaces it; boxes already
--                     enrolled keep working with their own device token)

ALTER TABLE companies
  ADD COLUMN enrollKeyHash VARCHAR(64) NULL AFTER xenditWebhookKey,
  ADD COLUMN enrollKeyCreatedAt DATETIME NULL AFTER enrollKeyHash,
  ADD UNIQUE INDEX uq_companies_enrollKeyHash (enrollKeyHash);
