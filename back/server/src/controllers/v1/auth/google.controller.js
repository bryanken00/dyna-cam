import express from "express";
import { logger } from "../../../../config/logger.js";
import { catchAsync, validateQuery } from "../../../utils/catchAsync.js";
import { dynamicLimiter } from "../../../middlewares/rateLimiter.js";
import {
  appSignedInUrl,
  DEFAULT_RETURN_PATH,
  exchangeLoginCode,
  GoogleSignInError,
  newNonce,
  playerSignInConfigured,
  readLoginState,
  safeReturnPath,
  signedInUrl,
  signInUrl,
  signLoginState,
} from "../../../utils/googleSignIn.js";
import { signInFromGoogle } from "../../../utils/players.js";
import { googleStartQuerySchema } from "../../../validators/player.validator.js";

/**
 * PLAN-006: players sign in with Google — mounted at /api/v1/auth/google, no login.
 *
 *   GET /start?return=<player page>   → Google's sign-in screen
 *   GET /callback?code&state          ← Google; → the front's /signed-in page
 *
 * Both are browser navigations, so every outcome is a redirect to
 * `/signed-in?code=…&next=…` (a single-use, 60-second code the page trades at
 * POST /player/session — never a token in a URL) or `/signed-in?error=…&next=…`:
 *
 *   off        sign-in isn't set up on this server
 *   expired    the 10-minute `state` ran out or was tampered with
 *   cancelled  the player backed out on Google's screen
 *   refused    an unverified Google email, or a Blocked player
 *   failed     Google couldn't be reached or answered something unusable
 *
 * The `state` (encrypted, authenticated) carries the return path and the
 * nonce the ID token must echo; the return path can only be a player page.
 *
 * PLAN-009: the mobile app starts with `?app=1&challenge=<base64url SHA-256 of a
 * secret>` and comes back to `dgsports://signed-in?code=…` (or `?error=…`); its
 * code is redeemable only with that secret (POST /player/session `verifier`).
 */
const router = express.Router();

const googleLimiter = dynamicLimiter({
  points: parseInt(process.env.RATE_LIMIT_PLAYER_SIGN_IN_POINTS || "20", 10),
  duration: 60,
  keyGenerator: (req) => `player-google:${req.ip}`,
  message: "Too many sign-in attempts — wait a minute and try again.",
});

router.get(
  "/start",
  googleLimiter,
  validateQuery(googleStartQuerySchema),
  catchAsync((req, res) => {
    const returnPath = safeReturnPath(req.query.return);
    const fromApp = req.query.app === "1";
    if (!playerSignInConfigured()) {
      return res.redirect(
        303,
        fromApp ? appSignedInUrl({ error: "off" }) : signedInUrl({ error: "off", next: returnPath })
      );
    }
    const nonce = newNonce();
    const state = signLoginState({ returnPath, nonce, challenge: fromApp ? req.query.challenge : null });
    return res.redirect(303, signInUrl({ state, nonce }));
  })
);

router.get(
  "/callback",
  googleLimiter,
  catchAsync(async (req, res) => {
    const state = readLoginState(req.query.state);
    const next = state?.returnPath || DEFAULT_RETURN_PATH;
    const fromApp = Boolean(state?.challenge);
    const back = (query) => (fromApp ? appSignedInUrl(query) : signedInUrl({ ...query, next }));
    const fail = (error) => res.redirect(303, back({ error }));

    if (!state) return fail("expired");
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (req.query.error || !code) return fail("cancelled");
    if (!playerSignInConfigured()) return fail("off");

    let identity;
    try {
      identity = await exchangeLoginCode({ code: code.slice(0, 2048), nonce: state.nonce });
    } catch (err) {
      if (!(err instanceof GoogleSignInError)) throw err;
      logger.warn("Player Google sign-in failed", { error: err.message });
      return fail(err.reason);
    }

    const result = await signInFromGoogle(req.db, identity, { challenge: state.challenge });
    if (result.blocked) return fail("refused");
    return res.redirect(303, back({ code: result.code }));
  })
);

export default router;
