import express from "express";
import { catchAsync, validateBody, validateParams } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal, moment } from "../../../utils/dateUtils.js";
import { dynamicLimiter } from "../../../middlewares/rateLimiter.js";
import { sessionShareUrl } from "../../../utils/clips.js";
import { COURT_RECORDING_COLUMNS, onlineSince } from "../../../utils/clipRequests.js";
import {
  advanceSessions,
  materializeSessionParts,
  settleSessions,
  uploadPercent,
} from "../../../utils/sessions.js";
import { BOOKED_GAME_MAX_CAPTURES, checkInBooking } from "../../../utils/bookingCheckIn.js";
import { sendBookingEmail } from "../../../utils/bookingEmails.js";
import { loadSessionVideos, toLockedVideo, toPublicVideo } from "../../../utils/sessionVideos.js";
import { gameUnlocked } from "../../../utils/payments.js";
import {
  CAPTURE_MIN_SECONDS,
  CAPTURE_REFUSALS,
  captureLimits,
  createCapture,
  loadCaptures,
} from "../../../utils/sessionCaptures.js";
import {
  liveLink,
  loadDeviceSession,
  sessionEnded,
  sessionRecording,
  toDeviceSession,
} from "../../../utils/sessionDevices.js";
import { describeStream } from "../../../utils/sessionStreams.js";
import { signedDownloadUrl, signUploadUrl } from "../../../utils/file/signedUrl.js";
import { captureSchema } from "../../../validators/app.validator.js";
import {
  checkInCodeSchema,
  clipTokenParamsSchema,
  courtTokenParamsSchema,
  gameCodeParamsSchema,
  sessionTokenParamsSchema,
} from "../../../validators/public.validator.js";

/**
 * Player routes (PLAN-001) — mounted at /api/v1/public with NO login.
 * Anyone holding a court's QR code or a share link can use them, so they
 * reveal only what the player's page shows (no IDs, no camera details) and the
 * writes are rate-limited.
 *
 *   GET  /courts/:qrToken          the court's page — CR-034: check in with a booking code
 *   POST /courts/:qrToken/check-in PLAN-003 Phase D: start the booked game by its code
 *   (CR-034 removed CR-027's POST /courts/:qrToken/games: no game without a booking)
 *   GET  /clips/:shareToken        a clip saved before CR-027 (polls until Ready)
 *   GET  /sessions/:shareToken     a recorded session's page (its parts; CR-025: live view)
 *   POST /sessions/:shareToken/captures   CR-025: Save the last … from the game's page
 *   (CR-028: End game, delete a save and the player's stream are in game-controls.controller.js)
 *   GET  /games/:payCode           CR-015: Find a game on the courtside device
 */
const router = express.Router();

// CR-015: Find a game by its code — a code is 6 characters from 31, so a few
// tries a minute per IP is plenty for staff and useless for guessing
const findGameLimiter = dynamicLimiter({
  points: parseInt(process.env.RATE_LIMIT_FIND_GAME_POINTS || "10", 10),
  duration: 60,
  keyGenerator: (req) => `find-game:${req.ip}`,
  message: "Too many tries — wait a minute and try again.",
});

// CR-025: Save the last … from the game's page. The game's limit (CR-013) caps
// what a link holder can add; this keeps one phone from hammering the route.
const saveCaptureLimiter = dynamicLimiter({
  points: parseInt(process.env.RATE_LIMIT_PUBLIC_CAPTURE_POINTS || "10", 10),
  duration: 60,
  keyGenerator: (req) => `public-capture:${req.ip}`,
  message: "Too many saves — wait a moment and try again.",
});

/** A game by its share link (not cancelled), for the routes below. */
const SESSION_BY_TOKEN = `SELECT sessionId, venueId FROM recording_sessions
  WHERE shareToken = ? AND status != 'Cancelled' LIMIT 1`;

/**
 * CR-025: what the game's page needs to show the court device's live view and
 * "Save the last …" — the same signed LAN link as GET /app/session (null unless
 * recording), and the save limits with the time played so far. CR-028: and the
 * player's own stream, as the device shows it.
 */
