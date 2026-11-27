import express from "express";
import { catchAsync, validateBody, validateParams, validateQuery } from "../../../utils/catchAsync.js";
import { ERROR_CODES } from "../../../utils/APIError.js";
import { dynamicLimiter } from "../../../middlewares/rateLimiter.js";
import { noIdempotencyCache } from "../../../middlewares/idempotency.middleware.js";
import { requirePlayer } from "../../../middlewares/playerAuth.middleware.js";
import { sessionReply } from "../../../utils/playerTokens.js";
import {
  gameLog,
  playerView,
  redeemSignInCode,
  revokeRefreshToken,
  rotateRefreshToken,
  saveProfile,
} from "../../../utils/players.js";
import {
  playerGamesQuerySchema,
  playerProfileSchema,
  playerRefreshSchema,
  playerSessionSchema,
  playerSportSchema,
  venueKeyParamsSchema,
} from "../../../validators/player.validator.js";
import {
  findVenueByKey,
  followedVenues,
  playerSports,
  recentVenues,
  savePlayerSport,
  setFollow,
} from "../../../utils/playerProfile.js";

/**
 * PLAN-006: a signed-in player — mounted at /api/v1/player.
 *
 *   POST /session            { code } → tokens (the code from the Google sign-in redirect)
 *   POST /session/refresh    { refreshToken } → a new pair (rotated)
 *   POST /session/logout     { refreshToken } → that session ends
 *   GET  /me                 Authorization: Player <token>
 *   PATCH /me                { firstName, middleName?, lastName, phone? } — the profile; asked on
 *                            the first sign-in (pre-filled from Google), booking needs it
 *   GET  /games?page&limit   the game log: upcoming bookings, then past ones, with their games
 *   GET  /sports             PLAN-009 phase B: the sport profile (level, DUPR — unverified)
 *   PUT  /sports             { sport, skillLevel?, duprId?, duprRating? } — one sport's answers
 *   GET  /follows            the venues the player follows
 *   POST /follows/:venueKey  follow a venue · DELETE unfollows it
 *   GET  /recent-venues      venues booked lately (Book again)
 *
 * The session routes take no token (they make or end one); the rest go
 * through requirePlayer and only ever read the caller's own data.
 */
const router = express.Router();

const sessionLimiter = dynamicLimiter({
  points: parseInt(process.env.RATE_LIMIT_PLAYER_SESSION_POINTS || "30", 10),
  duration: 60,
  keyGenerator: (req) => `player-session:${req.ip}`,
  message: "Too many tries — wait a minute and try again.",
});

router.post(
  "/session",
  sessionLimiter,
  validateBody(playerSessionSchema),
  catchAsync(async (req, res) => {
    const tokens = await redeemSignInCode(req.db, req.body.code);
    if (!tokens) {
      return res.sendError("This sign-in link has expired — sign in again", 400);
    }
    noIdempotencyCache(res);
    return res.sendSuccess("Signed in", sessionReply(tokens));
  })
);

router.post(
  "/session/refresh",
  sessionLimiter,
  validateBody(playerRefreshSchema),
  catchAsync(async (req, res) => {
    const tokens = await rotateRefreshToken(req.db, req.body.refreshToken);
    if (!tokens) {
      return res.sendError("Sign in again", null, 401, ERROR_CODES.TOKEN_INVALID);
    }
    noIdempotencyCache(res);
    return res.sendSuccess("Signed in", sessionReply(tokens));
  })
);

router.post(
  "/session/logout",
  sessionLimiter,
  validateBody(playerRefreshSchema),
  catchAsync(async (req, res) => {
    await revokeRefreshToken(req.db, req.body.refreshToken);
    return res.sendSuccess("Signed out", {});
  })
);

router.get(
  "/me",
  requirePlayer,
  catchAsync((req, res) => res.sendSuccess("Player", { player: playerView(req.player) }))
);

router.patch(
  "/me",
  requirePlayer,
  validateBody(playerProfileSchema),
  catchAsync(async (req, res) => {
    const player = await saveProfile(req.db, req.player.playerId, req.body);
    return res.sendSuccess("Profile saved", { player: playerView(player) });
  })
);

router.get(
  "/games",
  requirePlayer,
  validateQuery(playerGamesQuerySchema),
  catchAsync(async (req, res) => {
    const log = await gameLog(req.db, req.player, req.query);
    return res.sendSuccess("Game log", log);
  })
);

// ── PLAN-009 phase B: sport profile, follows, Book again ─────────────────────

router.get(
  "/sports",
  requirePlayer,
  catchAsync(async (req, res) =>
    res.sendSuccess("Sports", { sports: await playerSports(req.db, req.player.playerId) })
  )
);

router.put(
  "/sports",
  requirePlayer,
  validateBody(playerSportSchema),
  catchAsync(async (req, res) => {
    const sports = await savePlayerSport(req.db, req.player.playerId, req.body);
    return res.sendSuccess("Saved", { sports });
  })
);

router.get(
  "/follows",
  requirePlayer,
  catchAsync(async (req, res) =>
    res.sendSuccess("Following", { venues: await followedVenues(req.db, req.player.playerId) })
  )
);

/** Follow / unfollow: an unknown, Deleted or Inactive venue's key is a 404. */
const follow = (on) =>
  catchAsync(async (req, res) => {
    const venueId = await findVenueByKey(req.db, req.params.venueKey);
    if (!venueId) return res.sendError("Venue not found", 404);
    await setFollow(req.db, req.player.playerId, venueId, on);
    return res.sendSuccess(on ? "Following" : "Unfollowed", { following: on });
  });

router.post("/follows/:venueKey", requirePlayer, validateParams(venueKeyParamsSchema), follow(true));
router.delete("/follows/:venueKey", requirePlayer, validateParams(venueKeyParamsSchema), follow(false));

router.get(
  "/recent-venues",
  requirePlayer,
  catchAsync(async (req, res) =>
    res.sendSuccess("Booked lately", { venues: await recentVenues(req.db, req.player.playerId) })
  )
);

export default router;
