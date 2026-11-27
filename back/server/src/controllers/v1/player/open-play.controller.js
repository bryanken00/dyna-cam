import express from "express";
import { catchAsync, validateParams, validateQuery } from "../../../utils/catchAsync.js";
import { ERROR_CODES } from "../../../utils/APIError.js";
import { getCurrentTimestampLocal, moment } from "../../../utils/dateUtils.js";
import { dynamicLimiter } from "../../../middlewares/rateLimiter.js";
import { requirePlayer } from "../../../middlewares/playerAuth.middleware.js";
import { venuePaysOnline } from "../../../utils/companyPayments.js";
import { runPaymentFollowUps } from "../../../utils/bookingPayments.js";
import { openPlayUrl } from "../../../utils/clips.js";
import {
  cancelSignupRow,
  firstName,
  insertSignup,
  isClubMember,
  joinProblem,
  LIVE_SIGNUP,
  liveSpots,
  lockSession,
  playerSpot,
  sessionState,
  spotHoldUntil,
} from "../../../utils/openPlay.js";
import { openPlayCheckout, resumePlayCheckout } from "../../../utils/playPayments.js";
import { sendPlayEmail } from "../../../utils/openPlayEmails.js";
import { loadQueue, playerQueueView } from "../../../utils/openPlayGames.js";
import {
  playerSignupsQuerySchema,
  playTokenParamsSchema,
  signupCodeParamsSchema,
} from "../../../validators/open-play.validator.js";

/**
 * PLAN-009 phase C — a signed-in player's Open Play (mounted at /api/v1/player/play,
 * `Authorization: Player <token>`). Only ever the caller's own spots.
 *
 *   POST /sessions/:playToken/join      take a spot → { signupCode, status, checkoutUrl }
 *                                       (free: Confirmed; paid: held for its checkout)
 *   GET  /signups?when=upcoming|past    my spots
 *   POST /signups/:signupCode/pay       the spot's checkout (again)
 *   GET  /signups/:signupCode/queue     PLAN-009 phase D: my place in line, or my game
 *                                       (court, partner, opponents — first names only)
 *   POST /signups/:signupCode/cancel    give the spot up — a paid one up to the venue's
 *                                       cut-off (refunded), an unpaid or free one until it starts
 */
const router = express.Router();

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";

const joinLimiter = dynamicLimiter({
  points: parseInt(process.env.RATE_LIMIT_PUBLIC_BOOK_POINTS || "5", 10),
  duration: 60,
  keyGenerator: (req) => `play-join:${req.player?.playerId || req.ip}`,
  message: "Too many tries — wait a minute and try again.",
});

/** The latest a paid spot can be cancelled (with a refund): the venue's cut-off before the start. */
const cancelBy = (session) =>
  moment.tz(session.startAt, FORMAT, TIMEZONE).subtract(session.cancelCutoffHours ?? 24, "hours").format(FORMAT);

/** Why this spot can't be cancelled by the player now (null: it can). */
const cancelProblem = (spot, session, now) => {
  if (!["Pending", "Confirmed"].includes(spot.status)) {
    return spot.status === "CheckedIn" ? "You're checked in — ask the venue" : "This spot is already cancelled";
  }
  if (spot.status === "Pending") return null;
  if (session.startAt <= now) return "The session has started — ask the venue";
  if (spot.paymentStatus === "Paid" && cancelBy(session) <= now) {
    return `It's too late to cancel for a refund — the venue's cut-off is ${session.cancelCutoffHours} hours before the start`;
  }
  return null;
};

