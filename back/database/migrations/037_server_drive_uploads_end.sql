-- 037_server_drive_uploads_end.sql
-- CR-040 Phase 4 / PLAN-005: the API no longer uploads anything to Google
-- Drive — the venue's recorder box sends each video there itself. Videos and
-- clips the API was still going to upload never will: mark them Skipped, so
-- Admin stops showing them as "uploading to Google Drive".

UPDATE session_videos
SET driveStatus = 'Skipped',
    driveError = 'Not sent to Google Drive — videos go there from the venue box now',
    driveNextAttemptAt = NULL
WHERE delivery = 'Server' AND driveStatus IN ('Pending', 'Uploading');

UPDATE clips
SET driveStatus = 'Skipped',
    driveError = 'Not sent to Google Drive — videos go there from the venue box now',
    driveNextAttemptAt = NULL
WHERE driveStatus IN ('Pending', 'Uploading');
