-- 014_recorder_boxes_env_only.sql
-- PLAN-002 Phase I: recorder boxes are set up from .env only — they enrol with
-- RECORDER_ENROLL_KEY (POST /api/v1/pair/enroll) and are listed / revoked with
-- `npm run boxes` on the API server. The Recorder Boxes page and its
-- permission are retired; unused box pairing keys are cancelled. Existing
-- boxes keep their tokens and keep working.

UPDATE permissions
SET status = 'Inactive', dateUpdated = CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')
WHERE module = 'venues' AND submodule = 'devices';

UPDATE pairing_codes
SET status = 'Cancelled', dateUpdated = CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')
WHERE kind = 'RECORDER' AND status = 'Active';
