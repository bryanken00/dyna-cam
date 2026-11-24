import express from "express";
import { catchAsync, validateParams, validateQuery } from "../../../utils/catchAsync.js";
import { dynamicLimiter } from "../../../middlewares/rateLimiter.js";
import { noIdempotencyCache } from "../../../middlewares/idempotency.middleware.js";
import {
  advanceSessions,
  endSessionNow,
  materializeSessionParts,
  settleSessions,
} from "../../../utils/sessions.js";
import { checkInBooking } from "../../../utils/bookingCheckIn.js";
import { sendBookingEmail } from "../../../utils/bookingEmails.js";
import { deleteCapture } from "../../../utils/sessionCaptures.js";
import { toEpochMs } from "../../../utils/clips.js";
import {
  loadDeviceSession,
  replayLink,
  sessionEnded,
  sessionRecording,
} from "../../../utils/sessionDevices.js";
import { clearStream, createStreamSetup } from "../../../utils/sessionStreams.js";
import {
  captureNumberParamsSchema,
  captureSavedAtQuerySchema,
  previewQuerySchema,
  sessionTokenParamsSchema,
} from "../../../validators/public.validator.js";

/**
 * CR-028: the courtside device's controls on the game's page — mounted at
 * /api/v1/public/sessions with NO login, next to public.controller.js. The
 * game's share link is the credential, so anyone holding it can use these
 * (the requester accepted that; a player-started game, CR-027, has no device).
 * Same rules as the device's /app/session routes; replies carry no IDs.
 *
 *   POST   /:shareToken/end                 End game (the game so far is saved)
 *   POST   /:shareToken/resume              CR-041: record the rest of the booked time
 *   DELETE /:shareToken/captures/:number    delete Save N (?savedAt= as shown)
 *   POST   /:shareToken/stream-link         a setup link for the player's own stream
 *   POST   /:shareToken/stream/stop         stop the player's stream
 *   GET    /:shareToken/preview?from&to     CR-029: replay a stretch before saving it
 */
const router = express.Router();

// Per IP: a few taps a minute is plenty for one game's controls
const controlLimiter = dynamicLimiter({
  points: parseInt(process.env.RATE_LIMIT_PUBLIC_CONTROL_POINTS || "20", 10),
  duration: 60,
  keyGenerator: (req) => `public-control:${req.ip}`,
  message: "Too many tries — wait a moment and try again.",
});

/** The game by its share link (not cancelled), brought up to date; null if none. */
const loadGame = async (db, shareToken) => {
  const rows = await db.query(
    `SELECT sessionId, venueId FROM recording_sessions
     WHERE shareToken = ? AND status != 'Cancelled' LIMIT 1`,
    [shareToken]
  );
  if (rows.length === 0) return null;
  await materializeSessionParts(db, { venueId: rows[0].venueId });
  await settleSessions(db, rows[0].sessionId);
  return loadDeviceSession(db, rows[0].sessionId);
};

const NOT_FOUND = "This session link is not valid";

/**
 * POST /:shareToken/end — End game, as the device's Stop.
 */
router.post(
  "/:shareToken/end",
  controlLimiter,
  validateParams(sessionTokenParamsSchema),
  catchAsync(async (req, res) => {
    const game = await loadGame(req.db, req.params.shareToken);
    if (!game) return res.sendError(NOT_FOUND, 404);
    if (!sessionRecording(game)) {
      return res.sendError(
        game.status === "Scheduled" ? "The game hasn't started yet" : "The game has ended",
        409
      );
    }
    const result = await endSessionNow(req.db, game.sessionId);
    if (!result.ok) return res.sendError("The game has ended", 409);
    return res.sendSuccess("Game ended — your whole game is being saved");
  })
);

/**
 * POST /:shareToken/resume — CR-041: a booked game ended early → a new game
 * for the rest of the booked time (checkInBooking decides). 201 { shareToken,
 * shareUrl } of the new game; 200 with the running one when it already
 * resumed (a double tap, another phone); 409 while this game still records or
 * once the booked time is over.
 */
router.post(
  "/:shareToken/resume",
  controlLimiter,
  validateParams(sessionTokenParamsSchema),
  catchAsync(async (req, res) => {
    const rows = await req.db.query(
      `SELECT bookingId, venueId FROM recording_sessions
       WHERE shareToken = ? AND status != 'Cancelled' LIMIT 1`,
      [req.params.shareToken]
    );
    if (rows.length === 0) return res.sendError(NOT_FOUND, 404);
    if (!rows[0].bookingId) return res.sendError("Only a booked game can be resumed", 409);
    await advanceSessions(req.db, { venueId: rows[0].venueId });

    let conn;
    let result;
    try {
      conn = await req.db.beginTransaction();
      result = await checkInBooking(conn, {
        bookingId: rows[0].bookingId,
        requireRecorderOnline: true,
      });
      if (result.ok) await req.db.commit(conn);
      else await req.db.rollback(conn);
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }

    if (!result.ok) return res.sendError(result.message, null, result.status, result.code);
    if (result.alreadyCheckedIn) {
      if (result.shareToken === req.params.shareToken) {
        return res.sendError("The game is still recording", 409);
      }
      return res.sendSuccess(
        "Recording already resumed",
        { shareToken: result.shareToken, shareUrl: result.shareUrl },
        200
      );
    }
    await sendBookingEmail(req.db, rows[0].bookingId, "GameStarted");
    return res.sendSuccess(
      "Recording resumed",
      { shareToken: result.shareToken, shareUrl: result.shareUrl },
      201
    );
  })
);

