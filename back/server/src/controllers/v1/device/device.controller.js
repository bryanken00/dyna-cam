import express from "express";
import {
  catchAsync,
  validateBody,
  validateParams,
  validateQuery,
} from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal } from "../../../utils/dateUtils.js";
import APIError, { ERROR_CODES } from "../../../utils/APIError.js";
import { dynamicLimiter } from "../../../middlewares/rateLimiter.js";
import {
  CLIP_POST_SECONDS,
  CLIP_PRE_SECONDS,
  clipShareUrl,
  daysFromNowLocal,
  toEpochMs,
} from "../../../utils/clips.js";
import { decryptSecret } from "../../../utils/crypto/secretBox.js";
import {
  clipUploadFolder,
  removeClipFiles,
  toStoredUploadPath,
} from "../../../utils/file/clipFiles.js";
import { signUploadUrl } from "../../../utils/file/signedUrl.js";
import {
  COURT_RECORDING_COLUMNS,
  localFromEpochMs,
  onlineSince,
  requestClip,
} from "../../../utils/clipRequests.js";
import { materializeSessionParts, settleSessions } from "../../../utils/sessions.js";
import { upload } from "../../../utils/file/uploads.js";
import {
  buttonParamsSchema,
  buttonPressSchema,
  failClipSchema,
  heartbeatSchema,
  jobsQuerySchema,
} from "../../../validators/device-api.validator.js";

/**
 * Recorder-box API (PLAN-001) — mounted at /api/v1/device behind
 * `requireDevice` (middlewares/deviceAuth.middleware.js), so `req.device` is
 * always set. Every query is scoped to `req.device.venueId`: a box can only see
 * and change its own venue's courts and clips. A clip of another venue is
 * answered 404, the same as a missing one.
 *
 * The box only ever calls out (no inbound ports at the venue):
 *   GET  /config                       courts + camera URLs + watermark logo
 *   POST /heartbeat                    every ~30s, with per-camera health
 *   GET  /jobs?wait=25                 long-poll for clips to cut
 *   POST /clips/:clipId/processing     claim a job
 *   POST /clips/:clipId/upload         multipart: video (mp4) + thumbnail (jpeg)
 *   POST /clips/:clipId/fail           give up on a job, with a reason
 *   POST /buttons/:buttonCode/press    a court button was pressed (Phase 2)
 */

// A press the box could not relay straight away is still worth saving only
// while the moment is in its rolling buffer; after that it is refused.
const BUTTON_PRESS_MAX_AGE_MS = 2 * 60 * 1000;
const router = express.Router();

const CLIP_MAX_UPLOAD_MB = Math.max(
  1,
  parseInt(process.env.CLIP_MAX_UPLOAD_MB || "100", 10) || 100
);

