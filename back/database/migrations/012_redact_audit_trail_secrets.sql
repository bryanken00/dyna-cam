-- 012_redact_audit_trail_secrets.sql
-- BUG-001: the audit trail copied request bodies with camera addresses
-- (rtsp://user:password@…) and live-stream addresses (rtmp://…/<stream key>) in
-- plain text. The middleware now masks them (utils/redact.js); this removes
-- the ones already stored. The rest of each audit row is kept.

UPDATE audit_trail
SET metadata = JSON_REMOVE(metadata, '$.body.cameraRtspUrl')
WHERE JSON_CONTAINS_PATH(metadata, 'one', '$.body.cameraRtspUrl');

UPDATE audit_trail
SET metadata = JSON_REMOVE(metadata, '$.body.streamRtmpUrl')
WHERE JSON_CONTAINS_PATH(metadata, 'one', '$.body.streamRtmpUrl');

UPDATE audit_trail
SET metadata = JSON_REMOVE(metadata, '$.body.streamKey')
WHERE JSON_CONTAINS_PATH(metadata, 'one', '$.body.streamKey');

UPDATE audit_trail
SET metadata = JSON_REMOVE(metadata, '$.body.url')
WHERE JSON_CONTAINS_PATH(metadata, 'one', '$.body.url')
  AND (JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.body.url')) LIKE 'rtmp%'
    OR JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.body.url')) LIKE 'rtsp%');
