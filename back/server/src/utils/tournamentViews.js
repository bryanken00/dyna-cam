import { getCurrentTimestampLocal } from "./dateUtils.js";
import { hashToken } from "./crypto/tokens.js";
import { firstName } from "./openPlay.js";
import { divisionKey, LIVE_TEAM } from "./tournaments.js";
import { standings } from "./tournamentBrackets.js";

/**
 * PLAN-009 phase E — a tournament as staff see it (`forPublic: false`: IDs,
 * full names, payments) or as anyone sees it on the player app (`forPublic:
 * true`: no business IDs — teams by a hashed key, players by first name).
 */

const teamKey = (id) => hashToken(`team:${id}`).slice(0, 12);

export const loadTournamentDetail = async (db, tournamentId, { forPublic = false } = {}) => {
  const now = getCurrentTimestampLocal();
  const [tournament] = await db.query(
    `SELECT t.*, v.name AS venueName, v.address, v.latitude, v.longitude, v.logoUrl
     FROM tournaments t JOIN venues v ON v.venueId = t.venueId
     WHERE t.tournamentId = ? AND t.status != 'Deleted' LIMIT 1`,
    [tournamentId]
  );
  if (!tournament) return null;
  const courts = await db.query(
    `SELECT c.courtId, c.name FROM tournament_courts tc JOIN courts c ON c.courtId = tc.courtId
     WHERE tc.tournamentId = ? ORDER BY c.name`,
    [tournamentId]
  );
  const courtName = new Map(courts.map((c) => [c.courtId, c.name]));
  const divisions = await db.query(
    `SELECT d.*, (SELECT COUNT(*) FROM tournament_teams t WHERE t.divisionId = d.divisionId AND ${LIVE_TEAM}) AS liveTeams
     FROM tournament_divisions d WHERE d.tournamentId = ? AND d.status = 'Active' ORDER BY d.dateCreated ASC, d.id ASC`,
    [now, tournamentId]
  );
  const teams = await db.query(
    `SELECT tt.*, d.divisionId AS teamDivisionId FROM tournament_teams tt
     JOIN tournament_divisions d ON d.divisionId = tt.divisionId AND d.tournamentId = ? AND d.status = 'Active'
     WHERE tt.status IN ('Pending', 'Registered'${forPublic ? "" : ", 'Withdrawn', 'Expired'"})
     ORDER BY tt.status = 'Registered' DESC, COALESCE(tt.registeredAt, tt.dateCreated) ASC, tt.id ASC`,
    [tournamentId]
  );
  const players = await db.query(
    `SELECT tp.tournamentTeamId, tp.playerId, tp.role, COALESCE(p.name, tp.playerName) AS name, p.email,
            sp.skillLevel, sp.duprRating
     FROM tournament_team_players tp
     JOIN tournament_teams tt ON tt.tournamentTeamId = tp.tournamentTeamId
     JOIN tournament_divisions d ON d.divisionId = tt.divisionId AND d.tournamentId = ?
     LEFT JOIN players p ON p.playerId = tp.playerId
     LEFT JOIN player_sports sp ON sp.playerId = tp.playerId AND sp.sport = 'Pickleball' AND sp.status = 'Active'
     ORDER BY tp.role ASC, tp.id ASC`,
    [tournamentId]
  );
  const matches = await db.query(
    `SELECT m.* FROM tournament_matches m
     JOIN tournament_divisions d ON d.divisionId = m.divisionId AND d.tournamentId = ? AND d.status = 'Active'
     ORDER BY m.stage = 'Knockout' ASC, m.groupNo ASC, m.round ASC, m.slot ASC`,
    [tournamentId]
  );

  const playersOf = new Map();
  for (const p of players) {
    if (!playersOf.has(p.tournamentTeamId)) playersOf.set(p.tournamentTeamId, []);
    playersOf.get(p.tournamentTeamId).push(p);
  }
  const teamName = new Map(teams.map((t) => [t.tournamentTeamId, t.name]));
  const teamRef = (id) => (id ? (forPublic ? teamKey(id) : id) : null);

  const teamView = (t) => {
    const list = playersOf.get(t.tournamentTeamId) || [];
    return forPublic
      ? {
          key: teamKey(t.tournamentTeamId),
          name: t.name,
          players: list.map((p) => ({ firstName: firstName(p.name), level: p.skillLevel || null })),
          registered: t.status === "Registered",
        }
      : {
          tournamentTeamId: t.tournamentTeamId,
          teamCode: t.teamCode,
          name: t.name,
          status: t.status,
          paymentStatus: t.paymentStatus,
          price: Number(t.price),
          seed: t.seed,
          addedByStaff: !t.captainPlayerId,
          players: list.map((p) => ({ name: p.name, role: p.role, email: p.email || null, level: p.skillLevel || null })),
          registeredAt: t.registeredAt,
        };
  };

  const matchView = (m) => ({
    ...(forPublic ? {} : { matchId: m.matchId, courtId: m.courtId }),
    stage: m.stage,
    groupNo: m.groupNo,
    round: m.round,
    slot: m.slot,
    teamA: teamRef(m.teamAId),
    teamB: teamRef(m.teamBId),
    teamAName: m.teamAId ? teamName.get(m.teamAId) || "Team" : null,
    teamBName: m.teamBId ? teamName.get(m.teamBId) || "Team" : null,
    court: m.courtId ? courtName.get(m.courtId) || null : null,
    scheduledAt: m.scheduledAt,
    calledAt: m.calledAt,
    status: m.status,
    scoreA: m.scoreA,
    scoreB: m.scoreB,
    winner: teamRef(m.winnerTeamId),
  });

  return {
    tournament: {
      ...(forPublic ? { key: tournament.publicToken } : { tournamentId: tournament.tournamentId, venueId: tournament.venueId, publicToken: tournament.publicToken }),
      name: tournament.name,
      description: tournament.description,
      startDate: tournament.startDate,
      endDate: tournament.endDate,
      dailyStart: String(tournament.dailyStart).slice(0, 5),
      dailyEnd: String(tournament.dailyEnd).slice(0, 5),
      registrationClosesAt: tournament.registrationClosesAt,
      registrationOpen: tournament.status === "Open" && tournament.registrationClosesAt > now,
      status: tournament.status,
      cancelReason: tournament.cancelReason,
      venueName: tournament.venueName,
      address: tournament.address,
      courts: forPublic ? courts.map((c) => c.name) : courts,
    },
    divisions: divisions.map((d) => {
      const own = teams.filter((t) => t.teamDivisionId === d.divisionId);
      const ownMatches = matches.filter((m) => m.divisionId === d.divisionId);
      const groups = [...new Set(ownMatches.filter((m) => m.stage === "Group").map((m) => m.groupNo))].sort((a, b) => a - b);
      return {
        ...(forPublic ? { key: divisionKey(d.divisionId) } : { divisionId: d.divisionId, key: divisionKey(d.divisionId) }),
        name: d.name,
        teamSize: d.teamSize,
        minLevel: d.minLevel,
        maxLevel: d.maxLevel,
        capacity: d.capacity,
        spotsLeft: Math.max(0, d.capacity - Number(d.liveTeams)),
        entryFee: Number(d.entryFee),
        format: d.format,
        groupSize: d.groupSize,
        advancePerGroup: d.advancePerGroup,
        pointsToWin: d.pointsToWin,
        winBy: d.winBy,
        drawOut: Boolean(d.drawGeneratedAt),
        teams: own.map(teamView),
        matches: ownMatches.map(matchView),
        tables: groups.map((g) => {
          const gm = ownMatches.filter((m) => m.stage === "Group" && m.groupNo === g);
          const ids = [...new Set(gm.flatMap((m) => [m.teamAId, m.teamBId]).filter(Boolean))];
          return {
            groupNo: g,
            rows: standings(ids, gm).map((r) => ({ ...r, teamId: teamRef(r.teamId), teamName: teamName.get(r.teamId) || "Team" })),
          };
        }),
      };
    }),
  };
};
