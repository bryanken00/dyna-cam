-- 018_game_file_uploads.sql
-- CR-006: a game travels as ONE file per camera. After End game the recorder
-- box copies the whole game into one mp4 and uploads it in chunks (resumable);
-- no 5-minute pieces and no joining on the server any more.
--
-- session_videos
--  • status 'Uploading': the box has started sending the file
--  • uploadBytes / receivedBytes: the file's size and how much has arrived
--    (the player's "uploading N%"; a resumed upload continues from here)
--  • deviceId: the box sending it (another box of the venue is refused)
--  • durationSeconds / gaps (existing): what the box reports at the start
--  • lastChunkAt: live progress, not an edit (dateUpdated is left alone)

ALTER TABLE session_videos
  MODIFY COLUMN status ENUM('Pending','Uploading','Joining','Ready','Failed','Expired','Deleted')
    NOT NULL DEFAULT 'Pending',
  ADD COLUMN uploadBytes BIGINT NULL AFTER sizeBytes,
  ADD COLUMN receivedBytes BIGINT NOT NULL DEFAULT 0 AFTER uploadBytes,
  ADD COLUMN deviceId VARCHAR(50) NULL AFTER receivedBytes,
  ADD COLUMN lastChunkAt DATETIME NULL AFTER deviceId;
