import fs from "node:fs";
import path from "node:path";
import express from "express";
import { z } from "zod";
import { logger } from "../../../../config/logger.js";
import { catchAsync, validateBody } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal, moment } from "../../../utils/dateUtils.js";
import APIError, { ERROR_CODES } from "../../../utils/APIError.js";
import { daysFromNowLocal, toEpochMs } from "../../../utils/clips.js";
import { decryptSecret, encryptSecret } from "../../../utils/crypto/secretBox.js";
import { dynamicLimiter } from "../../../middlewares/rateLimiter.js";
import {
  accessToken,
  DriveAuthError,
  driveConfigured,
  DriveNotFoundError,
  fileViewUrl,
  getFile,
  openUploadSession,
  shareWithLink,
} from "../../../utils/googleDrive.js";
import { courtFolder, sessionFolder, sessionVideoFileName } from "../../../utils/driveFolders.js";
import { clipUploadFolder } from "../../../utils/file/clipFiles.js";
import { settleSessions } from "../../../utils/sessions.js";

/**
 * A game's whole video (CR-006), and each save (CR-013) — mounted at
 * /api/v1/device/game-videos behind requireDevice. After End game the box gets
 * a game job per camera (GET /device/jobs, type "game") and copies the game
 * into one mp4. Only the venue's own boxes see a video (else 404), and once one
 * box started it, another is refused.
 *
 *   POST /:sessionVideoId/fail    { reason }  the box can't make the file
 *
 * The old upload to the API (/start, /chunk, /finish, CR-006) answers 410
 * BOX_UPDATE_REQUIRED since CR-040 Phase 4.
 *
 * CR-040 (PLAN-005) — the video never comes to the API: a box that reports
 * "drive-direct" keeps the file and sends it straight to the court's Google
 * Drive. The API opens the Drive upload (the court's sign-in never leaves the
 * cloud) and believes it only after reading the file back from Drive:
 *
 *   POST /:sessionVideoId/drive-session  { sizeBytes, durationSeconds, gaps, newSession? }
 *        → { drive: true, uploadUrl, chunkBytes, keepUntilMs }  send the bytes there
 *        → { drive: false, reason: NO_DRIVE | DRIVE_RECONNECT, keepUntilMs }  keep it only
 *        503 DRIVE_UNAVAILABLE  Google didn't answer — try again later
 *   POST /:sessionVideoId/progress       { uploadedBytes }  (for the game page)
 *   POST /:sessionVideoId/drive-done     { driveFileId }  → Ready, shared by link
 *        409 DRIVE_FILE_MISMATCH  Drive's file isn't the one sent — open a new session
 *   POST /:sessionVideoId/box-deleted    the box removed its copy (keep time over)
 */
const router = express.Router();

export const CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_GAME_BYTES =
  Math.max(1, parseInt(process.env.GAME_VIDEO_MAX_MB || "16384", 10) || 16384) * 1024 * 1024;
const PART_FILE = "upload.part";
const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";

const folderOf = (video) =>
  path.resolve("public", clipUploadFolder(video.venueId, video.sessionVideoId));
// A half-sent file left by the old upload (before CR-040 Phase 4): removed on fail
const partFileOf = (video) => path.join(folderOf(video), PART_FILE);

/** The video, if it belongs to this box's venue and is still waiting for its file. */
const loadVideo = catchAsync(async (req, res, next) => {
  const rows = await req.db.query(
    `SELECT sv.sessionVideoId, sv.sessionId, sv.venueId, sv.camera, sv.status, sv.deviceId,
            sv.uploadBytes, sv.receivedBytes, sv.delivery, v.clipRetentionDays
     FROM session_videos sv
     JOIN venues v ON v.venueId = sv.venueId
     WHERE sv.sessionVideoId = ? AND sv.venueId = ? AND sv.status != 'Deleted'
     LIMIT 1`,
    [req.params.sessionVideoId, req.device.venueId]
  );
  if (rows.length === 0) {
    throw new APIError("Game video not found", 404, ERROR_CODES.RESOURCE_NOT_FOUND);
  }
  const video = rows[0];
  if (!["Pending", "Uploading"].includes(video.status)) {
    throw new APIError(
      `This game video is already ${video.status.toLowerCase()}`,
      409,
      ERROR_CODES.INVALID_STATUS
    );
  }
  if (video.deviceId && video.deviceId !== req.device.deviceId) {
    throw new APIError(
      "Another recorder box is sending this game",
      409,
      ERROR_CODES.INVALID_STATUS
    );
  }
  req.video = video;
  next();
});