router.post(
  "/sessions/:playToken/join",
  requirePlayer,
  joinLimiter,
  validateParams(playTokenParamsSchema),
  catchAsync(async (req, res) => {
    if (!req.player.profileCompletedAt) {
      return res.sendError("Complete your profile before joining", null, 409, ERROR_CODES.PROFILE_INCOMPLETE);
    }
    const now = getCurrentTimestampLocal();
    const { playerId, email, phone } = req.player;
    let conn;
    let joined;
    let resume = null;
    try {
      conn = await req.db.beginTransaction();
      const session = await lockSession(conn, { playToken: req.params.playToken });
      const refusal = joinProblem(session, now);
      if (refusal) {
        await req.db.rollback(conn);
        return res.sendError(refusal.message, refusal.status);
      }
      // PLAN-009 phase F: a club's session takes its Active members only
      if (session.clubId && !(await isClubMember(conn, session.clubId, playerId))) {
        const [club] = await conn.execute(`SELECT name FROM clubs WHERE clubId = ?`, [session.clubId]);
        await req.db.rollback(conn);
        return res.sendError(`This session is for members of ${club[0]?.name || "a club"} — join the club first`, 403);
      }
      const mine = await playerSpot(conn, session.playSessionId, playerId, now);
      if (mine) {
        await req.db.rollback(conn);
        if (mine.status === "Pending") {
          resume = mine;
        } else {
          return res.sendError("You're already in this session", 409);
        }
      } else {
        if ((await liveSpots(conn, session.playSessionId, now)) >= session.capacity) {
          await req.db.rollback(conn);
          return res.sendError("This session is full", 409);
        }
        const price = Number(session.pricePerHead);
        // CR-046: pay first to take a spot — the company's own Xendit (PLAN-008)
        if (price > 0 && !(await venuePaysOnline(conn, session.venueId))) {
          await req.db.rollback(conn);
          return res.sendError("Online payment isn't available here — please ask the venue", 409);
        }
        joined = await insertSignup(conn, {
          playSessionId: session.playSessionId,
          playerId,
          email,
          phone,
          price,
          paymentStatus: price > 0 ? "Unpaid" : "Free",
          status: price > 0 ? "Pending" : "Confirmed",
          holdExpiresAt: price > 0 ? spotHoldUntil(session, now) : null,
          now,
        });
        joined.paid = price > 0;
        await req.db.commit(conn);
      }
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }

    if (resume) {
      const checkout = await resumePlayCheckout(req.db, resume.playSignupId);
      if (!checkout.ok) return res.sendError(checkout.message, checkout.status);
      return res.sendSuccess("Your spot is held — pay to keep it", {
        signupCode: resume.signupCode,
        status: checkout.paid ? "Confirmed" : "Pending",
        checkoutUrl: checkout.checkoutUrl || null,
      });
    }
    if (!joined.paid) {
      await sendPlayEmail(req.db, joined.playSignupId, "Confirmed");
      return res.sendSuccess("You're in", { signupCode: joined.signupCode, status: "Confirmed", checkoutUrl: null }, 201);
    }
    const checkout = await openPlayCheckout(req.db, joined.playSignupId);
    if (!checkout.ok) {
      // No checkout, no hold: the spot goes back at once
      await req.db.query(
        `UPDATE play_signups SET status = 'Expired', dateUpdated = ? WHERE playSignupId = ? AND status = 'Pending'`,
        [getCurrentTimestampLocal(), joined.playSignupId]
      );
      return res.sendError(checkout.message, checkout.status);
    }
    return res.sendSuccess(
      "Your spot is held — pay to keep it",
      { signupCode: joined.signupCode, status: "Pending", checkoutUrl: checkout.checkoutUrl },
      201
    );
  })
);

