import express from "express";
import { catchAsync, validateBody, validateQuery } from "../../../utils/catchAsync.js";
import { getCurrentTimestampLocal } from "../../../utils/dateUtils.js";
import { checkPermission } from "../../../middlewares/checkPermission.middleware.js";
import { callerCompany } from "../../../utils/companyScope.js";
import { randomToken } from "../../../utils/crypto/tokens.js";
import { tournamentUrl } from "../../../utils/clips.js";
import { runPaymentFollowUps } from "../../../utils/bookingPayments.js";
import {
  addTeamPlayer,
  generateDraw,
  holdCourts,
  insertTeam,
  LIVE_TEAM,
  lockTournament,
  releaseCourts,
  scoreMatch,
  withdrawTeamRow,
} from "../../../utils/tournaments.js";
import { loadTournamentDetail } from "../../../utils/tournamentViews.js";
import { sendTournamentEmail } from "../../../utils/tournamentEmails.js";
import {
  adminTeamSchema,
  cancelTournamentSchema,
  createTournamentSchema,
  divisionSchema,
  listTournamentsQuerySchema,
  scheduleMatchSchema,
  scoreMatchSchema,
  teamSeedSchema,
  tournamentStatusSchema,
  updateTournamentSchema,
} from "../../../validators/tournaments.validator.js";

/**
 * PLAN-009 phase E — tournaments in the Admin portal (/api/v1/admin/tournaments).
 * Permission: tournaments (GET = read, the rest = write); giving money back
 * (withdraw a paid team, cancel a tournament) also needs payments write.
 * Company-scoped: another company's tournament, division, team or match is a 404.
 *
 *   GET  /options · GET / · GET /:id · POST / · PUT /:id
 *   POST /:id/status { Open|Closed|Live|Finished } · POST /:id/cancel
 *   POST /:id/divisions · PUT /divisions/:id · DELETE /divisions/:id
 *   POST /divisions/:id/teams (staff add a team) · POST /divisions/:id/draw
 *   PUT  /teams/:id/seed · POST /teams/:id/withdraw · POST /teams/:id/withdraw-refund
 *   PUT  /matches/:id (court + time) · POST /matches/:id/call · POST /matches/:id/score
 */
const router = express.Router();

/** Which status may follow which. */
const NEXT_STATUS = {
  Draft: ["Open"],
  Open: ["Closed", "Live"],
  Closed: ["Open", "Live"],
  Live: ["Finished"],
};

const fields = (body) => ({
  name: body.name,
  description: body.description || null,
  startDate: body.startDate,
  endDate: body.endDate,
  dailyStart: `${body.dailyStart}:00`,
  dailyEnd: body.dailyEnd === "24:00" ? "24:00:00" : `${body.dailyEnd}:00`,
  registrationClosesAt: `${body.registrationClosesAt}:00`,
});

/** This company's tournament, locked (inside `conn`). */
const lockCompanyTournament = async (conn, req, tournamentId) => {
  const t = await lockTournament(conn, { tournamentId });
  return t && t.companyId === callerCompany(req) ? t : null;
};

/** The tournament a division / team / match belongs to → its ID, or null. */
const ownerOf = async (conn, kind, id) => {
  const sql = {
    division: `SELECT tournamentId FROM tournament_divisions WHERE divisionId = ? AND status = 'Active'`,
    team: `SELECT d.tournamentId FROM tournament_teams tt JOIN tournament_divisions d ON d.divisionId = tt.divisionId
           WHERE tt.tournamentTeamId = ? AND tt.status != 'Deleted'`,
    match: `SELECT d.tournamentId FROM tournament_matches m JOIN tournament_divisions d ON d.divisionId = m.divisionId
            WHERE m.matchId = ? AND d.status = 'Active'`,
  }[kind];
  const [rows] = await conn.execute(sql, [id]);
  return rows[0]?.tournamentId || null;
};

/**
 * Run a write inside a transaction with this company's tournament locked.
 * `find`: how to get the tournament from the route — "tournament" | "division" | "team" | "match".
 * The action returns a reply ({ message, data, status }) or a refusal ({ ok: false, … }),
 * and may push follow-ups (refunds, emails) to run after the commit.
 */
