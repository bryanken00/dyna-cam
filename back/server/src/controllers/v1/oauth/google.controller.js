import express from "express";
import { logger } from "../../../../config/logger.js";
import { catchAsync } from "../../../utils/catchAsync.js";
import { dynamicLimiter } from "../../../middlewares/rateLimiter.js";
import { recordAudit } from "../../../middlewares/auditTrail.middleware.js";
import { connectCourtDrive } from "../../../utils/courtDrive.js";
import {
  courtSetupUrl,
  driveConfigured,
  DriveError,
  exchangeCode,
  readDriveState,
} from "../../../utils/googleDrive.js";

/**
 * Google's OAuth redirect (CR-001) — mounted at /api/v1/oauth/google, no login.
 *
 *   GET /callback?code&state   (or ?error&state when staff cancelled)
 *
 * Google sends the staff member's browser here after the consent screen that
 * POST /admin/courts/:courtId/google-drive/connect opened. The `state` is the
 * only credential: encrypted and authenticated by the API, naming the court
 * and the staff account, valid for 10 minutes. Every outcome redirects back
 * to the court setup page with `?drive=connected` or `?drive=error&reason=…`.
 */
const router = express.Router();

const callbackLimiter = dynamicLimiter({
  points: parseInt(process.env.RATE_LIMIT_OAUTH_CALLBACK_POINTS || "20", 10),
  duration: 60,
  message: "Too many attempts — wait a moment and try again.",
});

router.get(
  "/callback",
  callbackLimiter,
  catchAsync(async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = readDriveState(req.query.state);
    const back = (query) => res.redirect(303, courtSetupUrl(state || {}, query));

    if (!state) {
      return back({ drive: "error", reason: "The Google sign-in link expired. Try again." });
    }
    if (req.query.error || !code) {
      // Cancelled on Google's screen (error=access_denied) — nothing changed
      return back({ drive: "cancelled" });
    }
    if (!driveConfigured()) {
      return back({ drive: "error", reason: "Google Drive isn't set up on this server" });
    }

    let grant;
    try {
      grant = await exchangeCode(code.slice(0, 2048));
    } catch (err) {
      if (!(err instanceof DriveError)) throw err;
      logger.warn("Google Drive connect failed", { courtId: state.courtId, error: err.message });
      return back({ drive: "error", reason: err.message });
    }

    const found = await connectCourtDrive(req.db, {
      courtId: state.courtId,
      accountId: state.accountId,
      refreshToken: grant.refreshToken,
      email: grant.email,
    });
    if (!found) {
      return res.redirect(303, courtSetupUrl({}, { drive: "error", reason: "Court not found" }));
    }

    await recordAudit(req, {
      action: "UPDATE",
      module: "courts",
      description: `Connected Google Drive${grant.email ? ` (${grant.email})` : ""}`,
      metadata: { courtId: state.courtId, googleDrive: "connected", email: grant.email },
      actor: { accountId: state.accountId },
    });
    return back({ drive: "connected" });
  })
);

export default router;
