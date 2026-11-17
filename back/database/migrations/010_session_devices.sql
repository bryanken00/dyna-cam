-- 010_session_devices.sql
-- PLAN-002 Phase E: a staff phone/tablet is paired to ONE recording session
-- (not to a venue). It shows that session live — video from the venue's
-- recorder box over the LAN — with the game's download QR, and is unpaired 10
-- minutes after the session ends.
--
--  • pairing_codes.sessionId / paired_apps.sessionId: the session an APP key and
--    a paired device belong to (RECORDER keys and boxes leave it NULL).
--  • devices.liveUrl: the box's LAN address for the live view
--    (http://<ip>:8090); devices.liveKey: the key the API signs live-view links
--    with, encrypted like camera URLs (utils/crypto/secretBox.js), never returned.
--  • Venue-wide paired phones (no session) are revoked and their unused keys
--    cancelled; the paired_apps permission (Paired Apps page) is retired
--    (Inactive — permissions have no Deleted status).

ALTER TABLE pairing_codes
  ADD COLUMN sessionId VARCHAR(50) NULL AFTER venueId,
  ADD CONSTRAINT fk_pairing_codes_session FOREIGN KEY (sessionId) REFERENCES recording_sessions(sessionId);

ALTER TABLE paired_apps
  ADD COLUMN sessionId VARCHAR(50) NULL AFTER venueId,
  ADD INDEX idx_paired_apps_session (sessionId, status),
  ADD CONSTRAINT fk_paired_apps_session FOREIGN KEY (sessionId) REFERENCES recording_sessions(sessionId);

ALTER TABLE devices
  ADD COLUMN liveUrl VARCHAR(255) NULL AFTER lastStatus,
  ADD COLUMN liveKey TEXT NULL AFTER liveUrl;

UPDATE paired_apps
SET status = 'Revoked', dateUpdated = CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')
WHERE sessionId IS NULL AND status = 'Active';

UPDATE pairing_codes
SET status = 'Cancelled', dateUpdated = CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')
WHERE kind = 'APP' AND sessionId IS NULL AND status = 'Active';

UPDATE permissions
SET status = 'Inactive', dateUpdated = CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')
WHERE module = 'paired_apps' AND submodule IS NULL;