// Times come from the box's segment timeline and may carry fractions of a
// millisecond — rounded here rather than refused
const wholeNumber = (max) => z.number().min(0).max(max).transform(Math.round);
const startSchema = z.object({
  sizeBytes: z.number().int().min(1),
  durationSeconds: wholeNumber(7 * 24 * 3600),
  gaps: z
    .array(
      z.object({
        startMs: wholeNumber(Number.MAX_SAFE_INTEGER),
        endMs: wholeNumber(Number.MAX_SAFE_INTEGER),
      })
    )
    .max(500)
    .optional()
    .default([]),
});

const toLocal = (ms) => moment(ms).tz(TIMEZONE).format("YYYY-MM-DD HH:mm:ss");

/**
 * CR-040 Phase 4: the old upload to the API (/start, /chunk, /finish) is gone —
 * game videos go from the venue box straight to Google Drive. A box that still
 * tries it is told to update (an old box reports the game as failed with this).
 */
const boxUpdateRequired = (req, res) =>
  res.status(410).json({
    success: false,
    message:
      "This recorder box needs updating — game videos now go from the box straight to Google Drive",
    code: ERROR_CODES.BOX_UPDATE_REQUIRED,
    data: null,
  });
router.post("/:sessionVideoId/start", boxUpdateRequired);
router.put("/:sessionVideoId/chunk", boxUpdateRequired);
router.post("/:sessionVideoId/finish", boxUpdateRequired);

const failSchema = z.object({ reason: z.string().trim().min(1).max(255) });

/**
 * POST /:sessionVideoId/fail — the box can't make this camera's file (e.g. the
 * camera wasn't recording during the game).
 */
router.post(
  "/:sessionVideoId/fail",
  validateBody(failSchema),
  loadVideo,
  catchAsync(async (req, res) => {
    const { video } = req;
    await req.db.query(
      `UPDATE session_videos SET status = 'Failed', failureReason = ?, deviceId = ?,
              dateUpdated = ?
       WHERE sessionVideoId = ? AND status IN ('Pending', 'Uploading')`,
      [req.body.reason, req.device.deviceId, getCurrentTimestampLocal(), video.sessionVideoId]
    );
    await fs.promises.unlink(partFileOf(video)).catch(() => {});
    await settleSessions(req.db, video.sessionId);
    return res.sendSuccess("Game video marked as failed");
  })
);

/* ── CR-040: straight from the box to Google Drive ─────────────────────────── */

// Google keeps a resumable session about a week; open a new one after 6 days
const SESSION_REUSE_DAYS = 6;
const DRIVE_REASON = {
  NO_DRIVE: "No Google Drive on this court — the video stays on the venue box",
  DRIVE_RECONNECT: "Google Drive needs reconnecting on this court — the video stays on the venue box",
};

/** What a Drive upload needs about a video: its court, game, folders and file name. */
const driveRowOf = async (db, sessionVideoId) => {
  const [row] = await db.query(
    `SELECT sv.sessionVideoId, sv.sessionId, sv.camera, sv.uploadBytes, sv.receivedBytes,
            sv.delivery, sv.driveSessionUrl, sv.driveSessionAt, sv.boxKeepUntil,
            s.courtId, s.startAt AS sessionStartAt, s.driveFolderId AS sessionFolderId,
            c.name AS courtName, c.driveRefreshToken, c.driveFolderId,
            c.driveStatus AS courtDriveStatus, c.status AS courtStatus, v.name AS venueName,
            sc.startAt AS captureStartAt, sc.endAt AS captureEndAt
     FROM session_videos sv
     JOIN recording_sessions s ON s.sessionId = sv.sessionId
     JOIN courts c ON c.courtId = s.courtId
     JOIN venues v ON v.venueId = sv.venueId
     LEFT JOIN session_captures sc ON sc.captureId = sv.captureId
     WHERE sv.sessionVideoId = ? LIMIT 1`,
    [sessionVideoId]
  );
  return row;
};