const withTournament = (find, action) =>
  catchAsync(async (req, res) => {
    const now = getCurrentTimestampLocal();
    const after = [];
    let conn;
    let reply;
    try {
      conn = await req.db.beginTransaction();
      const id = find === "tournament" ? req.params.tournamentId : await ownerOf(conn, find, req.params.id);
      const tournament = id ? await lockCompanyTournament(conn, req, id) : null;
      if (!tournament) {
        await req.db.rollback(conn);
        return res.sendError(`${find === "tournament" ? "Tournament" : find[0].toUpperCase() + find.slice(1)} not found`, 404);
      }
      reply = await action(conn, { req, tournament, now, after });
      if (reply?.ok === false) {
        await req.db.rollback(conn);
        return res.sendError(reply.message, reply.status);
      }
      await req.db.commit(conn);
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
    for (const job of after) await job();
    return res.sendSuccess(reply?.message || "Saved", reply?.data || {}, reply?.status || 200);
  });

const editable = (t) => ["Draft", "Open", "Closed"].includes(t.status);

// ── reading ─────────────────────────────────────────────────────────────────

router.get(
  "/options",
  checkPermission("tournaments", null, "read"),
  catchAsync(async (req, res) => {
    const rows = await req.db.query(
      `SELECT v.venueId, v.name AS venueName, c.courtId, c.name AS courtName
       FROM venues v LEFT JOIN courts c ON c.venueId = v.venueId AND c.status = 'Active'
       WHERE v.companyId = ? AND v.status = 'Active' ORDER BY v.name, c.name`,
      [callerCompany(req)]
    );
    const venues = new Map();
    for (const r of rows) {
      if (!venues.has(r.venueId)) venues.set(r.venueId, { venueId: r.venueId, name: r.venueName, courts: [] });
      if (r.courtId) venues.get(r.venueId).courts.push({ courtId: r.courtId, name: r.courtName });
    }
    return res.sendSuccess("Options", { venues: [...venues.values()] });
  })
);

router.get(
  "/",
  checkPermission("tournaments", null, "read"),
  validateQuery(listTournamentsQuerySchema),
  catchAsync(async (req, res) => {
    const { venueId, status, page, pageSize } = req.query;
    const now = getCurrentTimestampLocal();
    let where = "WHERE t.status != 'Deleted'";
    const params = [];
    if (venueId) {
      where += " AND t.venueId = ?";
      params.push(venueId);
    }
    if (status) {
      where += " AND t.status = ?";
      params.push(status);
    }
    const from = `FROM tournaments t JOIN venues v ON v.venueId = t.venueId AND v.status != 'Deleted' AND v.companyId = ?`;
    const [count, rows] = await Promise.all([
      req.db.query(`SELECT COUNT(*) AS total ${from} ${where}`, [callerCompany(req), ...params]),
      req.db.query(
        `SELECT t.tournamentId, t.venueId, v.name AS venueName, t.name, t.startDate, t.endDate, t.registrationClosesAt,
                t.status, t.publicToken,
                (SELECT COUNT(*) FROM tournament_divisions d WHERE d.tournamentId = t.tournamentId AND d.status = 'Active') AS divisions,
                (SELECT COUNT(*) FROM tournament_teams tt JOIN tournament_divisions d ON d.divisionId = tt.divisionId
                 WHERE d.tournamentId = t.tournamentId AND d.status = 'Active' AND tt.status = 'Registered') AS teams
         ${from} ${where}
         ORDER BY t.startDate DESC, t.id DESC
         LIMIT ? OFFSET ?`,
        [callerCompany(req), ...params, Number(pageSize), (page - 1) * pageSize]
      ),
    ]);
    const total = Number(count[0]?.total || 0);
    return res.sendSuccess("Tournaments", {
      tournaments: rows.map((r) => ({
        ...r,
        divisions: Number(r.divisions),
        teams: Number(r.teams),
        shareUrl: tournamentUrl(r.publicToken),
        registrationOpen: r.status === "Open" && r.registrationClosesAt > now,
      })),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  })
);

router.get(
  "/:tournamentId",
  checkPermission("tournaments", null, "read"),
  catchAsync(async (req, res) => {
    const [own] = await req.db.query(
      `SELECT t.tournamentId FROM tournaments t JOIN venues v ON v.venueId = t.venueId AND v.companyId = ?
       WHERE t.tournamentId = ? AND t.status != 'Deleted' LIMIT 1`,
      [callerCompany(req), req.params.tournamentId]
    );
    if (!own) return res.sendError("Tournament not found", 404);
    const detail = await loadTournamentDetail(req.db, own.tournamentId);
    detail.tournament.shareUrl = tournamentUrl(detail.tournament.publicToken);
    return res.sendSuccess("Tournament", detail);
  })
);

// ── the tournament ──────────────────────────────────────────────────────────

router.post(
  "/",
  checkPermission("tournaments", null, "write"),
  validateBody(createTournamentSchema),
  catchAsync(async (req, res) => {
    const now = getCurrentTimestampLocal();
    let conn;
    let tournamentId;
    let publicToken;
    try {
      conn = await req.db.beginTransaction();
      const [venue] = await conn.execute(
        `SELECT venueId FROM venues WHERE venueId = ? AND companyId = ? AND status != 'Deleted' LIMIT 1 FOR UPDATE`,
        [req.body.venueId, callerCompany(req)]
      );
      if (!venue.length) {
        await req.db.rollback(conn);
        return res.sendError("Venue not found", 400);
      }
      if (req.body.endDate < now.slice(0, 10)) {
        await req.db.rollback(conn);
        return res.sendError("The tournament must end in the future", 400);
      }
      const [uuid] = await conn.execute(`SELECT UUID() AS id`);
      tournamentId = uuid[0].id;
      publicToken = randomToken();
      const f = fields(req.body);
      await conn.execute(
        `INSERT INTO tournaments
           (tournamentId, venueId, publicToken, name, description, startDate, endDate, dailyStart, dailyEnd,
            registrationClosesAt, createdByAccountId, status, dateCreated, dateUpdated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Draft', ?, ?)`,
        [tournamentId, req.body.venueId, publicToken, f.name, f.description, f.startDate, f.endDate, f.dailyStart,
          f.dailyEnd, f.registrationClosesAt, req.user.accountId, now, now]
      );
      const tournament = await lockTournament(conn, { tournamentId });
      const held = await holdCourts(conn, { tournament, courtIds: req.body.courtIds, accountId: req.user.accountId, now });
      if (!held.ok) {
        await req.db.rollback(conn);
        return res.sendError(held.message, held.status);
      }
      await req.db.commit(conn);
    } catch (err) {
      await req.db.rollback(conn);
      throw err;
    }
    return res.sendSuccess("Tournament added — add its divisions, then open registration", {
      tournamentId,
      shareUrl: tournamentUrl(publicToken),
    }, 201);
  })
);

router.put(
  "/:tournamentId",
  checkPermission("tournaments", null, "write"),
  validateBody(updateTournamentSchema),
  withTournament("tournament", async (conn, { req, tournament, now }) => {
    if (!editable(tournament)) return { ok: false, status: 409, message: `A ${tournament.status.toLowerCase()} tournament can't be changed` };
    const f = fields(req.body);
    await conn.execute(
      `UPDATE tournaments SET name = ?, description = ?, startDate = ?, endDate = ?, dailyStart = ?, dailyEnd = ?,
         registrationClosesAt = ?, dateUpdated = ? WHERE tournamentId = ?`,
      [f.name, f.description, f.startDate, f.endDate, f.dailyStart, f.dailyEnd, f.registrationClosesAt, now, tournament.tournamentId]
    );
    const held = await holdCourts(conn, {
      tournament: { ...tournament, ...f },
      courtIds: req.body.courtIds,
      accountId: req.user.accountId,
      now,
    });
    if (!held.ok) return held;
    return { message: "Tournament updated" };
  })
);

router.post(
  "/:tournamentId/status",
  checkPermission("tournaments", null, "write"),
  validateBody(tournamentStatusSchema),
  withTournament("tournament", async (conn, { req, tournament, now }) => {
    const next = req.body.status;
    if (!(NEXT_STATUS[tournament.status] || []).includes(next)) {
      return { ok: false, status: 409, message: `A ${tournament.status.toLowerCase()} tournament can't be set to ${next.toLowerCase()}` };
    }
    if (next === "Open") {
      const [divs] = await conn.execute(
        `SELECT COUNT(*) AS n FROM tournament_divisions WHERE tournamentId = ? AND status = 'Active'`,
        [tournament.tournamentId]
      );
      if (!Number(divs[0].n)) return { ok: false, status: 409, message: "Add a division before opening registration" };
      if (tournament.registrationClosesAt <= now) return { ok: false, status: 409, message: "Move the registration deadline into the future first" };
    }
    await conn.execute(`UPDATE tournaments SET status = ?, dateUpdated = ? WHERE tournamentId = ?`, [next, now, tournament.tournamentId]);
    if (next === "Finished") await releaseCourts(conn, tournament.tournamentId, now);
    return {
      message: { Open: "Registration is open", Closed: "Registration is closed", Live: "The tournament is live", Finished: "The tournament is finished" }[next],
    };
  })
);

router.post(
  "/:tournamentId/cancel",
  checkPermission("tournaments", null, "write"),
  checkPermission("payments", null, "write"),
  validateBody(cancelTournamentSchema),
  withTournament("tournament", async (conn, { req, tournament, now, after }) => {
    if (["Finished", "Cancelled"].includes(tournament.status)) {
      return { ok: false, status: 409, message: `This tournament is already ${tournament.status.toLowerCase()}` };
    }
    await conn.execute(`UPDATE tournaments SET status = 'Cancelled', cancelReason = ?, dateUpdated = ? WHERE tournamentId = ?`, [
      req.body.reason || null,
      now,
      tournament.tournamentId,
    ]);
    await releaseCourts(conn, tournament.tournamentId, now);
    const [teams] = await conn.execute(
      `SELECT tt.* FROM tournament_teams tt JOIN tournament_divisions d ON d.divisionId = tt.divisionId
       WHERE d.tournamentId = ? AND tt.status IN ('Pending', 'Registered') FOR UPDATE`,
      [tournament.tournamentId]
    );
    for (const team of teams) {
      const followUp = await withdrawTeamRow(conn, { team, venueId: tournament.venueId, now });
      after.push(() => runPaymentFollowUps(req.db, followUp, { accountId: req.user.accountId, reason: "CANCELLATION" }));
      after.push(() => sendTournamentEmail(req.db, team.tournamentTeamId, "Withdrawn"));
    }
    return { message: "Tournament cancelled", data: { withdrawnTeams: teams.length } };
  })
);

// ── divisions ───────────────────────────────────────────────────────────────

const divisionValues = (b) => [
  b.name,
  b.teamSize,
  b.minLevel || null,
  b.maxLevel || null,
  b.capacity,
  b.entryFee,
  b.format,
  b.format === "RoundRobinThenKnockout" ? b.groupSize : null,
  b.format === "RoundRobinThenKnockout" ? b.advancePerGroup : null,
  b.pointsToWin,
  b.winBy,
];

router.post(
  "/:tournamentId/divisions",
  checkPermission("tournaments", null, "write"),
  validateBody(divisionSchema),
  withTournament("tournament", async (conn, { req, tournament, now }) => {
    if (!editable(tournament)) return { ok: false, status: 409, message: "Divisions can't be added now" };
    const [uuid] = await conn.execute(`SELECT UUID() AS id`);
    await conn.execute(
      `INSERT INTO tournament_divisions
         (divisionId, tournamentId, name, teamSize, minLevel, maxLevel, capacity, entryFee, format, groupSize,
          advancePerGroup, pointsToWin, winBy, status, dateCreated, dateUpdated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?)`,
      [uuid[0].id, tournament.tournamentId, ...divisionValues(req.body), now, now]
    );
    return { message: "Division added", data: { divisionId: uuid[0].id }, status: 201 };
  })
);

router.put(
  "/divisions/:id",
  checkPermission("tournaments", null, "write"),
  validateBody(divisionSchema),
  withTournament("division", async (conn, { req, now }) => {
    const [rows] = await conn.execute(`SELECT * FROM tournament_divisions WHERE divisionId = ? FOR UPDATE`, [req.params.id]);
    const d = rows[0];
    if (d.drawGeneratedAt) return { ok: false, status: 409, message: "The draw is out — the division can't change" };
    const [live] = await conn.execute(
      `SELECT COUNT(*) AS n FROM tournament_teams t WHERE t.divisionId = ? AND ${LIVE_TEAM}`,
      [d.divisionId, now]
    );
    if (req.body.capacity < Number(live[0].n)) {
      return { ok: false, status: 409, message: `${live[0].n} teams have entered — the cap can't be lower than that` };
    }
    if (Number(live[0].n) > 0 && req.body.teamSize !== d.teamSize) {
      return { ok: false, status: 409, message: "Teams have entered — the team size can't change" };
    }
    await conn.execute(
      `UPDATE tournament_divisions SET name = ?, teamSize = ?, minLevel = ?, maxLevel = ?, capacity = ?, entryFee = ?,
         format = ?, groupSize = ?, advancePerGroup = ?, pointsToWin = ?, winBy = ?, dateUpdated = ?
       WHERE divisionId = ?`,
      [...divisionValues(req.body), now, d.divisionId]
    );
    return { message: "Division updated" };
  })
);

router.delete(
  "/divisions/:id",
  checkPermission("tournaments", null, "write"),
  withTournament("division", async (conn, { req, now }) => {
    const [live] = await conn.execute(
      `SELECT COUNT(*) AS n FROM tournament_teams t WHERE t.divisionId = ? AND ${LIVE_TEAM}`,
      [req.params.id, now]
    );
    if (Number(live[0].n) > 0) return { ok: false, status: 409, message: "Teams have entered this division — withdraw them first" };
    await conn.execute(`UPDATE tournament_divisions SET status = 'Deleted', dateUpdated = ? WHERE divisionId = ?`, [now, req.params.id]);
    return { message: "Division removed" };
  })
);

router.post(
  "/divisions/:id/teams",
  checkPermission("tournaments", null, "write"),
  validateBody(adminTeamSchema),
  withTournament("division", async (conn, { req, tournament, now }) => {
    if (!editable(tournament)) return { ok: false, status: 409, message: "Teams can't be added now" };
    const [rows] = await conn.execute(`SELECT * FROM tournament_divisions WHERE divisionId = ? FOR UPDATE`, [req.params.id]);
    const d = rows[0];
    if (d.drawGeneratedAt) return { ok: false, status: 409, message: "The draw is out" };
    if (req.body.players.length !== d.teamSize) {
      return { ok: false, status: 400, message: `A team here has ${d.teamSize} player${d.teamSize === 1 ? "" : "s"}` };
    }
    const [live] = await conn.execute(`SELECT COUNT(*) AS n FROM tournament_teams t WHERE t.divisionId = ? AND ${LIVE_TEAM}`, [
      d.divisionId,
      now,
    ]);
    if (Number(live[0].n) >= d.capacity) return { ok: false, status: 409, message: "This division is full" };
    const team = await insertTeam(conn, {
      divisionId: d.divisionId,
      name: req.body.name,
      teamSize: d.teamSize,
      price: 0,
      paymentStatus: "Free",
      createdByAccountId: req.user.accountId,
      now,
    });
    for (const [i, name] of req.body.players.entries()) {
      await addTeamPlayer(conn, { tournamentTeamId: team.tournamentTeamId, playerName: name, role: i ? "Partner" : "Captain", now });
    }
    await conn.execute(
      `UPDATE tournament_teams SET status = 'Registered', registeredAt = ?, dateUpdated = ? WHERE tournamentTeamId = ?`,
      [now, now, team.tournamentTeamId]
    );
    return { message: "Team added", data: team, status: 201 };
  })
);

router.post(
  "/divisions/:id/draw",
  checkPermission("tournaments", null, "write"),
  withTournament("division", async (conn, { req, tournament, now, after }) => {
    if (!["Open", "Closed", "Live"].includes(tournament.status)) {
      return { ok: false, status: 409, message: "Open registration before drawing" };
    }
    const [rows] = await conn.execute(`SELECT * FROM tournament_divisions WHERE divisionId = ? FOR UPDATE`, [req.params.id]);
    const done = await generateDraw(conn, { division: rows[0], now });
    if (!done.ok) return done;
    const [teams] = await conn.execute(
      `SELECT tournamentTeamId FROM tournament_teams WHERE divisionId = ? AND status = 'Registered'`,
      [req.params.id]
    );
    for (const t of teams) after.push(() => sendTournamentEmail(req.db, t.tournamentTeamId, "DrawOut"));
    return { message: `Draw out — ${done.teams} teams`, data: { teams: done.teams } };
  })
);

// ── teams ───────────────────────────────────────────────────────────────────

router.put(
  "/teams/:id/seed",
  checkPermission("tournaments", null, "write"),
  validateBody(teamSeedSchema),
  withTournament("team", async (conn, { req, now }) => {
    await conn.execute(`UPDATE tournament_teams SET seed = ?, dateUpdated = ? WHERE tournamentTeamId = ?`, [
      req.body.seed,
      now,
      req.params.id,
    ]);
    return { message: "Seed saved" };
  })
);

const withdraw = (refund) =>
  withTournament("team", async (conn, { req, tournament, now, after }) => {
    const [rows] = await conn.execute(`SELECT * FROM tournament_teams WHERE tournamentTeamId = ? FOR UPDATE`, [req.params.id]);
    const team = rows[0];
    if (!["Pending", "Registered"].includes(team.status)) return { ok: false, status: 409, message: "This team is already out" };
    if (team.paymentStatus === "Paid" && !refund) return { ok: false, status: 409, message: "This team paid — use Withdraw and refund" };
    const [drawn] = await conn.execute(
      `SELECT COUNT(*) AS n FROM tournament_matches WHERE teamAId = ? OR teamBId = ?`,
      [team.tournamentTeamId, team.tournamentTeamId]
    );
    if (Number(drawn[0].n) > 0) return { ok: false, status: 409, message: "This team is in the draw — enter its matches as walkovers instead" };
    const followUp = await withdrawTeamRow(conn, { team, venueId: tournament.venueId, now });
    after.push(() => runPaymentFollowUps(req.db, followUp, { accountId: req.user.accountId, reason: "CANCELLATION" }));
    after.push(() => sendTournamentEmail(req.db, team.tournamentTeamId, "Withdrawn"));
    return { message: "Team withdrawn" };
  });

router.post("/teams/:id/withdraw", checkPermission("tournaments", null, "write"), withdraw(false));
router.post(
  "/teams/:id/withdraw-refund",
  checkPermission("tournaments", null, "write"),
  checkPermission("payments", null, "write"),
  withdraw(true)
);

// ── matches ─────────────────────────────────────────────────────────────────

const lockMatch = async (conn, matchId) => {
  const [rows] = await conn.execute(`SELECT * FROM tournament_matches WHERE matchId = ? FOR UPDATE`, [matchId]);
  return rows[0];
};

router.put(
  "/matches/:id",
  checkPermission("tournaments", null, "write"),
  validateBody(scheduleMatchSchema),
  withTournament("match", async (conn, { req, tournament, now }) => {
    if (req.body.courtId) {
      const [court] = await conn.execute(`SELECT 1 FROM tournament_courts WHERE tournamentId = ? AND courtId = ?`, [
        tournament.tournamentId,
        req.body.courtId,
      ]);
      if (!court.length) return { ok: false, status: 400, message: "Pick one of the tournament's courts" };
    }
    const match = await lockMatch(conn, req.params.id);
    if (["Done", "Bye"].includes(match.status)) return { ok: false, status: 409, message: "This match is over" };
    await conn.execute(`UPDATE tournament_matches SET courtId = ?, scheduledAt = ?, dateUpdated = ? WHERE matchId = ?`, [
      req.body.courtId,
      req.body.scheduledAt,
      now,
      match.matchId,
    ]);
    return { message: "Match scheduled" };
  })
);

router.post(
  "/matches/:id/call",
  checkPermission("tournaments", null, "write"),
  withTournament("match", async (conn, { req, now, after }) => {
    const match = await lockMatch(conn, req.params.id);
    if (match.status !== "Ready") return { ok: false, status: 409, message: match.status === "Playing" ? "Already on court" : "This match doesn't have both teams yet" };
    if (!match.courtId) return { ok: false, status: 409, message: "Give the match a court first" };
    await conn.execute(`UPDATE tournament_matches SET status = 'Playing', calledAt = ?, dateUpdated = ? WHERE matchId = ?`, [
      now,
      now,
      match.matchId,
    ]);
    const [names] = await conn.execute(
      `SELECT (SELECT name FROM courts WHERE courtId = ?) AS court,
              (SELECT name FROM tournament_teams WHERE tournamentTeamId = ?) AS a,
              (SELECT name FROM tournament_teams WHERE tournamentTeamId = ?) AS b`,
      [match.courtId, match.teamAId, match.teamBId]
    );
    const n = names[0];
    after.push(() => sendTournamentEmail(req.db, match.teamAId, "MatchCalled", { court: n.court, opponent: n.b }));
    after.push(() => sendTournamentEmail(req.db, match.teamBId, "MatchCalled", { court: n.court, opponent: n.a }));
    return { message: `Called to ${n.court}` };
  })
);

router.post(
  "/matches/:id/score",
  checkPermission("tournaments", null, "write"),
  validateBody(scoreMatchSchema),
  withTournament("match", async (conn, { req, now }) => {
    const match = await lockMatch(conn, req.params.id);
    const [rows] = await conn.execute(`SELECT * FROM tournament_divisions WHERE divisionId = ?`, [match.divisionId]);
    const done = await scoreMatch(conn, { match, division: rows[0], scoreA: req.body.scoreA, scoreB: req.body.scoreB, now });
    if (!done.ok) return done;
    return { message: done.knockoutDrawn ? "Score saved — the knockout is drawn" : "Score saved", data: { knockoutDrawn: Boolean(done.knockoutDrawn) } };
  })
);

export default router;