router.get(
  "/signups",
  requirePlayer,
  validateQuery(playerSignupsQuerySchema),
  catchAsync(async (req, res) => {
    const now = getCurrentTimestampLocal();
    const upcoming = req.query.when === "upcoming";
    const rows = await req.db.query(
      `SELECT ps.playSignupId, ps.signupCode, ps.status, ps.paymentStatus, ps.price, ps.holdExpiresAt, ps.checkedInAt,
              s.playToken, s.kind, s.title, s.startAt, s.endAt, s.status AS sessionStatus, v.name AS venueName,
              v.cancelCutoffHours,
              (SELECT GROUP_CONCAT(c.name ORDER BY c.name SEPARATOR ', ')
               FROM play_session_courts pc JOIN courts c ON c.courtId = pc.courtId
               WHERE pc.playSessionId = s.playSessionId) AS courts
       FROM play_signups ps
       JOIN play_sessions s ON s.playSessionId = ps.playSessionId AND s.status != 'Deleted'
       JOIN venues v ON v.venueId = s.venueId
       WHERE ps.playerId = ?
         AND ${
           upcoming
             ? `s.endAt > ? AND s.status = 'Scheduled' AND ${LIVE_SIGNUP}`
             : `(s.endAt <= ? OR s.status = 'Cancelled' OR ps.status IN ('Cancelled', 'Expired'))`
         }
       ORDER BY s.startAt ${upcoming ? "ASC" : "DESC"}
       LIMIT 50`,
      upcoming ? [req.player.playerId, now, now] : [req.player.playerId, now]
    );
    // PLAN-009 phase D: the games each past spot played (partner, opponents, score)
    const games = upcoming ? new Map() : await finishedGames(req.db, rows.map((r) => r.playSignupId));
    return res.sendSuccess("Your Open Play", {
      spots: rows.map((r) => ({
        ...(upcoming ? {} : { games: games.get(r.playSignupId) || [] }),
        signupCode: r.signupCode,
        status: r.status,
        paymentStatus: r.paymentStatus,
        price: Number(r.price),
        holdExpiresAt: r.status === "Pending" ? r.holdExpiresAt : null,
        session: {
          key: r.playToken,
          url: openPlayUrl(r.playToken),
          kind: r.kind,
          title: r.title,
          startAt: r.startAt,
          endAt: r.endAt,
          state: sessionState({ ...r, status: r.sessionStatus }, now),
          venueName: r.venueName,
          courts: r.courts || "",
        },
        cancelBy: r.paymentStatus === "Paid" ? cancelBy(r) : null,
      })),
    });
  })
);

/**
 * The Done games of these spots → Map spotId → [{ partners, opponents, scoreFor, scoreAgainst, won }]
 * (first names only; a game without a score has nulls and won: null).
 */
const finishedGames = async (db, signupIds) => {
  const result = new Map();
  if (!signupIds.length) return result;
  const rows = await db.query(
    `SELECT mine.playSignupId AS mineId, mine.team AS myTeam, g.playGameId, g.scoreA, g.scoreB, g.endedAt,
            other.playSignupId AS otherId, other.team AS otherTeam, COALESCE(p.name, su.walkInName) AS otherName
     FROM play_game_players mine
     JOIN play_games g ON g.playGameId = mine.playGameId AND g.status = 'Done'
     JOIN play_game_players other ON other.playGameId = g.playGameId AND other.playSignupId != mine.playSignupId
     JOIN play_signups su ON su.playSignupId = other.playSignupId
     LEFT JOIN players p ON p.playerId = su.playerId
     WHERE mine.playSignupId IN (${signupIds.map(() => "?").join(", ")})
     ORDER BY g.endedAt ASC, g.id ASC, other.id ASC`,
    signupIds
  );
  const byGame = new Map();
  for (const r of rows) {
    const k = `${r.mineId}|${r.playGameId}`;
    if (!byGame.has(k)) {
      const mineA = r.myTeam === "A";
      const scoreFor = mineA ? r.scoreA : r.scoreB;
      const scoreAgainst = mineA ? r.scoreB : r.scoreA;
      const game = {
        partners: [],
        opponents: [],
        scoreFor,
        scoreAgainst,
        won: scoreFor === null || scoreAgainst === null ? null : scoreFor > scoreAgainst,
      };
      byGame.set(k, game);
      if (!result.has(r.mineId)) result.set(r.mineId, []);
      result.get(r.mineId).push(game);
    }
    byGame.get(k)[r.otherTeam === r.myTeam ? "partners" : "opponents"].push(firstName(r.otherName));
  }
  return result;
};

