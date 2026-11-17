import express from "express";
import { catchAsync, validateParams } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal } from "../../../utils/dateUtils.js";
import { ERROR_CODES } from "../../../utils/APIError.js";
import { dynamicLimiter } from "../../../middlewares/rateLimiter.js";
import { CLIP_DURATION_SECONDS, clipShareUrl } from "../../../utils/clips.js";
import { COURT_RECORDING_COLUMNS, onlineSince, requestClip } from "../../../utils/clipRequests.js";
import { materializeSessionParts, partCount, settleSessions } from "../../../utils/sessions.js";
import { signedDownloadUrl, signUploadUrl } from "../../../utils/file/signedUrl.js";
import {
  clipTokenParamsSchema,
  courtTokenParamsSchema,
  sessionTokenParamsSchema,
} from "../../../validators/public.validator.js";

/**
 * Player routes (PLAN-001) — mounted at /api/v1/public with NO login.
 * Anyone holding a court's QR code or a clip's share link can use them, so they
 * reveal only what the player's page shows (no IDs, no camera details) and the
 * write is rate-limited.
 *
 *   GET  /courts/:qrToken          the court page
 *   POST /courts/:qrToken/clips    save the last 60 seconds
 *   GET  /clips/:shareToken        the clip page (polls until Ready)
 *   GET  /sessions/:shareToken     a recorded session's page (its parts)
 */
const router = express.Router();

// Per IP: a player saving a clip every few seconds is plenty. Someone with a
// photo of the QR code can't flood the recorder (the per-court cooldown below
// also merges bursts into one clip).
const saveClipLimiter = dynamicLimiter({
  points: parseInt(process.env.RATE_LIMIT_PUBLIC_CLIP_POINTS || "10", 10),
  duration: 60,
  message: "Too many saves — wait a moment and try again.",
});

const COURT_BY_TOKEN = `
  SELECT ${COURT_RECORDING_COLUMNS}
  FROM courts c
  JOIN venues v ON v.venueId = c.venueId
  WHERE c.qrToken = ? AND c.status = 'Active' AND v.status = 'Active'`;

/**
 * GET /courts/:qrToken
 */
router.get(
  "/courts/:qrToken",
  validateParams(courtTokenParamsSchema),
  catchAsync(async (req, res) => {
    const rows = await req.db.query(`${COURT_BY_TOKEN} LIMIT 1`, [
      onlineSince(),
      req.params.qrToken,
    ]);
    if (rows.length === 0) {
      return res.sendError("This court code is not valid", 404);
    }

    const court = rows[0];
    return res.sendSuccess("Court", {
      court: {
        name: court.name,
        venueName: court.venueName,
        venueLogoUrl: signUploadUrl(court.logoUrl),
        cameraReady: Boolean(court.hasCamera) && Boolean(court.recorderOnline),
        // Phase 5: where to watch this court live (when the venue streams it)
        liveWatchUrl:
          court.streamEnabled && court.recorderOnline ? court.streamWatchUrl || null : null,
        clipSeconds: CLIP_DURATION_SECONDS,
      },
    });
  })
);

/**
 * POST /courts/:qrToken/clips
 * Save the last CLIP_DURATION_SECONDS. A save on the same court within
 * CLIP_COOLDOWN_SECONDS of another returns that clip instead (200, merged) —
 * four players tapping after the same rally get one clip, not four.
 * The rules live in utils/clipRequests.js (shared with the button and staff save).
 */
router.post(
  "/courts/:qrToken/clips",
  saveClipLimiter,
  validateParams(courtTokenParamsSchema),
  catchAsync(async (req, res) => {
    let conn;
    let result;
    try {
      conn = await req.db.beginTransaction();

      const [courts] = await conn.execute(`${COURT_BY_TOKEN} LIMIT 1`, [
        onlineSince(),
        req.params.qrToken,
      ]);
      if (courts.length === 0) {
        await req.db.rollback(conn);
        return res.sendError("This court code is not valid", 404);
      }

      result = await requestClip(conn, courts[0], {
        source: "QR",
        requestedAt: getCurrentTimestampLocal(),
      });
      await req.db.commit(conn);
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }

    if (!result.ok) {
      return res.sendError(
        "This court's camera is offline right now, so nothing can be saved. Please tell the front desk.",
        null,
        503,
        ERROR_CODES.CAMERA_OFFLINE
      );
    }

    const body = {
      shareToken: result.shareToken,
      shareUrl: clipShareUrl(result.shareToken),
      merged: result.merged,
    };
    return result.merged
      ? res.sendSuccess("Already saving this moment", body)
      : res.sendSuccess("Saving your clip", body, 201);
  })
);

/**
 * GET /clips/:shareToken
 * The player's clip page polls this until the clip is Ready (or Failed).
 * Video and thumbnail links are signed and expiring, and only given out while
 * the clip is Ready.
 */
