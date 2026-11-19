import express from "express";
import { catchAsync, validateParams } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal } from "../../../utils/dateUtils.js";
import { ERROR_CODES } from "../../../utils/APIError.js";
import { dynamicLimiter } from "../../../middlewares/rateLimiter.js";
import { CLIP_DURATION_SECONDS, clipShareUrl, sessionShareUrl } from "../../../utils/clips.js";
import { COURT_RECORDING_COLUMNS, onlineSince, requestClip } from "../../../utils/clipRequests.js";
import { materializeSessionParts, settleSessions, uploadPercent } from "../../../utils/sessions.js";
import { loadSessionVideos, toLockedVideo, toPublicVideo } from "../../../utils/sessionVideos.js";
import { gameUnlocked } from "../../../utils/payments.js";
import { loadCaptures } from "../../../utils/sessionCaptures.js";
import { signedDownloadUrl, signUploadUrl } from "../../../utils/file/signedUrl.js";
import {
  clipTokenParamsSchema,
  courtTokenParamsSchema,
  gameCodeParamsSchema,
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
 *   GET  /games/:payCode           CR-015: Find a game on the courtside device
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

// CR-015: Find a game by its code — a code is 6 characters from 31, so a few
// tries a minute per IP is plenty for staff and useless for guessing
const findGameLimiter = dynamicLimiter({
  points: parseInt(process.env.RATE_LIMIT_FIND_GAME_POINTS || "10", 10),
  duration: 60,
  keyGenerator: (req) => `find-game:${req.ip}`,
  message: "Too many tries — wait a minute and try again.",
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
      `SELECT s.sessionId, s.startAt, s.endAt, s.status, s.playerName, s.driveUrl, s.partCameras,
              s.wholeVideo, s.openEnded, s.paymentStatus, s.payCode,
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

    // CR-015: until it's paid at the desk, the page shows the game but nothing plays
    const locked = !gameUnlocked(rows[0]);
    const toVideo = locked ? toLockedVideo : toPublicVideo;

    // CR-003: the whole game, one video per camera
    const videos = await loadSessionVideos(req.db, rows[0].sessionId);
    // CR-013: stretches saved from the courtside device (no business IDs here)
    const captures = await loadCaptures(req.db, rows[0].sessionId, toVideo);

    // CR-004: players never see parts. Only a game from before whole videos
    // (wholeVideo 'Skipped' with saved parts) still lists its parts.
    const legacy = rows[0].wholeVideo === "Skipped";
    const parts = legacy
      ? await req.db.query(
          `SELECT partIndex, camera, windowStartAt, windowEndAt, durationSeconds, status,
                  videoPath, thumbnailPath, expiresAt
           FROM clips
           WHERE sessionId = ? AND status = 'Ready' AND videoPath IS NOT NULL
           ORDER BY partIndex ASC, camera ASC`,
          [rows[0].sessionId]
        )
      : [];

    const {
      sessionId: _sessionId,
      venueId: _venueId,
      logoUrl,
      driveUrl,
      partCameras: _partCameras,
      wholeVideo,
      openEnded,
      paymentStatus,
      payCode,
      ...info
    } = rows[0];
    // CR-005: an open game shows no end (and no start while it waits for a device)
    const open = Number(openEnded) === 1 && ["Waiting", "Recording"].includes(session.status);
    if (open) info.endAt = null;
    if (session.status === "Waiting") info.startAt = null;
    return res.sendSuccess("Session", {
      session: {
        ...info,
        status: session.status,
        venueLogoUrl: signUploadUrl(logoUrl),
        // CR-006: "Saving your game… uploading 45%" (null while the box makes the file)
        uploadPercent: uploadPercent(videos),
        openEnded: Number(openEnded) === 1,
        // CR-015: locked until paid at the front desk, where the player shows this code
        paymentStatus,
        locked,
        payCode: locked ? payCode : null,
        // CR-001: the game's folder in the venue's Google Drive, once a video is in it
        driveUrl:
          !locked && driveUrl && videos.some((v) => v.driveStatus === "Uploaded") ? driveUrl : null,
        // CR-003 / CR-006: one whole video per camera (camera 0 = the court's only camera)
        videos: videos.map(toVideo),
        // CR-013: saved stretches, oldest first ("Save 1 · 8:00 – 10:00")
        captures,
        // True while the whole video is still being made (the page keeps checking)
        savingWholeVideo:
          ["Processing", "Ready"].includes(session.status) &&
          (wholeVideo === null || wholeVideo === "Pending"),
        parts: parts.map(({ videoPath, thumbnailPath, ...part }) => ({
          ...part,
          videoUrl: locked ? null : signUploadUrl(videoPath),
          downloadUrl: locked ? null : signedDownloadUrl(videoPath),
          thumbnailUrl: signUploadUrl(thumbnailPath),
        })),
      },
    });
  })
);

/**
 * GET /games/:payCode
 * CR-015: Find a game on the courtside device's "Pair this device" screen,
 * after it unpaired. The code is the one the device and the locked page show.
 * The game's link (the download QR) only once it's paid; before that the
 * device says "Not paid yet — pay at the front desk".
 */
router.get(
  "/games/:payCode",
  findGameLimiter,
  validateParams(gameCodeParamsSchema),
  catchAsync(async (req, res) => {
    const rows = await req.db.query(
      `SELECT s.sessionId, s.startAt, s.endAt, s.status, s.openEnded, s.paymentStatus,
              s.shareToken, c.name AS courtName, v.name AS venueName
       FROM recording_sessions s
       JOIN courts c ON c.courtId = s.courtId
       JOIN venues v ON v.venueId = s.venueId
       WHERE s.payCode = ? AND s.status != 'Cancelled'
       LIMIT 1`,
      [req.params.payCode]
    );
    if (rows.length === 0) {
      return res.sendError("No game has that code — check it and try again", 404);
    }
    await settleSessions(req.db, rows[0].sessionId);
    const [now] = await req.db.query(
      `SELECT status FROM recording_sessions WHERE sessionId = ? LIMIT 1`,
      [rows[0].sessionId]
    );

    const game = rows[0];
    const paid = gameUnlocked(game);
    const open = Number(game.openEnded) === 1 && ["Waiting", "Recording"].includes(now.status);
    return res.sendSuccess(paid ? "Game found" : "Not paid yet — pay at the front desk", {
      game: {
        courtName: game.courtName,
        venueName: game.venueName,
        startAt: now.status === "Waiting" ? null : game.startAt,
        endAt: open ? null : game.endAt,
        status: now.status,
        paymentStatus: game.paymentStatus,
        paid,
        shareUrl: paid ? sessionShareUrl(game.shareToken) : null,
      },
    });
  })
);

export default router;