const liveAndCapture = async (db, sessionId, captureCount) => {
  const row = await loadDeviceSession(db, sessionId);
  const now = Date.now();
  if (!row) return { live: null, capture: null, stream: null, canStream: false };
  const recording = sessionRecording(row, now);
  return {
    live: await liveLink(db, row, now),
    stream: await describeStream(db, row, now),
    canStream: !sessionEnded(row, now),
    capture: {
      minSeconds: CAPTURE_MIN_SECONDS,
      available: recording,
      maxPerGame: captureLimits(row).maxPerGame,
      used: captureCount,
      playedSeconds: recording ? toDeviceSession(row, now).elapsedSeconds : 0,
    },
  };
};

const COURT_BY_TOKEN = `
  SELECT ${COURT_RECORDING_COLUMNS}
  FROM courts c
  JOIN venues v ON v.venueId = c.venueId
  WHERE c.qrToken = ? AND c.status = 'Active' AND v.status = 'Active'
  LIMIT 1`;

const findCourt = async (db, qrToken) => {
  const rows = await db.query(COURT_BY_TOKEN, [onlineSince(), qrToken]);
  return rows[0] || null;
};

/**
 * GET /courts/:qrToken
 * The court's QR page — the court, and whether a game is on
 * it now (and until when).
 */
router.get(
  "/courts/:qrToken",
  validateParams(courtTokenParamsSchema),
  catchAsync(async (req, res) => {
    const court = await findCourt(req.db, req.params.qrToken);
    if (!court) {
      return res.sendError("This court code is not valid", 404);
    }

    // Statuses and open games' windows up to date before reading them
    await advanceSessions(req.db, { venueId: court.venueId });
    const now = getCurrentTimestampLocal();
    const [current] = await req.db.query(
      `SELECT endAt, openEnded FROM recording_sessions
       WHERE courtId = ? AND status NOT IN ('Cancelled', 'Failed')
         AND startAt <= ? AND endAt > ?
       ORDER BY startAt ASC
       LIMIT 1`,
      [court.courtId, now, now]
    );

    // PLAN-003 Phase D: a booking that holds the court now (or opens for check-in
    // soon). CR-034: the page always asks for a booking code; this only says when
    const [booked] = await req.db.query(
      `SELECT b.startAt, b.endAt FROM bookings b
       JOIN venues v ON v.venueId = b.venueId
       WHERE b.courtId = ? AND b.status IN ('Confirmed', 'Pending')
         AND (b.status = 'Confirmed' OR b.holdExpiresAt > ?)
         AND b.startAt <= DATE_ADD(?, INTERVAL v.checkInEarlyMinutes MINUTE) AND b.endAt > ?
       ORDER BY b.startAt ASC
       LIMIT 1`,
      [court.courtId, now, now, now]
    );
    const [venue] = await req.db.query(
      `SELECT bookingToken FROM venues WHERE venueId = ? LIMIT 1`,
      [court.venueId]
    );

    return res.sendSuccess("Court", {
      court: {
        name: court.name,
        venueName: court.venueName,
        venueLogoUrl: signUploadUrl(court.logoUrl),
        cameraReady: Boolean(court.hasCamera) && Boolean(court.recorderOnline),
        // Phase 5: where to watch this court live (when the venue streams it)
        liveWatchUrl:
          court.streamEnabled && court.recorderOnline ? court.streamWatchUrl || null : null,
        // A game is on the court now; busyUntil is when it ends (null: open-ended)
        busy: Boolean(current),
        busyUntil: current && Number(current.openEnded) !== 1 ? current.endAt : null,
        // A booked game's saves (CR-034: the only game the QR starts)
        maxSaves: BOOKED_GAME_MAX_CAPTURES,
        // PLAN-003: booked now → check in with the booking code (no names, no code)
        booking: !current && booked ? { from: booked.startAt, until: booked.endAt } : null,
        // CR-030: "Book this court ahead" — the venue's booking link (null: booking off)
        bookingToken: venue?.bookingToken || null,
      },
    });
  })
);

