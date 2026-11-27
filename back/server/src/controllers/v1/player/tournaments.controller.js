import express from "express";
import { catchAsync, validateBody, validateParams } from "../../../utils/catchAsync.js";
import { ERROR_CODES } from "../../../utils/APIError.js";
import { getCurrentTimestampLocal } from "../../../utils/dateUtils.js";
import { dynamicLimiter } from "../../../middlewares/rateLimiter.js";
import { requirePlayer } from "../../../middlewares/playerAuth.middleware.js";
import { venuePaysOnline } from "../../../utils/companyPayments.js";
import { runPaymentFollowUps } from "../../../utils/bookingPayments.js";
import { teamInviteUrl, tournamentUrl } from "../../../utils/clips.js";
import { firstName } from "../../../utils/openPlay.js";
import {
  addTeamPlayer,
  DIVISION_KEY_SQL,
  insertTeam,
  liveTeams,
  lockTournament,
  playerTeamInDivision,
  registerIfComplete,
  registrationProblem,
  teamHoldUntil,
  withdrawTeamRow,
} from "../../../utils/tournaments.js";
import { openTeamCheckout, resumeTeamCheckout } from "../../../utils/tournamentPayments.js";
import { sendTournamentEmail } from "../../../utils/tournamentEmails.js";
import {
  inviteParamsSchema,
  registerParamsSchema,
  registerTeamSchema,
  teamCodeParamsSchema,
} from "../../../validators/tournaments.validator.js";

/**
 * PLAN-009 phase E — a signed-in player's tournaments (/api/v1/player/tournaments,
 * `Authorization: Player <token>`). Only ever the caller's own teams.
 *
 *   POST /:publicToken/divisions/:divisionKey/register  { name? } — the caller is captain;
 *        a doubles team gets an invite link for the partner; a fee → a checkout
 *   POST /invites/:inviteToken/join                     join a team as its partner
 *   GET  /mine                                          my teams, their invite links and matches
 *   POST /teams/:teamCode/pay                           the entry's checkout (again) — captain
 *   POST /teams/:teamCode/withdraw                      before the draw: out (refunded if paid) — captain
 */
const router = express.Router();

const limiter = dynamicLimiter({
  points: parseInt(process.env.RATE_LIMIT_PUBLIC_BOOK_POINTS || "5", 10),
  duration: 60,
  keyGenerator: (req) => `tournament:${req.player?.playerId || req.ip}`,
  message: "Too many tries — wait a minute and try again.",
});

const needsProfile = (req, res) =>
  !req.player.profileCompletedAt &&
  res.sendError("Complete your profile first", null, 409, ERROR_CODES.PROFILE_INCOMPLETE);