router.get(
  "/clips/:shareToken",
  validateParams(clipTokenParamsSchema),
  catchAsync(async (req, res) => {
    const rows = await req.db.query(
      `SELECT cl.status, cl.requestedAt, cl.durationSeconds, cl.expiresAt, cl.videoPath,
              cl.thumbnailPath, cl.price, cl.paymentStatus, cl.payCode, cl.driveStatus,
              cl.driveUrl, c.name AS courtName, v.name AS venueName, v.logoUrl
       FROM clips cl
       JOIN courts c ON c.courtId = cl.courtId
       JOIN venues v ON v.venueId = cl.venueId
       WHERE cl.shareToken = ? AND cl.status != 'Deleted'
       LIMIT 1`,
      [req.params.shareToken]
    );
    if (rows.length === 0) {
      return res.sendError("This clip link is not valid", 404);
    }

    const clip = rows[0];
    const ready = clip.status === "Ready";
    // An unpaid clip shows only its thumbnail until it is paid at the desk
    const locked = clip.paymentStatus === "Unpaid";
    const playable = ready && !locked;
    return res.sendSuccess("Clip", {
      clip: {
        // Processing is an internal step; to the player it is still "saving"
        status: clip.status === "Processing" ? "Pending" : clip.status,
        requestedAt: clip.requestedAt,
        durationSeconds: clip.durationSeconds,
        expiresAt: ready ? clip.expiresAt : null,
        courtName: clip.courtName,
        venueName: clip.venueName,
        venueLogoUrl: signUploadUrl(clip.logoUrl),
        videoUrl: playable ? signUploadUrl(clip.videoPath) : null,
        downloadUrl: playable ? signedDownloadUrl(clip.videoPath) : null,
        thumbnailUrl: ready ? signUploadUrl(clip.thumbnailPath) : null,
        price: Number(clip.price),
        paymentStatus: clip.paymentStatus,
        locked,
        // Shown to the player to pay at the front desk (only while unpaid)
        payCode: locked ? clip.payCode : null,
        // CR-001: the copy in the venue's Google Drive — paid or free clips only,
        // and still there after the server's copy expired
        driveUrl:
          !locked && clip.driveStatus === "Uploaded" && ["Ready", "Expired"].includes(clip.status)
            ? clip.driveUrl
            : null,
      },
    });
  })
);

/**
 * GET /sessions/:shareToken
 * A booked recording session: its window, status, and each 5-minute part as
 * it becomes ready (the page polls while the session is still going).
 */
router.get(
  "/sessions/:shareToken",
  validateParams(sessionTokenParamsSchema),
  catchAsync(async (req, res) => {
    const rows = await req.db.query(
      `SELECT s.sessionId, s.startAt, s.endAt, s.status, s.playerName, s.driveUrl,
              c.name AS courtName, v.name AS venueName, v.logoUrl, s.venueId
       FROM recording_sessions s
       JOIN courts c ON c.courtId = s.courtId
       JOIN venues v ON v.venueId = s.venueId
       WHERE s.shareToken = ? AND s.status != 'Cancelled'
       LIMIT 1`,
      [req.params.shareToken]
    );
    if (rows.length === 0) {
      return res.sendError("This session link is not valid", 404);
    }

    // Bring the session up to date (parts due, settled status)
    await materializeSessionParts(req.db, { venueId: rows[0].venueId });
    await settleSessions(req.db, rows[0].sessionId);
    const [session] = await req.db.query(
      `SELECT status FROM recording_sessions WHERE sessionId = ? LIMIT 1`,
      [rows[0].sessionId]
    );

    const parts = await req.db.query(
      `SELECT partIndex, windowStartAt, windowEndAt, durationSeconds, status, videoPath,
              thumbnailPath, expiresAt, driveStatus, driveUrl
       FROM clips
       WHERE sessionId = ? AND status != 'Deleted'
       ORDER BY partIndex ASC`,
      [rows[0].sessionId]
    );

    const { sessionId: _sessionId, venueId: _venueId, logoUrl, driveUrl, ...info } = rows[0];
    const inDrive = (part) => part.driveStatus === "Uploaded" && Boolean(part.driveUrl);
    return res.sendSuccess("Session", {
      session: {
        ...info,
        status: session.status,
        venueLogoUrl: signUploadUrl(logoUrl),
        partsTotal: partCount(info.startAt, info.endAt),
        // CR-001: the game's folder in the venue's Google Drive, once a part is in it
        driveUrl: driveUrl && parts.some(inDrive) ? driveUrl : null,
        parts: parts.map(
          ({ videoPath, thumbnailPath, driveStatus, driveUrl: partDriveUrl, ...part }) => {
            const ready = part.status === "Ready";
            return {
              ...part,
              // To the player a part being cut is still "saving"
              status: part.status === "Processing" ? "Pending" : part.status,
              videoUrl: ready ? signUploadUrl(videoPath) : null,
              downloadUrl: ready ? signedDownloadUrl(videoPath) : null,
              thumbnailUrl: ready ? signUploadUrl(thumbnailPath) : null,
              driveUrl: inDrive({ driveStatus, driveUrl: partDriveUrl }) ? partDriveUrl : null,
            };
          }
        ),
      },
    });
  })
);

export default router;
