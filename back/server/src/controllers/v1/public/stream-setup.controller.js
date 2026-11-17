import express from "express";
import { catchAsync, validateBody, validateParams } from "../../../utils/catchAsync.js";
import { dynamicLimiter } from "../../../middlewares/rateLimiter.js";
import { toEpochMs } from "../../../utils/clips.js";
import { materializeSessionParts } from "../../../utils/sessions.js";
import {
  buildStreamUrl,
  clearStream,
  describeStream,
  findSessionBySetupCode,
  saveStream,
  saveStreamLayout,
} from "../../../utils/sessionStreams.js";
import {
  saveStreamSchema,
  streamLayoutSchema,
  streamSetupParamsSchema,
} from "../../../validators/public.validator.js";

/**
 * A player's own live stream (PLAN-002 Phase G) — mounted at
 * /api/v1/public/stream-setup with NO login. The session device shows a QR of
 * a short-lived setup code; the player opens it on their own phone and pastes
 * their Facebook / YouTube stream key. The code is the credential: it works
 * for 15 minutes, and once a stream is saved with it, until the session ends.
 *
 *   GET    /:code   the session (court, venue, times) and its stream (masked)
 *   PUT    /:code   save { platform, streamKey, layout? } or { platform: "OTHER", url, layout? },
 *                   or { layout } alone to switch cameras (Phase H)
 *   DELETE /:code   stop the stream
 *
 * The key is never returned — only a masked address.
 */
const router = express.Router();

const setupLimiter = dynamicLimiter({
  points: parseInt(process.env.RATE_LIMIT_STREAM_SETUP_POINTS || "30", 10),
  duration: 60,
  keyGenerator: (req) => `stream-setup:${req.ip}`,
  message: "Too many tries — wait a minute and try again.",
});

const EXPIRED = "This link has expired — ask for a new QR on the court's device";

/** Load the code's session (its status brought up to date), or answer 404. */
const withSession = catchAsync(async (req, res, next) => {
  const found = await findSessionBySetupCode(req.db, req.params.code);
  if (!found) return res.sendError(EXPIRED, 404);
  await materializeSessionParts(req.db, { venueId: found.venueId });
  const row = await findSessionBySetupCode(req.db, req.params.code);
  if (!row) return res.sendError(EXPIRED, 404);
  req.streamSession = row;
  next();
});

const secondsUntil = (at) => Math.max(0, Math.round((toEpochMs(at) - Date.now()) / 1000));

/**
 * GET /:code
 */
router.get(
  "/:code",
  setupLimiter,
  validateParams(streamSetupParamsSchema),
  withSession,
  catchAsync(async (req, res) => {
    const row = req.streamSession;
    return res.sendSuccess("Live stream setup", {
      setup: {
        courtName: row.courtName,
        venueName: row.venueName,
        startAt: row.startAt,
        endAt: row.endAt,
        sessionStatus: row.status,
        // Phase H: 2 → the player can pick Cam 1 / Cam 2 / Both
        cameras: row.hasCamera2 ? 2 : 1,
        expiresAt: row.streamSetupExpiresAt,
        expiresInSeconds: secondsUntil(row.streamSetupExpiresAt),
      },
      stream: await describeStream(req.db, row),
    });
  })
);

/**
 * PUT /:code — save (or change) the player's stream
 */
/** A key (with platform), or a layout-only change of the saved stream. */
const validateStreamBody = (req, res, next) =>
  validateBody(req.body?.platform === undefined ? streamLayoutSchema : saveStreamSchema)(
    req,
    res,
    next
  );

router.put(
  "/:code",
  setupLimiter,
  validateParams(streamSetupParamsSchema),
  validateStreamBody,
  withSession,
  catchAsync(async (req, res) => {
    if (req.body.platform === undefined) {
      if (!req.streamSession.streamUrl) {
        return res.sendError("Add your stream key first", 409);
      }
      await saveStreamLayout(req.db, req.streamSession, req.body.layout);
    } else {
      await saveStream(req.db, req.streamSession, {
        platform: req.body.platform,
        url: buildStreamUrl(req.body),
        layout: req.body.layout,
      });
    }
    const row = await findSessionBySetupCode(req.db, req.params.code);
    return res.sendSuccess("Your live stream is set — it runs while the game records", {
      stream: await describeStream(req.db, row),
    });
  })
);

/**
 * DELETE /:code — stop the player's stream
 */
router.delete(
  "/:code",
  setupLimiter,
  validateParams(streamSetupParamsSchema),
  withSession,
  catchAsync(async (req, res) => {
    await clearStream(req.db, req.streamSession.sessionId);
    return res.sendSuccess("Live stream stopped", { stream: null });
  })
);

export default router;