router.post(
  "/:publicToken/divisions/:divisionKey/register",
  requirePlayer,
  limiter,
  validateParams(registerParamsSchema),
  validateBody(registerTeamSchema),
  catchAsync(async (req, res) => {
    if (needsProfile(req, res)) return undefined;
    const now = getCurrentTimestampLocal();
    const { playerId, email, name: playerName } = req.player;
    let conn;
    let team;
    let teamSize;
    let paid = false;
    try {
      conn = await req.db.beginTransaction();
      const tournament = await lockTournament(conn, { publicToken: req.params.publicToken });
      const [divs] = tournament
        ? await conn.execute(
            `SELECT d.* FROM tournament_divisions d
             WHERE d.tournamentId = ? AND ${DIVISION_KEY_SQL("d")} = ? AND d.status = 'Active' LIMIT 1 FOR UPDATE`,
            [tournament.tournamentId, req.params.divisionKey]
          )
        : [[]];
      const division = divs[0];
      const refusal = registrationProblem(tournament, division, now);
      if (refusal) {
        await req.db.rollback(conn);
        return res.sendError(refusal.message, refusal.status);
      }
      if (await playerTeamInDivision(conn, division.divisionId, playerId, now)) {
        await req.db.rollback(conn);
        return res.sendError("You're already on a team in this division", 409);
      }
      if ((await liveTeams(conn, division.divisionId, now)) >= division.capacity) {
        await req.db.rollback(conn);
        return res.sendError("This division is full", 409);
      }
      const price = Number(division.entryFee);
      if (price > 0 && !(await venuePaysOnline(conn, tournament.venueId))) {
        await req.db.rollback(conn);
        return res.sendError("Online payment isn't available here — please ask the venue", 409);
      }
      teamSize = division.teamSize;
      paid = price > 0;
      team = await insertTeam(conn, {
        divisionId: division.divisionId,
        captainPlayerId: playerId,
        name: req.body.name || `Team ${firstName(playerName)}`,
        teamSize,
        email,
        price,
        paymentStatus: paid ? "Unpaid" : "Free",
        holdExpiresAt: paid ? teamHoldUntil(tournament, now) : null,
        now,
      });
      await addTeamPlayer(conn, { tournamentTeamId: team.tournamentTeamId, playerId, role: "Captain", now });
      if (!paid) await registerIfComplete(conn, { tournamentTeamId: team.tournamentTeamId, teamSize, now });
      await req.db.commit(conn);
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }

    const [row] = await req.db.query(`SELECT status, inviteToken FROM tournament_teams WHERE tournamentTeamId = ?`, [
      team.tournamentTeamId,
    ]);
    const inviteUrl = row.inviteToken ? teamInviteUrl(row.inviteToken) : null;
    if (!paid) {
      if (row.status === "Registered") await sendTournamentEmail(req.db, team.tournamentTeamId, "Registered");
      return res.sendSuccess(
        row.status === "Registered" ? "You're registered" : "Team saved — send your partner the invite",
        { teamCode: team.teamCode, status: row.status, inviteUrl, checkoutUrl: null },
        201
      );
    }
    const checkout = await openTeamCheckout(req.db, team.tournamentTeamId);
    if (!checkout.ok) {
      await req.db.query(
        `UPDATE tournament_teams SET status = 'Expired', inviteToken = NULL, dateUpdated = ?
         WHERE tournamentTeamId = ? AND status = 'Pending' AND paymentStatus = 'Unpaid'`,
        [getCurrentTimestampLocal(), team.tournamentTeamId]
      );
      return res.sendError(checkout.message, checkout.status);
    }
    return res.sendSuccess(
      "Pay the entry fee to keep your place",
      { teamCode: team.teamCode, status: "Pending", inviteUrl, checkoutUrl: checkout.checkoutUrl },
      201
    );
  })
);