/** The caller's spot by code, with its session row locked first (inside `conn`). */
const lockMySpot = async (conn, req) => {
  const [peek] = await conn.execute(
    `SELECT playSessionId FROM play_signups WHERE signupCode = ? AND playerId = ? AND status != 'Deleted' LIMIT 1`,
    [req.params.signupCode, req.player.playerId]
  );
  if (!peek.length) return null;
  const [sessions] = await conn.execute(
    `SELECT s.*, v.cancelCutoffHours FROM play_sessions s JOIN venues v ON v.venueId = s.venueId
     WHERE s.playSessionId = ? LIMIT 1 FOR UPDATE`,
    [peek[0].playSessionId]
  );
  const [spots] = await conn.execute(
    `SELECT * FROM play_signups WHERE signupCode = ? AND playerId = ? LIMIT 1 FOR UPDATE`,
    [req.params.signupCode, req.player.playerId]
  );
  return spots[0] ? { spot: spots[0], session: sessions[0] } : null;
};

router.get(
  "/signups/:signupCode/queue",
  requirePlayer,
  validateParams(signupCodeParamsSchema),
  catchAsync(async (req, res) => {
    const rows = await req.db.query(
      `SELECT su.playSignupId, su.playSessionId, s.status, s.startAt, s.endAt, s.queuePaused
       FROM play_signups su JOIN play_sessions s ON s.playSessionId = su.playSessionId
       WHERE su.signupCode = ? AND su.playerId = ? AND su.status != 'Deleted' AND s.status != 'Deleted' LIMIT 1`,
      [req.params.signupCode, req.player.playerId]
    );
    if (!rows.length) return res.sendError("Spot not found", 404);
    const now = getCurrentTimestampLocal();
    const state = await loadQueue(req.db, rows[0].playSessionId);
    return res.sendSuccess("Queue", {
      queue: {
        ...playerQueueView(state, rows[0].playSignupId),
        session: sessionState(rows[0], now),
        paused: Boolean(rows[0].queuePaused),
      },
    });
  })
);

router.post(
  "/signups/:signupCode/pay",
  requirePlayer,
  validateParams(signupCodeParamsSchema),
  catchAsync(async (req, res) => {
    const rows = await req.db.query(
      `SELECT playSignupId FROM play_signups WHERE signupCode = ? AND playerId = ? AND status != 'Deleted' LIMIT 1`,
      [req.params.signupCode, req.player.playerId]
    );
    if (!rows.length) return res.sendError("Spot not found", 404);
    const checkout = await resumePlayCheckout(req.db, rows[0].playSignupId);
    if (!checkout.ok) return res.sendError(checkout.message, checkout.status);
    return res.sendSuccess(checkout.paid ? "Paid" : "Checkout", {
      paid: Boolean(checkout.paid),
      checkoutUrl: checkout.checkoutUrl || null,
    });
  })
);

router.post(
  "/signups/:signupCode/cancel",
  requirePlayer,
  validateParams(signupCodeParamsSchema),
  catchAsync(async (req, res) => {
    const now = getCurrentTimestampLocal();
    let conn;
    let followUp;
    let playSignupId;
    try {
      conn = await req.db.beginTransaction();
      const found = await lockMySpot(conn, req);
      if (!found) {
        await req.db.rollback(conn);
        return res.sendError("Spot not found", 404);
      }
      const problem = cancelProblem(found.spot, found.session, now);
      if (problem) {
        await req.db.rollback(conn);
        return res.sendError(problem, 409);
      }
      playSignupId = found.spot.playSignupId;
      followUp = await cancelSignupRow(conn, {
        signup: found.spot,
        venueId: found.session.venueId,
        by: "Player",
        now,
      });
      await req.db.commit(conn);
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
    const money = await runPaymentFollowUps(req.db, followUp, { reason: "CANCELLATION" });
    await sendPlayEmail(req.db, playSignupId, "Cancelled");
    return res.sendSuccess("Spot cancelled", { refunded: money.refunded, refundFailed: money.failed });
  })
);

export default router;
