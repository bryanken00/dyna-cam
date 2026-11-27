import express from "express";
import { catchAsync, validateParams } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal } from "../../../utils/dateUtils.js";
import { signUploadUrl } from "../../../utils/file/signedUrl.js";
import { directionsUrl } from "../../../utils/maps.js";
import { venueKey } from "../../../utils/venueFacts.js";
import { LIVE_TEAM } from "../../../utils/tournaments.js";
import { loadTournamentDetail } from "../../../utils/tournamentViews.js";
import { firstName } from "../../../utils/openPlay.js";
import { inviteParamsSchema, publicTokenParamsSchema } from "../../../validators/tournaments.validator.js";

/**
 * PLAN-009 phase E — tournaments for anyone, no login (/api/v1/public/tournaments).
 *
 *   GET /                      upcoming and live events at every Active venue (registration
 *                              open first), with each division's fee and places left
 *   GET /:publicToken          one event: divisions, teams (team names, first names), the
 *                              draw, standings and the schedule
 *   GET /invites/:inviteToken  the team an invite link joins (to show before signing in)
 *
 * No business IDs: an event by its link, a division by its key, a team by a hashed key.
 */
const router = express.Router();

const FROM = `FROM tournaments t
  JOIN venues v ON v.venueId = t.venueId AND v.status = 'Active'
  JOIN companies co ON co.companyId = v.companyId AND co.status = 'Active'`;

router.get(
  "/",
  catchAsync(async (req, res) => {
    const now = getCurrentTimestampLocal();
    const rows = await req.db.query(
      `SELECT t.tournamentId, t.publicToken, t.name, t.startDate, t.endDate, t.registrationClosesAt, t.status,
              t.venueId, v.name AS venueName, v.address, v.logoUrl, v.latitude, v.longitude
       ${FROM}
       WHERE t.status IN ('Open', 'Closed', 'Live') AND t.endDate >= ?
       ORDER BY (t.status = 'Open' AND t.registrationClosesAt > ?) DESC, t.startDate ASC
       LIMIT 100`,
      [now.slice(0, 10), now]
    );
    const ids = rows.map((r) => r.tournamentId);
    const divisions = ids.length
      ? await req.db.query(
          `SELECT d.tournamentId, d.name, d.teamSize, d.minLevel, d.maxLevel, d.capacity, d.entryFee,
                  (SELECT COUNT(*) FROM tournament_teams t WHERE t.divisionId = d.divisionId AND ${LIVE_TEAM}) AS live
           FROM tournament_divisions d WHERE d.status = 'Active' AND d.tournamentId IN (${ids.map(() => "?").join(", ")})
           ORDER BY d.dateCreated ASC`,
          [now, ...ids]
        )
      : [];
    return res.sendSuccess("Tournaments", {
      tournaments: rows.map((r) => ({
        key: r.publicToken,
        name: r.name,
        startDate: r.startDate,
        endDate: r.endDate,
        registrationClosesAt: r.registrationClosesAt,
        registrationOpen: r.status === "Open" && r.registrationClosesAt > now,
        status: r.status,
        venue: {
          key: venueKey(r.venueId),
          name: r.venueName,
          address: r.address,
          logoUrl: signUploadUrl(r.logoUrl),
          directionsUrl: directionsUrl(r.latitude, r.longitude),
        },
        divisions: divisions
          .filter((d) => d.tournamentId === r.tournamentId)
          .map((d) => ({
            name: d.name,
            teamSize: d.teamSize,
            minLevel: d.minLevel,
            maxLevel: d.maxLevel,
            entryFee: Number(d.entryFee),
            spotsLeft: Math.max(0, d.capacity - Number(d.live)),
          })),
      })),
    });
  })
);

router.get(
  "/invites/:inviteToken",
  validateParams(inviteParamsSchema),
  catchAsync(async (req, res) => {
    const rows = await req.db.query(
      `SELECT tt.name, tt.status, tt.paymentStatus, d.name AS divisionName, d.teamSize, t.name AS tournamentName,
              t.publicToken, t.startDate, t.endDate, v.name AS venueName,
              (SELECT COALESCE(p.name, tp.playerName) FROM tournament_team_players tp
               LEFT JOIN players p ON p.playerId = tp.playerId
               WHERE tp.tournamentTeamId = tt.tournamentTeamId AND tp.role = 'Captain' LIMIT 1) AS captain
       FROM tournament_teams tt
       JOIN tournament_divisions d ON d.divisionId = tt.divisionId AND d.status = 'Active'
       JOIN tournaments t ON t.tournamentId = d.tournamentId
       JOIN venues v ON v.venueId = t.venueId AND v.status = 'Active'
       JOIN companies co ON co.companyId = v.companyId AND co.status = 'Active'
       WHERE tt.inviteToken = ? AND tt.status = 'Pending' AND t.status IN ('Open', 'Closed') LIMIT 1`,
      [req.params.inviteToken]
    );
    if (!rows.length) return res.sendError("This invite isn't valid any more", 404);
    const r = rows[0];
    return res.sendSuccess("Invite", {
      invite: {
        teamName: r.name,
        captain: firstName(r.captain),
        divisionName: r.divisionName,
        tournamentName: r.tournamentName,
        tournamentKey: r.publicToken,
        startDate: r.startDate,
        endDate: r.endDate,
        venueName: r.venueName,
      },
    });
  })
);

router.get(
  "/:publicToken",
  validateParams(publicTokenParamsSchema),
  catchAsync(async (req, res) => {
    const rows = await req.db.query(
      `SELECT t.tournamentId, v.latitude, v.longitude ${FROM}
       WHERE t.publicToken = ? AND t.status NOT IN ('Draft', 'Deleted') LIMIT 1`,
      [req.params.publicToken]
    );
    if (!rows.length) return res.sendError("This tournament isn't available", 404);
    const detail = await loadTournamentDetail(req.db, rows[0].tournamentId, { forPublic: true });
    detail.tournament.directionsUrl = directionsUrl(rows[0].latitude, rows[0].longitude);
    return res.sendSuccess("Tournament", detail);
  })
);

export default router;