router.post(
  "/invites/:inviteToken/join",
  requirePlayer,
  limiter,
  validateParams(inviteParamsSchema),
  catchAsync(async (req, res) => {
    if (needsProfile(req, res)) return undefined;
    const now = getCurrentTimestampLocal();
    let conn;
    let teamId;
    let registered = false;
    try {
      conn = await req.db.beginTransaction();
      const [peek] = await conn.execute(
        `SELECT d.tournamentId FROM tournament_teams tt JOIN tournament_divisions d ON d.divisionId = tt.divisionId
         WHERE tt.inviteToken = ? LIMIT 1`,
        [req.params.inviteToken]
      );
      const tournament = peek.length ? await lockTournament(conn, { tournamentId: peek[0].tournamentId }) : null;
      const [teams] = tournament
        ? await conn.execute(`SELECT * FROM tournament_teams WHERE inviteToken = ? LIMIT 1 FOR UPDATE`, [req.params.inviteToken])
        : [[]];
      const team = teams[0];
      if (!team || team.status !== "Pending") {
        await req.db.rollback(conn);
        return res.sendError("This invite isn't valid any more", 404);
      }
      const [divs] = await conn.execute(`SELECT * FROM tournament_divisions WHERE divisionId = ?`, [team.divisionId]);
      const division = divs[0];
      const refusal = registrationProblem(tournament, division, now);
      if (refusal && !(refusal.message === "Registration has closed" && team.paymentStatus === "Paid")) {
        await req.db.rollback(conn);
        return res.sendError(refusal.message, refusal.status);
      }
      if (await playerTeamInDivision(conn, division.divisionId, req.player.playerId, now)) {
        await req.db.rollback(conn);
        return res.sendError("You're already on a team in this division", 409);
      }
      const [count] = await conn.execute(`SELECT COUNT(*) AS n FROM tournament_team_players WHERE tournamentTeamId = ?`, [
        team.tournamentTeamId,
      ]);
      if (Number(count[0].n) >= division.teamSize) {
        await req.db.rollback(conn);
        return res.sendError("This team is already full", 409);
      }
      await addTeamPlayer(conn, { tournamentTeamId: team.tournamentTeamId, playerId: req.player.playerId, role: "Partner", now });
      if (Number(count[0].n) + 1 >= division.teamSize) {
        await conn.execute(`UPDATE tournament_teams SET inviteToken = NULL, dateUpdated = ? WHERE tournamentTeamId = ?`, [
          now,
          team.tournamentTeamId,
        ]);
      }
      registered = await registerIfComplete(conn, { tournamentTeamId: team.tournamentTeamId, teamSize: division.teamSize, now });
      teamId = team.tournamentTeamId;
      await req.db.commit(conn);
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
    if (registered) await sendTournamentEmail(req.db, teamId, "Registered");
    return res.sendSuccess(registered ? "You're in — the team is registered" : "You're on the team — the captain still has to pay", {
      registered,
    });
  })
);

router.get(
  "/mine",
  requirePlayer,
  catchAsync(async (req, res) => {
    const now = getCurrentTimestampLocal();
    const teams = await req.db.query(
      `SELECT tt.tournamentTeamId, tt.teamCode, tt.name, tt.status, tt.paymentStatus, tt.price, tt.inviteToken,
              tt.captainPlayerId, tt.holdExpiresAt, d.name AS divisionName, d.teamSize, d.drawGeneratedAt,
              t.publicToken, t.name AS tournamentName, t.startDate, t.endDate, t.status AS tournamentStatus,
              t.registrationClosesAt, v.name AS venueName
       FROM tournament_team_players tp
       JOIN tournament_teams tt ON tt.tournamentTeamId = tp.tournamentTeamId AND tt.status IN ('Pending', 'Registered', 'Withdrawn')
       JOIN tournament_divisions d ON d.divisionId = tt.divisionId AND d.status = 'Active'
       JOIN tournaments t ON t.tournamentId = d.tournamentId AND t.status != 'Deleted'
       JOIN venues v ON v.venueId = t.venueId
       WHERE tp.playerId = ?
       ORDER BY t.startDate DESC, tt.id DESC
       LIMIT 50`,
      [req.player.playerId]
    );
    const ids = teams.map((t) => t.tournamentTeamId);
    const matches = ids.length
      ? await req.db.query(
          `SELECT m.teamAId, m.teamBId, m.status, m.scheduledAt, m.scoreA, m.scoreB, m.winnerTeamId, m.stage, m.round,
                  c.name AS court, ta.name AS teamAName, tb.name AS teamBName
           FROM tournament_matches m
           LEFT JOIN courts c ON c.courtId = m.courtId
           LEFT JOIN tournament_teams ta ON ta.tournamentTeamId = m.teamAId
           LEFT JOIN tournament_teams tb ON tb.tournamentTeamId = m.teamBId
           WHERE m.status != 'Bye' AND (m.teamAId IN (${ids.map(() => "?").join(", ")}) OR m.teamBId IN (${ids.map(() => "?").join(", ")}))
           ORDER BY COALESCE(m.scheduledAt, '9999-12-31') ASC, m.stage ASC, m.round ASC`,
          [...ids, ...ids]
        )
      : [];
    return res.sendSuccess("Your tournaments", {
      teams: teams.map((t) => {
        const captain = t.captainPlayerId === req.player.playerId;
        return {
          teamCode: t.teamCode,
          name: t.name,
          status: t.status,
          paymentStatus: t.paymentStatus,
          price: Number(t.price),
          captain,
          divisionName: t.divisionName,
          drawOut: Boolean(t.drawGeneratedAt),
          inviteUrl: captain && t.inviteToken ? teamInviteUrl(t.inviteToken) : null,
          canWithdraw: captain && ["Pending", "Registered"].includes(t.status) && !t.drawGeneratedAt && t.registrationClosesAt > now,
          tournament: {
            key: t.publicToken,
            url: tournamentUrl(t.publicToken),
            name: t.tournamentName,
            startDate: t.startDate,
            endDate: t.endDate,
            status: t.tournamentStatus,
            venueName: t.venueName,
          },
          matches: matches
            .filter((m) => m.teamAId === t.tournamentTeamId || m.teamBId === t.tournamentTeamId)
            .map((m) => {
              const mineA = m.teamAId === t.tournamentTeamId;
              return {
                opponent: (mineA ? m.teamBName : m.teamAName) || "To be decided",
                status: m.status,
                stage: m.stage,
                round: m.round,
                court: m.court,
                scheduledAt: m.scheduledAt,
                scoreFor: mineA ? m.scoreA : m.scoreB,
                scoreAgainst: mineA ? m.scoreB : m.scoreA,
                won: m.winnerTeamId ? m.winnerTeamId === t.tournamentTeamId : null,
              };
            }),
        };
      }),
    });
  })
);

/** The caller's own team (as captain) → its row, or null. */
const myCaptainTeam = async (db, req) => {
  const rows = await db.query(
    `SELECT tournamentTeamId FROM tournament_teams WHERE teamCode = ? AND captainPlayerId = ? AND status != 'Deleted' LIMIT 1`,
    [req.params.teamCode, req.player.playerId]
  );
  return rows[0] || null;
};

router.post(
  "/teams/:teamCode/pay",
  requirePlayer,
  validateParams(teamCodeParamsSchema),
  catchAsync(async (req, res) => {
    const team = await myCaptainTeam(req.db, req);
    if (!team) return res.sendError("Entry not found", 404);
    const checkout = await resumeTeamCheckout(req.db, team.tournamentTeamId);
    if (!checkout.ok) return res.sendError(checkout.message, checkout.status);
    return res.sendSuccess(checkout.paid ? "Paid" : "Checkout", { paid: Boolean(checkout.paid), checkoutUrl: checkout.checkoutUrl || null });
  })
);

router.post(
  "/teams/:teamCode/withdraw",
  requirePlayer,
  validateParams(teamCodeParamsSchema),
  catchAsync(async (req, res) => {
    const now = getCurrentTimestampLocal();
    const mine = await myCaptainTeam(req.db, req);
    if (!mine) return res.sendError("Entry not found", 404);
    let conn;
    let followUp;
    try {
      conn = await req.db.beginTransaction();
      const [peek] = await conn.execute(
        `SELECT d.tournamentId FROM tournament_teams tt JOIN tournament_divisions d ON d.divisionId = tt.divisionId
         WHERE tt.tournamentTeamId = ?`,
        [mine.tournamentTeamId]
      );
      const tournament = await lockTournament(conn, { tournamentId: peek[0].tournamentId });
      const [teams] = await conn.execute(`SELECT * FROM tournament_teams WHERE tournamentTeamId = ? FOR UPDATE`, [mine.tournamentTeamId]);
      const [divs] = await conn.execute(`SELECT drawGeneratedAt FROM tournament_divisions WHERE divisionId = ?`, [teams[0].divisionId]);
      const team = teams[0];
      const problem = !["Pending", "Registered"].includes(team.status)
        ? "This entry is already withdrawn"
        : divs[0].drawGeneratedAt
          ? "The draw is out — ask the venue"
          : tournament.registrationClosesAt <= now
            ? "Registration has closed — ask the venue"
            : null;
      if (problem) {
        await req.db.rollback(conn);
        return res.sendError(problem, 409);
      }
      followUp = await withdrawTeamRow(conn, { team, venueId: tournament.venueId, now });
      await req.db.commit(conn);
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
    const money = await runPaymentFollowUps(req.db, followUp, { reason: "CANCELLATION" });
    await sendTournamentEmail(req.db, mine.tournamentTeamId, "Withdrawn");
    return res.sendSuccess("Entry withdrawn", { refunded: money.refunded, refundFailed: money.failed });
  })
);

export default router;