/** The court's stored sign-in failed or can't be read: staff must reconnect it. */
const markReconnect = (db, row, problem) =>
  db.query(
    `UPDATE courts SET driveStatus = 'NeedsReconnect', driveProblem = ?
     WHERE courtId = ? AND driveRefreshToken = ?`,
    [String(problem).slice(0, 255), row.courtId, row.driveRefreshToken]
  );

/** The court's sign-in as an access token, or null when the court has no usable Drive. */
const courtToken = async (db, row) => {
  if (!driveConfigured() || !row.driveRefreshToken || row.courtStatus === "Deleted") return null;
  if (row.courtDriveStatus !== "Connected") return null;
  const refreshToken = decryptSecret(row.driveRefreshToken);
  if (!refreshToken) {
    await markReconnect(db, row, "The stored sign-in can no longer be read. Reconnect Google Drive.");
    return null;
  }
  return accessToken(refreshToken);
};

const driveUnavailable = (err, sessionVideoId) => {
  logger.warn("Google Drive didn't answer for a box upload", { sessionVideoId, error: err.message });
  return new APIError(
    "Google Drive didn't answer — try again shortly",
    503,
    ERROR_CODES.DRIVE_UNAVAILABLE
  );
};

const driveSessionSchema = startSchema.extend({ newSession: z.boolean().optional().default(false) });

/**
 * POST /:sessionVideoId/drive-session — the box made the file and keeps it;
 * where should it send it? A Drive resumable session (the same one again while
 * it lasts, or a new one), or nowhere when the court has no usable Drive.
 */