// PLAN-003 Phase D: a booking code is 6 characters from 31, but one court has
// only its current booking to match — a few tries per IP and per court are
// plenty for a player and useless for guessing
const checkInByCodeLimiter = dynamicLimiter({
  points: parseInt(process.env.RATE_LIMIT_PUBLIC_CHECKIN_POINTS || "10", 10),
  duration: 60,
  keyGenerator: (req) => `court-checkin:${req.ip}`,
  message: "Too many tries — wait a minute and try again.",
});
const checkInByCodeCourtLimiter = dynamicLimiter({
  points: parseInt(process.env.RATE_LIMIT_COURT_CHECKIN_POINTS || "20", 10),
  duration: 600,
  keyGenerator: (req) => `court-checkin-court:${req.params.qrToken}`,
  message: "Too many tries on this court — ask the front desk to check you in.",
});

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";
const WRONG_CODE =
  "That code doesn't match a booking on this court — check the code on your booking page";

/**
 * BUG-007: a code that isn't this court's booking right now — is it a real
 * booking at this venue that's just not checkable here and now (too early,
 * over, cancelled, another court)? The player holds the code, so telling them
 * about their own booking gives nothing away; a code that matches nothing at
 * this venue still gets the one wrong-code message.
 *
 * @returns {Promise<string|null>} what to tell the player, or null (no such booking here)
 */
const explainCode = async (db, court, bookingCode, now) => {
  const [b] = await db.query(
    `SELECT b.courtId, b.status, b.startAt, b.endAt, c.name AS courtName, v.checkInEarlyMinutes
     FROM bookings b
     JOIN courts c ON c.courtId = b.courtId
     JOIN venues v ON v.venueId = b.venueId
     WHERE b.venueId = ? AND b.bookingCode = ? AND b.status != 'Deleted'
     ORDER BY b.startAt DESC
     LIMIT 1`,
    [court.venueId, bookingCode]
  );
  if (!b) return null;

  const start = moment.tz(b.startAt, FORMAT, TIMEZONE);
  const end = moment.tz(b.endAt, FORMAT, TIMEZONE);
  const opens = start.clone().subtract(b.checkInEarlyMinutes, "minutes");
  const nowM = moment.tz(now, FORMAT, TIMEZONE);
  const sameDay = start.isSame(nowM, "day");
  const when = `${sameDay ? "" : `${start.format("ddd, MMM D")}, `}${start.format("h:mm A")} – ${end.format("h:mm A")}`;

  if (b.status === "Cancelled") return "This booking was cancelled.";
  if (b.status === "Expired") return "This booking wasn't paid in time, so the court was released.";
  if (b.status === "NoShow" || b.status === "Completed" || b.endAt <= now) {
    return `This booking (${when}) is over.`;
  }
  if (b.courtId !== court.courtId) {
    return `This code is for ${b.courtName} — scan the QR sign on ${b.courtName}.`;
  }
  if (opens.isAfter(nowM)) {
    return sameDay
      ? `Too early — your booking is ${when}. Check in from ${opens.format("h:mm A")}.`
      : `Your booking is on ${when}. Check in from ${opens.format("h:mm A")} that day.`;
  }
  return null;
};

/**
 * POST /courts/:qrToken/check-in
 * PLAN-003 Phase D: the player scanned the court's QR and typed their booking
 * code → the booking's recorded game starts (for its booked time only).
 * Body: { bookingCode }. 201 { shareToken, shareUrl } (200 when already in).
 * A wrong code says nothing about the court's bookings.
 */
