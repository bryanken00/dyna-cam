import fs from "node:fs";
import path from "node:path";
import express from "express";
import { z } from "zod";
import { catchAsync, validateBody } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal, moment } from "../../../utils/dateUtils.js";
import APIError, { ERROR_CODES } from "../../../utils/APIError.js";
import { daysFromNowLocal } from "../../../utils/clips.js";
import { randomToken } from "../../../utils/crypto/tokens.js";
import {
  clipUploadFolder,
  removeClipFiles,
  toStoredUploadPath,
} from "../../../utils/file/clipFiles.js";
import { upload } from "../../../utils/file/uploads.js";
import { settleSessions } from "../../../utils/sessions.js";

/**
 * A game's whole video, uploaded by the recorder box in chunks (CR-006) —
 * mounted at /api/v1/device/game-videos behind requireDevice.
 *
 * After End game the box gets a game job per camera (GET /device/jobs, type
 * "game"), copies the game into one mp4 and sends it:
 *
 *   POST /:sessionVideoId/start   { sizeBytes, durationSeconds, gaps }
 *                                 → { receivedBytes, chunkBytes }  (resume point)
 *   PUT  /:sessionVideoId/chunk?offset=N   application/octet-stream
 *                                 → { receivedBytes }
 *        409 OFFSET_MISMATCH { receivedBytes } when N isn't what the server has
 *   POST /:sessionVideoId/finish  multipart, optional `thumbnail` (JPEG)
 *        409 INCOMPLETE_UPLOAD { receivedBytes } while bytes are missing
 *   POST /:sessionVideoId/fail    { reason }
 *
 * The file grows in `<clip folder>/upload.part`; the bytes on disk are the
 * truth for where to resume (a crash between write and DB update can't lose a
 * chunk or double it). Only the venue's own boxes see a video (else 404), and
 * once one box started it, another is refused.
 */
const router = express.Router();

export const CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_GAME_BYTES =
  Math.max(1, parseInt(process.env.GAME_VIDEO_MAX_MB || "16384", 10) || 16384) * 1024 * 1024;
const PART_FILE = "upload.part";
const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";

const folderOf = (video) =>
  path.resolve("public", clipUploadFolder(video.venueId, video.sessionVideoId));
const partFileOf = (video) => path.join(folderOf(video), PART_FILE);
const sizeOnDisk = (file) =>
  fs.promises
    .stat(file)
    .then((stat) => stat.size)
    .catch(() => 0);

/** One chunk at a time per video (two requests must not append at once). */
const locks = new Map();
const withLock = async (key, fn) => {
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  locks.set(
    key,
    previous.then(() => current)
  );
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === current) locks.delete(key);
  }
};

const conflict = (res, code, message, receivedBytes) =>
  res.status(409).json({ success: false, message, code, data: { receivedBytes } });

