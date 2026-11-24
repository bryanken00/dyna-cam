-- 038_alert_box_outdated.sql
-- CR-040 Phase 4 / PLAN-005: a recorder box that can't send games straight to
-- Google Drive (it doesn't report "drive-direct") gets no game jobs; its games
-- wait until it's updated. Staff are told with a new alert kind.

ALTER TABLE venue_alerts
  MODIFY COLUMN kind ENUM('BOX_OFFLINE','CAMERA_DOWN','DISK_LOW','CLOCK_OFF','UPLOAD_BACKLOG','BOX_OUTDATED') NOT NULL;