router.post(
  "/courts/:qrToken/check-in",
  checkInByCodeLimiter,
  checkInByCodeCourtLimiter,
  validateParams(courtTokenParamsSchema),
  validateBody(checkInCodeSchema),
  catchAsync(async (req, res) => {
    const court = await findCourt(req.db, req.params.qrToken);
    if (!court) {
      return res.sendError("This court code is not valid", 404);
    }
    await advanceSessions(req.db, { venueId: court.venueId });
    const now = getCurrentTimestampLocal();

    // The code must be this court's booking, in (or about to open) its time
    const [booking] = await req.db.query(
      `SELECT b.bookingId FROM bookings b
       JOIN venues v ON v.venueId = b.venueId
       WHERE b.courtId = ? AND b.bookingCode = ?
         AND b.status IN ('Confirmed', 'CheckedIn', 'Pending')
         AND b.startAt <= DATE_ADD(?, INTERVAL v.checkInEarlyMinutes MINUTE) AND b.endAt > ?
       LIMIT 1`,
      [court.courtId, req.body.bookingCode, now, now]
    );
    if (!booking) {
      // BUG-007: a real booking that just can't check in here now says why
      const reason = await explainCode(req.db, court, req.body.bookingCode, now);
      return reason ? res.sendError(reason, 409) : res.sendError(WRONG_CODE, 404);
    }

    let conn;
    let result;
    try {
      conn = await req.db.beginTransaction();
      result = await checkInBooking(conn, {
        bookingId: booking.bookingId,
        requireRecorderOnline: true,
      });
      if (result.ok) await req.db.commit(conn);
      else await req.db.rollback(conn);
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }

    if (!result.ok) {
      return res.sendError(result.message, null, result.status, result.code);
    }
    // PLAN-003 Phase G: the game page link, by email
    if (!result.alreadyCheckedIn) await sendBookingEmail(req.db, booking.bookingId, "GameStarted");
    return res.sendSuccess(
      result.status === "Scheduled"
        ? "Checked in — recording starts at your booked time"
        : "Checked in — the camera is recording",
      { shareToken: result.shareToken, shareUrl: result.shareUrl },
      result.alreadyCheckedIn ? 200 : 201
    );
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
        // CR-001: the copy in the venue's Google Drive — paid or free clips only.
        // CR-017: only while the clip is kept and its Drive copy is there (CR-026: 2 days)
        driveUrl:
          !locked && clip.driveStatus === "Uploaded" && clip.status === "Ready"
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
    // CR-025: the court's live video and Save the last … while recording
    const { live, capture, stream, canStream } = await liveAndCapture(
      req.db,
      rows[0].sessionId,
      captures.length
    );
    return res.sendSuccess("Session", {
      live,
      capture,
      // CR-028: the player's own Facebook / YouTube stream (null = none)
      stream,
      canStream,
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
        // (CR-017: while a video in it is still kept)
        driveUrl:
          !locked &&
          driveUrl &&
          videos.some((v) => v.driveStatus === "Uploaded" && v.status === "Ready")
            ? driveUrl
            : null,
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
 * POST /sessions/:shareToken/captures
 * CR-025: Save the last `seconds` of the game from its page (CR-029: or the
 * stretch `fromSeconds` → `toSeconds`, seconds into the game) — the same save as
 * the court device's (CR-013): while recording, after the first minute, up to
 * the game's limit, a double tap returns the save already made. The save has
 * no paired device. It shows under "Your saves" (locked until paid, CR-015).
 */
router.post(
  "/sessions/:shareToken/captures",
  saveCaptureLimiter,
  validateParams(sessionTokenParamsSchema),
  validateBody(captureSchema),
  catchAsync(async (req, res) => {
    const rows = await req.db.query(SESSION_BY_TOKEN, [req.params.shareToken]);
    if (rows.length === 0) {
      return res.sendError("This session link is not valid", 404);
    }
    // The game's status up to date (it may have just reached its end time)
    await materializeSessionParts(req.db, { venueId: rows[0].venueId });
    await settleSessions(req.db, rows[0].sessionId);

    const result = await createCapture(req.db, {
      sessionId: rows[0].sessionId,
      pairedAppId: null,
      seconds: req.body.seconds,
      // CR-029: or the stretch picked with both handles
      fromSeconds: req.body.fromSeconds,
      toSeconds: req.body.toSeconds,
    });
    if (!result.ok) {
      const refusal = CAPTURE_REFUSALS[result.reason];
      return res.sendError(refusal.message, null, refusal.status, result.reason);
    }
    // No IDs on the player's routes: the page re-reads the game to show it
    return res.sendSuccess(
      "Saving — it'll be on this page in a few minutes",
      { repeated: result.repeated },
      result.repeated ? 200 : 201
    );
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