router.post(
  "/:sessionVideoId/drive-session",
  validateBody(driveSessionSchema),
  loadVideo,
  catchAsync(async (req, res) => {
    const { sizeBytes, durationSeconds, gaps, newSession } = req.body;
    const { video } = req;
    if (sizeBytes > MAX_GAME_BYTES) {
      throw new APIError(
        `A game video can be at most ${Math.round(MAX_GAME_BYTES / 1048576)} MB`,
        413,
        ERROR_CODES.VALIDATION_FAILED
      );
    }
    const row = await driveRowOf(req.db, video.sessionVideoId);
    const now = getCurrentTimestampLocal();
    const sameFile = row.delivery === "Drive" && Number(row.uploadBytes) === sizeBytes;
    // The box keeps its copy the venue's keep time from when it first had it
    const keepUntil = row.delivery === "Drive" && row.boxKeepUntil ? row.boxKeepUntil : daysFromNowLocal(video.clipRetentionDays);
    const keepUntilMs = toEpochMs(keepUntil);
    const cleanGaps = gaps
      .filter((gap) => gap.endMs > gap.startMs)
      .map((gap) => ({ startAt: toLocal(gap.startMs), endAt: toLocal(gap.endMs) }));

    await req.db.query(
      `UPDATE session_videos
       SET status = 'Uploading', delivery = 'Drive', deviceId = ?, uploadBytes = ?, receivedBytes = ?,
           durationSeconds = ?, gaps = ?, partsMissing = ?, lastChunkAt = ?, videoPath = NULL,
           boxKeepUntil = ?, boxDeletedAt = NULL, expiresAt = ?, dateUpdated = ?
       WHERE sessionVideoId = ?`,
      [
        req.device.deviceId,
        sizeBytes,
        sameFile ? Number(row.receivedBytes) || 0 : 0,
        durationSeconds,
        JSON.stringify(cleanGaps),
        cleanGaps.length,
        now,
        keepUntil,
        keepUntil,
        now,
        video.sessionVideoId,
      ]
    );

    // No usable Drive: the video is made and kept on the box only
    const keptOnBox = async (reason) => {
      await req.db.query(
        `UPDATE session_videos
         SET status = 'Ready', sizeBytes = ?, receivedBytes = ?, driveStatus = 'Skipped',
             driveError = ?, driveSessionUrl = NULL, driveSessionAt = NULL, dateUpdated = ?
         WHERE sessionVideoId = ?`,
        [sizeBytes, sizeBytes, DRIVE_REASON[reason], now, video.sessionVideoId]
      );
      await settleSessions(req.db, video.sessionId);
      return res.sendSuccess("Keep the video on the box", { drive: false, reason, keepUntilMs });
    };

    const fresh =
      sameFile &&
      !newSession &&
      row.driveSessionUrl &&
      row.driveSessionAt > moment().tz(TIMEZONE).subtract(SESSION_REUSE_DAYS, "days").format("YYYY-MM-DD HH:mm:ss");
    let uploadUrl = fresh ? decryptSecret(row.driveSessionUrl) : null;

    if (!uploadUrl) {
      let token;
      try {
        token = await courtToken(req.db, row);
        if (!token) {
          return keptOnBox(row.driveRefreshToken && row.courtStatus !== "Deleted" && driveConfigured() ? "DRIVE_RECONNECT" : "NO_DRIVE");
        }
        const open = async () => {
          let parentId = await courtFolder(req.db, token, row);
          parentId = await sessionFolder(req.db, token, row, parentId);
          return openUploadSession(token, { name: sessionVideoFileName(row), parentId, sizeBytes });
        };
        try {
          uploadUrl = await open();
        } catch (err) {
          // A folder was deleted in the meantime: make it again, once
          if (!(err instanceof DriveNotFoundError)) throw err;
          row.driveFolderId = null;
          row.sessionFolderId = null;
          uploadUrl = await open();
        }
      } catch (err) {
        if (err instanceof DriveAuthError) {
          await markReconnect(req.db, row, err.message);
          return keptOnBox("DRIVE_RECONNECT");
        }
        throw driveUnavailable(err, video.sessionVideoId);
      }
      await req.db.query(
        `UPDATE session_videos
         SET driveSessionUrl = ?, driveSessionAt = ?, receivedBytes = 0, driveStatus = 'Uploading',
             driveError = NULL, driveNextAttemptAt = NULL
         WHERE sessionVideoId = ?`,
        [encryptSecret(uploadUrl), now, video.sessionVideoId]
      );
    } else {
      await req.db.query(
        `UPDATE session_videos SET driveStatus = 'Uploading', driveError = NULL WHERE sessionVideoId = ?`,
        [video.sessionVideoId]
      );
    }

    return res.sendSuccess("Send the game video to Google Drive", {
      drive: true,
      uploadUrl,
      chunkBytes: CHUNK_BYTES,
      keepUntilMs,
    });
  })
);

/** A video the box is sending to Drive right now (else 409). */
const requireDriveUpload = (video) => {
  if (video.delivery !== "Drive" || video.status !== "Uploading") {
    throw new APIError("Open a Drive session first", 409, ERROR_CODES.INVALID_STATUS);
  }
};

// Per box: progress comes about once a chunk
const progressLimiter = dynamicLimiter({
  points: parseInt(process.env.RATE_LIMIT_DEVICE_PROGRESS_POINTS || "240", 10),
  duration: 60,
  keyGenerator: (req) => `device-progress:${req.device?.deviceId || req.ip}`,
  message: "Too many progress reports — slow down.",
});

const progressSchema = z.object({ uploadedBytes: z.number().int().min(0) });

/** POST /:sessionVideoId/progress — how much Google has, for the game page and Admin. */
router.post(
  "/:sessionVideoId/progress",
  progressLimiter,
  validateBody(progressSchema),
  loadVideo,
  catchAsync(async (req, res) => {
    const { video } = req;
    requireDriveUpload(video);
    const received = Math.min(req.body.uploadedBytes, Number(video.uploadBytes) || 0);
    // Live progress, not an edit: dateUpdated is left alone
    await req.db.query(
      `UPDATE session_videos SET receivedBytes = ?, lastChunkAt = ? WHERE sessionVideoId = ?`,
      [received, getCurrentTimestampLocal(), video.sessionVideoId]
    );
    return res.sendSuccess("Progress recorded", { receivedBytes: received });
  })
);

