
/**
 * Whole-game videos (CR-003, CR-006): one per game and camera — camera 0 on a
 * one-camera court, 1 and 2 on a two-camera court. The recorder box copies the
 * game into one file after End game and uploads it in chunks
 * (controllers/v1/device/game-videos.controller.js).
 *
 * Status: Pending (the box is making the file) → Uploading → Ready, or Failed;
 * Ready → Expired after the venue's retention days.
 *
 * CR-040: `delivery = 'Drive'` — the venue box keeps the file and sends it to
 * the court's Google Drive itself; the API never holds it, so such a video has
 * no file or picture link here, only its Drive state and link.
 */

/**
 * CR-040: where a box-sent video is for players — Uploading (to Drive), OnDrive,
 * NotShared (kept at the venue only: no usable Drive), Expired; null for a
 * video the API holds.
 */
const driveStateOf = (row) => {
  if (row.delivery !== "Drive") return null;
  if (row.status === "Expired") return "Expired";
  if (row.status === "Ready") return row.driveStatus === "Uploaded" ? "OnDrive" : "NotShared";
  if (row.status === "Uploading" && row.driveStatus === "Uploading") return "Uploading";
  return null;
};

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
 * "Saving" to the player. CR-040 Phase 4: no file links — players get the
 * video only from Google Drive, and the Drive link only while its Drive copy
 * is there.
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
    // CR-040: "Drive" = the venue box sends it to Google Drive; no file here
    delivery: row.delivery || "Server",
    driveState: driveStateOf(row),
    // CR-017: only while the video is kept and its Drive copy is there
    driveUrl: row.driveStatus === "Uploaded" && ready ? row.driveUrl : null,
  };
};

/**
 * CR-015: a video of a game that isn't paid yet — its status only; no Drive
 * link until it's paid at the desk.
 */
export const toLockedVideo = (row) => ({
  ...toPublicVideo(row),
  driveUrl: null,
});

/** A whole video as Admin → Sessions shows it (adds the internal status and why it failed). */
export const toAdminVideo = (row) => ({
  ...toPublicVideo(row),
  status: row.status,
  failureReason: row.failureReason || null,
  driveStatus: row.driveStatus || null,
  // CR-017: why its Drive copy wasn't moved to the trash yet (staff only)
  driveError: row.driveError || null,
  // CR-040: how long the venue box keeps its copy, and when it removed it
  boxKeepUntil: row.delivery === "Drive" ? row.boxKeepUntil || null : null,
  boxDeletedAt: row.delivery === "Drive" ? row.boxDeletedAt || null : null,
});

export const SESSION_VIDEO_COLUMNS = `camera, status, delivery, gaps,
  sizeBytes, uploadBytes, receivedBytes, durationSeconds, failureReason, expiresAt, driveStatus,
  driveUrl, driveError, boxKeepUntil, boxDeletedAt`;

/** A session's whole videos, camera order (CR-013 saves are loadCaptures'). */
export const loadSessionVideos = (db, sessionId) =>
  db.query(
    `SELECT ${SESSION_VIDEO_COLUMNS} FROM session_videos
     WHERE sessionId = ? AND captureId IS NULL AND status != 'Deleted'
     ORDER BY camera ASC`,
    [sessionId]
  );
