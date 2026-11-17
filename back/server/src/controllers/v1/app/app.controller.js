import express from "express";
import { catchAsync } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal } from "../../../utils/dateUtils.js";
import { noIdempotencyCache } from "../../../middlewares/idempotency.middleware.js";
import { endSessionNow, materializeSessionParts, settleSessions } from "../../../utils/sessions.js";
import {
  liveLink,
  loadDeviceSession,
  sessionEnded,
  sessionRecording,
  toDeviceSession,
  unpairInSeconds,
} from "../../../utils/sessionDevices.js";
import { clearStream, createStreamSetup, describeStream } from "../../../utils/sessionStreams.js";

/**
 * Session device API (PLAN-002 Phase E) — mounted at /api/v1/app behind
 * `requirePairedApp`, so `req.pairedApp` is always set and everything is about
 * its one session (`req.pairedApp.sessionId`).
 *
 *   GET  /session        the session, its live-view link and the unpair countdown
 *   POST /session/stop   Stop recording (the game so far is saved)
 *   POST /unpair         Done — the device revokes itself
 *   POST /session/stream-link   a QR code for the player's own live stream (Phase G)
 *   POST /session/stream/stop   stop the player's stream
 */
const router = express.Router();

/** Bring the session's status up to date (parts due, game saved). */
const refreshSession = async (req) => {
  await materializeSessionParts(req.db, { venueId: req.pairedApp.venueId });
  await settleSessions(req.db, req.pairedApp.sessionId);
  return loadDeviceSession(req.db, req.pairedApp.sessionId);
};

const deviceBody = async (req, row) => {
  const now = Date.now();
  return {
    session: toDeviceSession(row, now),
    live: await liveLink(req.db, row, now),
    stream: await describeStream(req.db, row, now),
    unpairInSeconds: unpairInSeconds(row, now),
    device: { pairedAppId: req.pairedApp.pairedAppId, name: req.pairedApp.name },
  };
};

/**
 * GET /session
 */
router.get(
  "/session",
  catchAsync(async (req, res) => {
    const row = await refreshSession(req);
    return res.sendSuccess("Session", await deviceBody(req, row));
  })
);

/**
 * POST /session/stop — Stop recording now; the share link keeps working
 */
router.post(
  "/session/stop",
  catchAsync(async (req, res) => {
    const before = await loadDeviceSession(req.db, req.pairedApp.sessionId);
    if (!sessionRecording(before)) {
      return res.sendError(
        before.status === "Scheduled" ? "The session hasn't started yet" : "The session has ended",
        409
      );
    }
    const result = await endSessionNow(req.db, req.pairedApp.sessionId);
    if (!result.ok) {
      return res.sendError("The session has ended", 409);
    }
    const row = await refreshSession(req);
    const body = await deviceBody(req, row);
    return res.sendSuccess("Recording stopped — the game is being saved", body);
  })
);

/**
 * POST /session/stream-link — a fresh setup code (QR) for the player's own
 * Facebook / YouTube stream; the previous code stops working
 */
router.post(
  "/session/stream-link",
  catchAsync(async (req, res) => {
    const row = await loadDeviceSession(req.db, req.pairedApp.sessionId);
    if (sessionEnded(row)) {
      return res.sendError("The session has ended", 409);
    }
    const link = await createStreamSetup(req.db, row.sessionId);
    noIdempotencyCache(res); // the code is a credential
    return res.sendSuccess("Scan with your phone to add your live stream", link, 201);
  })
);

/**
 * POST /session/stream/stop — stop the player's stream
 */
router.post(
  "/session/stream/stop",
  catchAsync(async (req, res) => {
    await clearStream(req.db, req.pairedApp.sessionId);
    return res.sendSuccess("Live stream stopped", { stream: null });
  })
);

/**
 * POST /unpair — "Done": the device revokes its own pairing
 */
router.post(
  "/unpair",
  catchAsync(async (req, res) => {
    await req.db.query(
      `UPDATE paired_apps SET status = 'Revoked', dateUpdated = ?
       WHERE pairedAppId = ? AND status = 'Active'`,
      [getCurrentTimestampLocal(), req.pairedApp.pairedAppId]
    );
    return res.sendSuccess("Device unpaired");
  })
);

export default router;