const doneSchema = z.object({
  driveFileId: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9_-]+$/, "Invalid Drive file ID"),
});

/**
 * POST /:sessionVideoId/drive-done — Google answered the last chunk with the
 * file's ID. Believed only once Drive itself has that file, whole, in the
 * game's folder; then it's shared by link and the video is Ready.
 */
router.post(
  "/:sessionVideoId/drive-done",
  validateBody(doneSchema),
  loadVideo,
  catchAsync(async (req, res) => {
    const { video } = req;
    requireDriveUpload(video);
    const row = await driveRowOf(req.db, video.sessionVideoId);

    let file;
    let token;
    try {
      token = await courtToken(req.db, row);
      if (!token) {
        return res.status(409).json({
          success: false,
          message: DRIVE_REASON.DRIVE_RECONNECT,
          code: "DRIVE_RECONNECT",
          data: null,
        });
      }
      file = await getFile(token, req.body.driveFileId);
    } catch (err) {
      if (err instanceof DriveAuthError) {
        await markReconnect(req.db, row, err.message);
        return res.status(409).json({
          success: false,
          message: DRIVE_REASON.DRIVE_RECONNECT,
          code: "DRIVE_RECONNECT",
          data: null,
        });
      }
      throw driveUnavailable(err, video.sessionVideoId);
    }

    const size = Number(video.uploadBytes);
    if (!file || file.trashed || file.size !== size || !file.parents.includes(row.sessionFolderId)) {
      // Not the file the box was to send: start again with a new session
      await req.db.query(
        `UPDATE session_videos SET driveSessionUrl = NULL, driveSessionAt = NULL, receivedBytes = 0
         WHERE sessionVideoId = ?`,
        [video.sessionVideoId]
      );
      return res.status(409).json({
        success: false,
        message: "Google Drive doesn't have this video as it was sent — open a new Drive session",
        code: "DRIVE_FILE_MISMATCH",
        data: null,
      });
    }

    try {
      await shareWithLink(token, file.id);
    } catch (err) {
      throw driveUnavailable(err, video.sessionVideoId);
    }
    const now = getCurrentTimestampLocal();
    const driveUrl = fileViewUrl(file.id, file.webViewLink);
    await req.db.query(
      `UPDATE session_videos
       SET status = 'Ready', sizeBytes = ?, receivedBytes = ?, failureReason = NULL,
           driveStatus = 'Uploaded', driveFileId = ?, driveUrl = ?, driveUploadedAt = ?,
           driveError = NULL, driveSessionUrl = NULL, driveSessionAt = NULL, dateUpdated = ?
       WHERE sessionVideoId = ?`,
      [size, size, file.id, driveUrl, now, now, video.sessionVideoId]
    );
    await settleSessions(req.db, video.sessionId);
    return res.sendSuccess("Game video on Google Drive", { status: "Ready", driveUrl });
  })
);

/**
 * POST /:sessionVideoId/box-deleted — the box removed its copy (keep time
 * over, the video was deleted, or the disk was critically full). Any status:
 * a deleted save's file goes too.
 */
router.post(
  "/:sessionVideoId/box-deleted",
  catchAsync(async (req, res) => {
    const rows = await req.db.query(
      `SELECT sessionVideoId FROM session_videos
       WHERE sessionVideoId = ? AND venueId = ? AND delivery = 'Drive' LIMIT 1`,
      [req.params.sessionVideoId, req.device.venueId]
    );
    if (rows.length === 0) {
      throw new APIError("Game video not found", 404, ERROR_CODES.RESOURCE_NOT_FOUND);
    }
    await req.db.query(
      `UPDATE session_videos SET boxDeletedAt = COALESCE(boxDeletedAt, ?) WHERE sessionVideoId = ?`,
      [getCurrentTimestampLocal(), req.params.sessionVideoId]
    );
    return res.sendSuccess("Noted: the box removed its copy");
  })
);

export default router;