/** The video, if it belongs to this box's venue and is still waiting for its file. */
const loadVideo = catchAsync(async (req, res, next) => {
  const rows = await req.db.query(
    `SELECT sv.sessionVideoId, sv.sessionId, sv.venueId, sv.camera, sv.status, sv.deviceId,
            sv.uploadBytes, sv.receivedBytes, v.clipRetentionDays
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
 * POST /:sessionVideoId/start — begin, or resume, sending the game's file.
 * The same size resumes where the server is; a different size starts over.
 */
router.post(
  "/:sessionVideoId/start",
  validateBody(startSchema),
  loadVideo,
  catchAsync(async (req, res) => {
    const { sizeBytes, durationSeconds, gaps } = req.body;
    const { video } = req;
    if (sizeBytes > MAX_GAME_BYTES) {
      throw new APIError(
        `A game video can be at most ${Math.round(MAX_GAME_BYTES / 1048576)} MB`,
        413,
        ERROR_CODES.VALIDATION_FAILED
      );
    }
    const received = await withLock(video.sessionVideoId, async () => {
      const file = partFileOf(video);
      const resuming = video.status === "Uploading" && Number(video.uploadBytes) === sizeBytes;
      let onDisk = resuming ? await sizeOnDisk(file) : 0;
      if (!resuming || onDisk > sizeBytes) {
        await fs.promises.mkdir(folderOf(video), { recursive: true });
        await fs.promises.writeFile(file, Buffer.alloc(0));
        onDisk = 0;
      }
      const cleanGaps = gaps
        .filter((gap) => gap.endMs > gap.startMs)
        .map((gap) => ({ startAt: toLocal(gap.startMs), endAt: toLocal(gap.endMs) }));
      await req.db.query(
        `UPDATE session_videos
         SET status = 'Uploading', deviceId = ?, uploadBytes = ?, receivedBytes = ?,
             durationSeconds = ?, gaps = ?, partsMissing = ?, lastChunkAt = ?, dateUpdated = ?
         WHERE sessionVideoId = ?`,
        [
          req.device.deviceId,
          sizeBytes,
          onDisk,
          durationSeconds,
          JSON.stringify(cleanGaps),
          cleanGaps.length,
          getCurrentTimestampLocal(),
          getCurrentTimestampLocal(),
          video.sessionVideoId,
        ]
      );
      return onDisk;
    });
    return res.sendSuccess("Send the game video", {
      receivedBytes: received,
      chunkBytes: CHUNK_BYTES,
    });
  })
);

const offsetSchema = z.coerce.number().int().min(0);

/**
 * PUT /:sessionVideoId/chunk?offset=N — the file's bytes [N, N + length).
 */
router.put(
  "/:sessionVideoId/chunk",
  express.raw({ type: "application/octet-stream", limit: CHUNK_BYTES + 1024 }),
  loadVideo,
  catchAsync((req, res) => {
    const { video } = req;
    const offset = offsetSchema.safeParse(req.query.offset);
    if (!offset.success) {
      throw new APIError("offset must be a whole number", 400, ERROR_CODES.VALIDATION_FAILED);
    }
    const body = Buffer.isBuffer(req.body) ? req.body : null;
    if (!body || body.length === 0) {
      throw new APIError(
        "Send the bytes as application/octet-stream",
        400,
        ERROR_CODES.VALIDATION_FAILED
      );
    }
    if (video.status !== "Uploading" || !video.uploadBytes) {
      throw new APIError("Start the upload first", 409, ERROR_CODES.INVALID_STATUS);
    }

    return withLock(video.sessionVideoId, async () => {
      const file = partFileOf(video);
      const onDisk = await sizeOnDisk(file);
      if (offset.data !== onDisk) {
        return conflict(res, "OFFSET_MISMATCH", "Continue from the server's position", onDisk);
      }
      if (onDisk + body.length > Number(video.uploadBytes)) {
        throw new APIError("More bytes than the file's size", 400, ERROR_CODES.VALIDATION_FAILED);
      }
      await fs.promises.appendFile(file, body);
      const receivedBytes = onDisk + body.length;
      // Live progress, not an edit: dateUpdated is left alone
      await req.db.query(
        `UPDATE session_videos SET receivedBytes = ?, lastChunkAt = ? WHERE sessionVideoId = ?`,
        [receivedBytes, getCurrentTimestampLocal(), video.sessionVideoId]
      );
      return res.sendSuccess("Chunk received", { receivedBytes });
    });
  })
);

const thumbnailUpload = upload({
  filePath: (req) => clipUploadFolder(req.video.venueId, req.video.sessionVideoId),
  allowedTypes: { "image/jpeg": [".jpg", ".jpeg"] },
  maxFileSize: 3 * 1024 * 1024,
});

/** True when the file starts like an MP4 (an ISO media "ftyp" box). */
const looksLikeMp4 = async (file) => {
  const handle = await fs.promises.open(file, "r");
  try {
    const head = Buffer.alloc(12);
    await handle.read(head, 0, 12, 0);
    return head.subarray(4, 8).toString("latin1") === "ftyp";
  } finally {
    await handle.close();
  }
};

/**
 * POST /:sessionVideoId/finish — every byte is in: the game's video is Ready.
 */
router.post(
  "/:sessionVideoId/finish",
  loadVideo,
  thumbnailUpload.fields([{ name: "thumbnail", maxCount: 1 }]),
  catchAsync(async (req, res) => {
    const { video } = req;
    const thumbnail = req.files?.thumbnail?.[0];
    const thumbnailPath = thumbnail ? toStoredUploadPath(thumbnail) : null;
    if (video.status !== "Uploading" || !video.uploadBytes) {
      await removeClipFiles(thumbnailPath);
      throw new APIError("Start the upload first", 409, ERROR_CODES.INVALID_STATUS);
    }

    return withLock(video.sessionVideoId, async () => {
      const file = partFileOf(video);
      const onDisk = await sizeOnDisk(file);
      if (onDisk !== Number(video.uploadBytes)) {
        await removeClipFiles(thumbnailPath);
        return conflict(res, "INCOMPLETE_UPLOAD", "Some of the file is still missing", onDisk);
      }
      if (!(await looksLikeMp4(file))) {
        await removeClipFiles(thumbnailPath);
        await fs.promises.unlink(file).catch(() => {});
        await req.db.query(
          `UPDATE session_videos SET status = 'Pending', deviceId = NULL, uploadBytes = NULL,
                  receivedBytes = 0, dateUpdated = ?
           WHERE sessionVideoId = ?`,
          [getCurrentTimestampLocal(), video.sessionVideoId]
        );
        throw new APIError("The file isn't an mp4 video", 400, ERROR_CODES.VALIDATION_FAILED);
      }

      const name = `game-cam${video.camera}-${randomToken(12)}.mp4`;
      await fs.promises.rename(file, path.join(folderOf(video), name));
      const videoPath = `/public/${clipUploadFolder(video.venueId, video.sessionVideoId)}/${name}`;
      const now = getCurrentTimestampLocal();
      await req.db.query(
        `UPDATE session_videos
         SET status = 'Ready', videoPath = ?, thumbnailPath = ?, sizeBytes = ?, receivedBytes = ?,
             failureReason = NULL, expiresAt = ?, dateUpdated = ?
         WHERE sessionVideoId = ?`,
        [
          videoPath,
          thumbnailPath,
          onDisk,
          onDisk,
          daysFromNowLocal(video.clipRetentionDays),
          now,
          video.sessionVideoId,
        ]
      );
      // CR-001: a court with a Google account gets the game in its Drive
      await req.db.query(
        `UPDATE session_videos sv
         JOIN recording_sessions s ON s.sessionId = sv.sessionId
         JOIN courts c ON c.courtId = s.courtId
         SET sv.driveStatus = 'Pending', sv.driveAttempts = 0, sv.driveNextAttemptAt = NULL
         WHERE sv.sessionVideoId = ? AND sv.driveStatus IS NULL
           AND c.driveRefreshToken IS NOT NULL AND c.status != 'Deleted'`,
        [video.sessionVideoId]
      );
      await settleSessions(req.db, video.sessionId);
      return res.sendSuccess("Game video saved", { status: "Ready" });
    });
  })
);

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

export default router;