/**
 * DELETE /:shareToken/captures/:number?savedAt= — delete Save N. The number is
 * its place among the game's saves (oldest first, as the page lists them);
 * savedAt must match, so a number that moved deletes nothing (404).
 */
router.delete(
  "/:shareToken/captures/:number",
  controlLimiter,
  validateParams(captureNumberParamsSchema),
  validateQuery(captureSavedAtQuerySchema),
  catchAsync(async (req, res) => {
    const game = await loadGame(req.db, req.params.shareToken);
    if (!game) return res.sendError(NOT_FOUND, 404);
    // The same order as loadCaptures (utils/sessionCaptures.js)
    const saves = await req.db.query(
      `SELECT captureId, dateCreated FROM session_captures
       WHERE sessionId = ? AND status = 'Active'
       ORDER BY dateCreated ASC, id ASC`,
      [game.sessionId]
    );
    const target = saves[req.params.number - 1];
    if (!target || target.dateCreated !== req.query.savedAt) {
      return res.sendError("That save is gone — reload the page", 404);
    }
    const deleted = await deleteCapture(req.db, {
      sessionId: game.sessionId,
      captureId: target.captureId,
    });
    if (!deleted) return res.sendError("That save is gone — reload the page", 404);
    return res.sendSuccess("Save deleted");
  })
);

/**
 * POST /:shareToken/stream-link — a fresh setup link for the player's own
 * Facebook / YouTube stream (the page opens it); the previous one stops working.
 */
router.post(
  "/:shareToken/stream-link",
  controlLimiter,
  validateParams(sessionTokenParamsSchema),
  catchAsync(async (req, res) => {
    const game = await loadGame(req.db, req.params.shareToken);
    if (!game) return res.sendError(NOT_FOUND, 404);
    if (sessionEnded(game)) return res.sendError("The game has ended", 409);
    const link = await createStreamSetup(req.db, game.sessionId);
    noIdempotencyCache(res); // the code is a credential
    return res.sendSuccess("Add your live stream", { url: link.url }, 201);
  })
);

/**
 * POST /:shareToken/stream/stop — stop the player's stream (the recording goes on).
 */
router.post(
  "/:shareToken/stream/stop",
  controlLimiter,
  validateParams(sessionTokenParamsSchema),
  catchAsync(async (req, res) => {
    const game = await loadGame(req.db, req.params.shareToken);
    if (!game) return res.sendError(NOT_FOUND, 404);
    await clearStream(req.db, game.sessionId);
    return res.sendSuccess("Live stream stopped");
  })
);

/**
 * GET /:shareToken/preview?from=&to= — CR-029: a signed link to replay the
 * stretch from → to (seconds into the game) from the venue's recorder box,
 * the page's Preview before a save. Only inside the game played so far; the
 * box serves only the stretch it was signed for. Like the live view it plays
 * on the venue Wi-Fi.
 */
router.get(
  "/:shareToken/preview",
  controlLimiter,
  validateParams(sessionTokenParamsSchema),
  validateQuery(previewQuerySchema),
  catchAsync(async (req, res) => {
    const game = await loadGame(req.db, req.params.shareToken);
    if (!game) return res.sendError(NOT_FOUND, 404);
    const nowMs = Date.now();
    const startMs = toEpochMs(game.startAt);
    if (!["Recording", "Processing", "Ready"].includes(game.status) || startMs > nowMs) {
      return res.sendError("The game hasn't started yet", 409);
    }
    // The game played so far (all of it once it has ended)
    const playedSeconds = Math.floor((Math.min(nowMs, toEpochMs(game.endAt)) - startMs) / 1000);
    const from = Number(req.query.from);
    const to = Math.min(Number(req.query.to), playedSeconds);
    if (to - from < 1) {
      return res.sendError("Pick a stretch of the game played so far", 400);
    }
    const link = await replayLink(req.db, game, {
      fromMs: startMs + from * 1000,
      toMs: startMs + to * 1000,
    });
    if (!link) {
      return res.sendError(
        "The court's recorder can't be reached for a preview right now",
        null,
        503
      );
    }
    noIdempotencyCache(res);
    return res.sendSuccess("Preview", { preview: { ...link, fromSeconds: from, toSeconds: to } });
  })
);

export default router;
