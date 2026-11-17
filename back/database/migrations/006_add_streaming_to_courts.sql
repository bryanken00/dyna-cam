-- 006_add_streaming_to_courts.sql
-- PLAN-001 Phase 5: live streaming. A court can be restreamed by the venue's
-- recorder box to an RTMP target (YouTube / Facebook Live ingest URL + stream
-- key). The box sends it over the SAME camera connection it records from — a
-- Tapo C200 serves only one RTSP client at a time (tested 2026-11-17).
--
-- streamRtmpUrl holds the ingest URL including the stream key, encrypted with
-- DEVICE_SECRET_KEY like cameraRtspUrl, and is never returned to the Admin
-- portal. streamWatchUrl is the public page players open to watch.

ALTER TABLE courts
  ADD COLUMN streamEnabled TINYINT(1) NOT NULL DEFAULT 0 AFTER buttonCode,
  ADD COLUMN streamRtmpUrl TEXT NULL AFTER streamEnabled,
  ADD COLUMN streamWatchUrl VARCHAR(255) NULL AFTER streamRtmpUrl;