// Keyed by box, not IP: several boxes can share a venue's one public IP, and a
// busy venue uploads far more than the per-IP upload limit allows.
const deviceUploadLimiter = dynamicLimiter({
  points: parseInt(process.env.RATE_LIMIT_DEVICE_UPLOAD_POINTS || "600", 10),
  duration: 3600,
  keyGenerator: (req) => `device:${req.device.deviceId}`,
  message: "Too many uploads from this recorder box",
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * GET /config
 * Everything the box needs to record: its venue's active courts that have a
 * camera, with the camera URLs decrypted, and the logo to watermark clips with.
 */
router.get(
  "/config",
  catchAsync(async (req, res) => {
    const { venueId, deviceId, name } = req.device;

    await materializeSessionParts(req.db, { venueId });

    const [venueRows, courtRows, sessionRows] = await Promise.all([
      req.db.query(
        `SELECT venueId, name, logoUrl, clipRetentionDays FROM venues WHERE venueId = ? LIMIT 1`,
        [venueId]
      ),
      req.db.query(
        `SELECT courtId, name, cameraRtspUrl
         FROM courts
         WHERE venueId = ? AND status = 'Active' AND cameraRtspUrl IS NOT NULL
         ORDER BY name ASC`,
        [venueId]
      ),
      // Sessions whose footage the box must keep beyond its rolling buffer:
      // starting within a day, or ended in the last 30 minutes (parts may
      // still be waiting to be cut)
      req.db.query(
        `SELECT sessionId, courtId, startAt, endAt
         FROM recording_sessions
         WHERE venueId = ? AND status IN ('Scheduled', 'Recording', 'Processing')
           AND startAt <= DATE_ADD(?, INTERVAL 1 DAY)
           AND endAt >= DATE_SUB(?, INTERVAL 30 MINUTE)`,
        [venueId, getCurrentTimestampLocal(), getCurrentTimestampLocal()]
      ),
    ]);

    const venue = venueRows[0];
    const courts = courtRows
      .map((court) => ({
        courtId: court.courtId,
        name: court.name,
        cameraRtspUrl: decryptSecret(court.cameraRtspUrl),
      }))
      // An unreadable URL (DEVICE_SECRET_KEY changed) cannot be recorded
      .filter((court) => court.cameraRtspUrl);

    return res.sendSuccess("Recorder configuration", {
      device: { deviceId, name },
      venue: {
        venueId: venue.venueId,
        name: venue.name,
        // A signed path; the box fetches it relative to its API_URL
        logoUrl: signUploadUrl(venue.logoUrl),
      },
      courts,
      sessions: sessionRows.map((row) => ({
        sessionId: row.sessionId,
        courtId: row.courtId,
        startMs: toEpochMs(row.startAt),
        endMs: toEpochMs(row.endAt),
      })),
      clip: { preSeconds: CLIP_PRE_SECONDS, postSeconds: CLIP_POST_SECONDS },
      serverTime: Date.now(),
    });
  })
);

/**
 * POST /heartbeat
 * Records the box's version and each camera's health. Camera reports for
 * courts outside the box's venue are dropped.
 */
router.post(
  "/heartbeat",
  validateBody(heartbeatSchema),
  catchAsync(async (req, res) => {
    const { agentVersion, cameras } = req.body;
    const { venueId, deviceId } = req.device;

    const courtRows = await req.db.query(
      `SELECT courtId, name FROM courts WHERE venueId = ? AND status != 'Deleted'`,
      [venueId]
    );
    const names = new Map(courtRows.map((court) => [court.courtId, court.name]));
    const reported = cameras
      .filter((camera) => names.has(camera.courtId))
      .map((camera) => ({
        courtId: camera.courtId,
        courtName: names.get(camera.courtId),
        status: camera.status,
        message: camera.message || null,
      }));

    const now = getCurrentTimestampLocal();
    await req.db.query(
      `UPDATE devices SET agentVersion = ?, lastStatus = ?, lastSeenAt = ?, dateUpdated = ?
       WHERE deviceId = ?`,
      [
        agentVersion || null,
        JSON.stringify({ cameras: reported, reportedAt: now }),
        now,
        now,
        deviceId,
      ]
    );

    return res.sendSuccess("Heartbeat recorded", { serverTime: Date.now() });
  })
);

/**
 * GET /jobs?wait=25
 * Pending clips for the box's venue. Long-polls: holds the request open up to
 * `wait` seconds until there is something to do, so a player's clip starts
 * processing within a second of the tap.
 */
router.get(
  "/jobs",
  validateQuery(jobsQuerySchema),
  catchAsync(async (req, res) => {
    const { venueId } = req.device;
    const waitMs = Number(req.query.wait ?? 25) * 1000;
    const deadline = Date.now() + waitMs;

    let closed = false;
    res.on("close", () => {
      closed = true;
    });

    const findJobs = () =>
      req.db.query(
        `SELECT cl.clipId, cl.courtId, cl.requestedAt, cl.durationSeconds, cl.source,
                cl.sessionId, cl.partIndex, cl.windowStartAt, cl.windowEndAt
         FROM clips cl
         JOIN courts c ON c.courtId = cl.courtId AND c.status != 'Deleted'
         WHERE cl.venueId = ? AND cl.status = 'Pending'
         ORDER BY cl.requestedAt ASC
         LIMIT 10`,
        [venueId]
      );

    // Session parts become jobs when their window ends (utils/sessions.js);
    // check for due parts now and every few seconds while waiting
    await materializeSessionParts(req.db, { venueId });
    let rows = await findJobs();
    let polls = 0;
    while (rows.length === 0 && !closed && Date.now() < deadline) {
      await sleep(1000);
      if (closed) break;
      polls += 1;
      if (polls % 5 === 0) await materializeSessionParts(req.db, { venueId });
      rows = await findJobs();
    }

    if (closed) return undefined;

    return res.sendSuccess("Jobs", {
      jobs: rows.map((row) => ({
        type: "clip",
        clipId: row.clipId,
        courtId: row.courtId,
        source: row.source,
        requestedAt: row.requestedAt,
        requestedAtMs: toEpochMs(row.requestedAt),
        durationSeconds: row.durationSeconds,
        preSeconds: CLIP_PRE_SECONDS,
        postSeconds: CLIP_POST_SECONDS,
        // Session parts: cut exactly this window instead of the pre/post
        // seconds around requestedAt
        sessionId: row.sessionId || null,
        partIndex: row.partIndex ?? null,
        windowStartMs: toEpochMs(row.windowStartAt),
        windowEndMs: toEpochMs(row.windowEndAt),
      })),
    });
  })
);

/**
 * POST /buttons/:buttonCode/press
 * A court's physical button (Shelly / ESP32) called the box on the LAN; the box
 * relays it here with the press time. Saves that court's clip by the same rules
 * as a QR scan (utils/clipRequests.js). Only courts of the box's own venue.
 */
router.post(
  "/buttons/:buttonCode/press",
  validateParams(buttonParamsSchema),
  validateBody(buttonPressSchema),
  catchAsync(async (req, res) => {
    const nowMs = Date.now();
    let pressedAtMs = req.body.pressedAtMs ?? nowMs;
    if (pressedAtMs > nowMs) pressedAtMs = nowMs; // box clock slightly ahead
    if (nowMs - pressedAtMs > BUTTON_PRESS_MAX_AGE_MS) {
      throw new APIError(
        "This press is too old — the moment is no longer in the recorder's buffer",
        422,
        ERROR_CODES.INVALID_INPUT
      );
    }

    let conn;
    let result;
    try {
      conn = await req.db.beginTransaction();
      const [courts] = await conn.execute(
        `SELECT ${COURT_RECORDING_COLUMNS}
         FROM courts c
         JOIN venues v ON v.venueId = c.venueId
         WHERE c.buttonCode = ? AND c.venueId = ? AND c.status = 'Active' AND v.status = 'Active'
         LIMIT 1`,
        [onlineSince(), req.params.buttonCode, req.device.venueId]
      );
      if (courts.length === 0) {
        await req.db.rollback(conn);
        throw new APIError(
          "No court of this venue uses that button",
          404,
          ERROR_CODES.RESOURCE_NOT_FOUND
        );
      }

      result = await requestClip(conn, courts[0], {
        source: "BUTTON",
        requestedAt: localFromEpochMs(pressedAtMs),
      });
      await req.db.commit(conn);
    } catch (err) {
      if (!(err instanceof APIError)) await req.db.rollback(conn);
      throw err;
    }

    if (!result.ok) {
      throw new APIError("This court has no camera configured", 409, ERROR_CODES.CAMERA_OFFLINE);
    }

    return res.sendSuccess(
      result.merged ? "Already saving this moment" : "Saving the clip",
      { clipId: result.clipId, shareUrl: clipShareUrl(result.shareToken), merged: result.merged },
      result.merged ? 200 : 201
    );
  })
);

/**
 * Load a clip of the box's venue that is still waiting for a video, into
 * `req.clip`. Runs before multer, so nothing is written for a clip the box may
 * not touch.
 */
const loadOpenClip = catchAsync(async (req, res, next) => {
  const rows = await req.db.query(
    `SELECT clipId, venueId, sessionId, status, deviceId FROM clips
     WHERE clipId = ? AND venueId = ? AND status != 'Deleted'
     LIMIT 1`,
    [req.params.clipId, req.device.venueId]
  );
  if (rows.length === 0) {
    throw new APIError("Clip not found", 404, ERROR_CODES.RESOURCE_NOT_FOUND);
  }
  if (!["Pending", "Processing"].includes(rows[0].status)) {
    throw new APIError(
      `This clip is already ${rows[0].status.toLowerCase()}`,
      409,
      ERROR_CODES.INVALID_STATUS
    );
  }
  // Only one box makes a clip: once claimed, other boxes at the venue are refused
  if (
    rows[0].status === "Processing" &&
    rows[0].deviceId &&
    rows[0].deviceId !== req.device.deviceId
  ) {
    throw new APIError("Another recorder box is making this clip", 409, ERROR_CODES.INVALID_STATUS);
  }
  req.clip = rows[0];
  next();
});

/**
 * POST /clips/:clipId/processing — claim the job
 */
router.post(
  "/clips/:clipId/processing",
  loadOpenClip,
  catchAsync(async (req, res) => {
    // Atomic claim: a Pending clip, or one this box already holds (a retry).
    // Two boxes claiming at once — exactly one update matches.
    const result = await req.db.query(
      `UPDATE clips SET status = 'Processing', deviceId = ?, dateUpdated = ?
       WHERE clipId = ?
         AND (status = 'Pending' OR (status = 'Processing' AND deviceId = ?))`,
      [req.device.deviceId, getCurrentTimestampLocal(), req.clip.clipId, req.device.deviceId]
    );
    if (result.affectedRows === 0) {
      throw new APIError(
        "Another recorder box is making this clip",
        409,
        ERROR_CODES.INVALID_STATUS
      );
    }
    return res.sendSuccess("Clip claimed");
  })
);

const clipUpload = upload({
  filePath: (req) => clipUploadFolder(req.clip.venueId, req.clip.clipId),
  allowedTypes: {
    "video/mp4": [".mp4"],
    "image/jpeg": [".jpg", ".jpeg"],
  },
  maxFileSize: CLIP_MAX_UPLOAD_MB * 1024 * 1024,
});

/**
 * POST /clips/:clipId/upload
 * multipart/form-data: `video` (mp4, required), `thumbnail` (jpeg, optional).
 * Marks the clip Ready; it stays downloadable for the venue's retention days.
 */
// A clip or session part can take minutes to upload on a slow venue line —
// longer than the server's default request timeout
const UPLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const allowSlowUpload = (req, res, next) => {
  req.setTimeout(UPLOAD_TIMEOUT_MS);
  res.setTimeout(UPLOAD_TIMEOUT_MS);
  next();
};

router.post(
  "/clips/:clipId/upload",
  allowSlowUpload,
  deviceUploadLimiter,
  loadOpenClip,
  clipUpload.fields([
    { name: "video", maxCount: 1 },
    { name: "thumbnail", maxCount: 1 },
  ]),
  catchAsync(async (req, res) => {
    const video = req.files?.video?.[0];
    const thumbnail = req.files?.thumbnail?.[0];
    const written = [video, thumbnail].filter(Boolean).map(toStoredUploadPath);

    // The allowed types are shared by both fields — check each is the right one
    if (!video || video.mimetype !== "video/mp4") {
      await removeClipFiles(...written);
      throw new APIError("An mp4 video is required", 400, ERROR_CODES.VALIDATION_FAILED);
    }
    if (thumbnail && thumbnail.mimetype !== "image/jpeg") {
      await removeClipFiles(...written);
      throw new APIError("The thumbnail must be a JPEG", 400, ERROR_CODES.VALIDATION_FAILED);
    }

    const videoPath = toStoredUploadPath(video);
    const thumbnailPath = thumbnail ? toStoredUploadPath(thumbnail) : null;
    const now = getCurrentTimestampLocal();

    let conn;
    let stillOpen = false;
    try {
      conn = await req.db.beginTransaction();

      // Re-check under a lock: the clip may have been deleted or failed while
      // the upload was in flight
      const [rows] = await conn.execute(
        `SELECT cl.status, v.clipRetentionDays
         FROM clips cl JOIN venues v ON v.venueId = cl.venueId
         WHERE cl.clipId = ? AND cl.venueId = ?
         LIMIT 1 FOR UPDATE`,
        [req.clip.clipId, req.device.venueId]
      );
      stillOpen = rows.length > 0 && ["Pending", "Processing"].includes(rows[0].status);
      if (!stillOpen) {
        await req.db.rollback(conn);
      } else {
        await conn.execute(
          `UPDATE clips
         SET status = 'Ready', videoPath = ?, thumbnailPath = ?, sizeBytes = ?, deviceId = ?,
             failureReason = NULL, expiresAt = ?, dateUpdated = ?
         WHERE clipId = ?`,
          [
            videoPath,
            thumbnailPath,
            video.size,
            req.device.deviceId,
            daysFromNowLocal(rows[0].clipRetentionDays),
            now,
            req.clip.clipId,
          ]
        );
        await req.db.commit(conn);
      }
    } catch (err) {
      await req.db.rollback(conn);
      await removeClipFiles(...written);
      throw err;
    }

    if (!stillOpen) {
      await removeClipFiles(...written);
      throw new APIError(
        "This clip is no longer waiting for a video",
        409,
        ERROR_CODES.INVALID_STATUS
      );
    }

    if (req.clip.sessionId) await settleSessions(req.db, req.clip.sessionId);
    return res.sendSuccess("Clip uploaded", { clipId: req.clip.clipId, status: "Ready" });
  })
);

/**
 * POST /clips/:clipId/fail — the box could not make this clip
 */
router.post(
  "/clips/:clipId/fail",
  validateBody(failClipSchema),
  loadOpenClip,
  catchAsync(async (req, res) => {
    await req.db.query(
      `UPDATE clips SET status = 'Failed', failureReason = ?, deviceId = ?, dateUpdated = ?
       WHERE clipId = ? AND status IN ('Pending', 'Processing')`,
      [req.body.reason, req.device.deviceId, getCurrentTimestampLocal(), req.clip.clipId]
    );
    if (req.clip.sessionId) await settleSessions(req.db, req.clip.sessionId);
    return res.sendSuccess("Clip marked as failed");
  })
);

export default router;
