import { signedDownloadUrl, signUploadUrl } from "./file/signedUrl.js";

/**
 * Whole-game videos (CR-003, CR-006): one per game and camera — camera 0 on a
 * one-camera court, 1 and 2 on a two-camera court. The recorder box copies the
 * game into one file after End game and uploads it in chunks
 * (controllers/v1/device/game-videos.controller.js).
 *
 * Status: Pending (the box is making the file) → Uploading → Ready, or Failed;
 * Ready → Expired after the venue's retention days.
 */

/** What players and staff call a camera's whole video. */
export const CAMERA_LABEL = { 0: "Whole game", 1: "Cam 1", 2: "Cam 2" };

const parseGaps = (gaps) => {
  if (!gaps) return [];
  try {
    return typeof gaps === "string" ? JSON.parse(gaps) : gaps;
  } catch {
    return [];
  }
};

/** 0–100 while uploading, 100 once Ready, null before the box starts sending. */
const percentOf = (row) => {
  if (row.status === "Ready") return 100;
  const size = Number(row.uploadBytes) || 0;
  if (!size) return null;
  return Math.min(100, Math.floor(((Number(row.receivedBytes) || 0) / size) * 100));
};

/**
 * A whole video as the player's page shows it. Making and sending it is
 * "Saving" to the player. Links only while Ready; the Drive copy also after
 * the server's copy expired.
 */
export const toPublicVideo = (row) => {
  const ready = row.status === "Ready";
  return {
    camera: row.camera,
    label: CAMERA_LABEL[row.camera] || `Cam ${row.camera}`,
    status: ["Pending", "Uploading", "Joining"].includes(row.status) ? "Saving" : row.status,
    uploadPercent: percentOf(row),
    durationSeconds: row.durationSeconds ?? null,
    sizeBytes: row.sizeBytes ?? null,
    gaps: parseGaps(row.gaps),
    expiresAt: ready ? row.expiresAt : null,
    videoUrl: ready ? signUploadUrl(row.videoPath) : null,
    downloadUrl: ready ? signedDownloadUrl(row.videoPath) : null,
    thumbnailUrl: ready ? signUploadUrl(row.thumbnailPath) : null,
    driveUrl:
      row.driveStatus === "Uploaded" && ["Ready", "Expired"].includes(row.status)
        ? row.driveUrl
        : null,
  };
};

/** A whole video as Admin → Sessions shows it (adds the internal status and why it failed). */
export const toAdminVideo = (row) => ({
  ...toPublicVideo(row),
  status: row.status,
  failureReason: row.failureReason || null,
  driveStatus: row.driveStatus || null,
});

export const SESSION_VIDEO_COLUMNS = `camera, status, gaps, videoPath, thumbnailPath, sizeBytes,
  uploadBytes, receivedBytes, durationSeconds, failureReason, expiresAt, driveStatus, driveUrl`;

/** A session's whole videos, camera order. */
export const loadSessionVideos = (db, sessionId) =>
  db.query(
    `SELECT ${SESSION_VIDEO_COLUMNS} FROM session_videos
     WHERE sessionId = ? AND status != 'Deleted'
     ORDER BY camera ASC`,
    [sessionId]
  );
