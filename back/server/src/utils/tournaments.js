import { getCurrentTimestampLocal, moment } from "./dateUtils.js";
import { findConflict } from "./courtTimeline.js";
import { conflictMessage } from "./bookings.js";
import { hashToken, randomPayCode, randomToken } from "./crypto/tokens.js";
import { REFUND_QUEUED } from "./bookingPayments.js";
import { SKILL_LEVELS } from "./venueFacts.js";
import { knockout, knockoutSeeds, roundRobin, splitGroups, standings, validScore } from "./tournamentBrackets.js";

/**
 * PLAN-009 phase E — tournaments in the database. Pure draw logic is in
 * utils/tournamentBrackets.js; this file writes it.
 *
 * Locks: a tournament row FOR UPDATE before its divisions, teams or matches
 * change; its courts (sorted) before its court hold is written. Functions
 * taking `conn` run inside the caller's transaction.
 */

const TIMEZONE = process.env.TIMEZONE || "Asia/Manila";
const FORMAT = "YYYY-MM-DD HH:mm:ss";
const fail = (status, message) => ({ ok: false, status, message });

/** A division's public key on player pages (no business ID). */
export const divisionKey = (divisionId) => hashToken(`division:${divisionId}`).slice(0, 16);
export const DIVISION_KEY_SQL = (alias) => `LEFT(SHA2(CONCAT('division:', ${alias}.divisionId), 256), 16)`;

/** A team that holds a place in its division (alias `t`, one `?` = now). */
export const LIVE_TEAM = `(t.status = 'Registered'
  OR (t.status = 'Pending' AND (t.paymentStatus IN ('Paid', 'Free') OR t.holdExpiresAt > ?)))`;

/** Lock a tournament (not Deleted) with its venue and company. */
export const lockTournament = async (conn, { tournamentId = null, publicToken = null }) => {
  const [rows] = await conn.execute(
    `SELECT t.*, v.companyId, v.name AS venueName, v.onlineHoldMinutes, v.status AS venueStatus,
            co.status AS companyStatus
     FROM tournaments t
     JOIN venues v ON v.venueId = t.venueId
     JOIN companies co ON co.companyId = v.companyId
     WHERE ${tournamentId ? "t.tournamentId = ?" : "t.publicToken = ?"} AND t.status != 'Deleted'
     LIMIT 1 FOR UPDATE`,
    [tournamentId || publicToken]
  );
  return rows[0] || null;
};

// ── the court hold ──────────────────────────────────────────────────────────

const hms = (time) => (String(time).length === 5 ? `${time}:00` : String(time).slice(0, 8));

/** Each day's held window, startDate…endDate (an end of 24:00 is the next day's 00:00). */
export const holdWindows = ({ startDate, endDate, dailyStart, dailyEnd }) => {
  const windows = [];
  const last = moment.tz(endDate, "YYYY-MM-DD", TIMEZONE);
  for (const day = moment.tz(startDate, "YYYY-MM-DD", TIMEZONE); !day.isAfter(last, "day"); day.add(1, "day")) {
    const date = day.format("YYYY-MM-DD");
    windows.push({
      startAt: `${date} ${hms(dailyStart)}`,
      endAt: hms(dailyEnd).startsWith("24:")
        ? `${day.clone().add(1, "day").format("YYYY-MM-DD")} 00:00:00`
        : `${date} ${hms(dailyEnd)}`,
    });
  }
  return windows;
};

/**
 * Hold the tournament's courts for every day of it (closures tied to it), replacing
 * any hold it had. Refuses when a booking, game, closure or Open Play is in the way,
 * or it's outside opening hours. Days already over aren't held again.
 */
export const holdCourts = async (conn, { tournament, courtIds, accountId = null, now }) => {
  const ids = [...new Set(courtIds)].sort();
  if (!ids.length) return fail(400, "Pick at least one court");
  for (const courtId of ids) {
    await conn.execute(`SELECT courtId FROM courts WHERE courtId = ? FOR UPDATE`, [courtId]);
  }
  const [courts] = await conn.execute(
    `SELECT courtId, name FROM courts WHERE venueId = ? AND status = 'Active'
     AND courtId IN (${ids.map(() => "?").join(", ")})`,
    [tournament.venueId, ...ids]
  );
  if (courts.length !== ids.length) return fail(400, "Pick courts of this venue that are in use");
  const windows = holdWindows(tournament).filter((w) => w.endAt > now);
  for (const court of courts) {
    for (const w of windows) {
      const conflict = await findConflict(conn, {
        courtId: court.courtId,
        startLocal: w.startAt < now ? now : w.startAt,
        endLocal: w.endAt,
        ignoreTournamentId: tournament.tournamentId,
        checkHours: true,
        now,
      });
      if (conflict) {
        return fail(409, `${court.name}, ${moment.tz(w.startAt, FORMAT, TIMEZONE).format("MMM D")}: ${conflictMessage(conflict)}`);
      }
    }
  }
  await conn.execute(
    `UPDATE court_closures SET status = 'Deleted', dateUpdated = ? WHERE tournamentId = ? AND status = 'Active'`,
    [now, tournament.tournamentId]
  );
  await conn.execute(`DELETE FROM tournament_courts WHERE tournamentId = ?`, [tournament.tournamentId]);
  for (const court of courts) {
    await conn.execute(`INSERT INTO tournament_courts (tournamentId, courtId) VALUES (?, ?)`, [
      tournament.tournamentId,
      court.courtId,
    ]);
    for (const w of windows) {
      const [uuid] = await conn.execute(`SELECT UUID() AS id`);
      await conn.execute(
        `INSERT INTO court_closures
           (closureId, venueId, courtId, tournamentId, startAt, endAt, reason, createdByAccountId, status,
            dateCreated, dateUpdated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?)`,
        [
          uuid[0].id,
          tournament.venueId,
          court.courtId,
          tournament.tournamentId,
          w.startAt,
          w.endAt,
          `Tournament: ${tournament.name}`.slice(0, 255),
          accountId,
          now,
          now,
        ]
      );
    }
  }
  return { ok: true };
};

/** Give the courts back (cancelled / deleted tournament). */
export const releaseCourts = (conn, tournamentId, now) =>
  conn.execute(
    `UPDATE court_closures SET status = 'Deleted', dateUpdated = ? WHERE tournamentId = ? AND status = 'Active'`,
    [now, tournamentId]
  );

// ── teams ───────────────────────────────────────────────────────────────────

/** How many teams hold a place in the division. */
export const liveTeams = async (conn, divisionId, now) => {
  const [rows] = await conn.execute(
    `SELECT COUNT(*) AS n FROM tournament_teams t WHERE t.divisionId = ? AND ${LIVE_TEAM}`,
    [divisionId, now]
  );
  return Number(rows[0].n);
};

/** The team's players → [{ playerId, name, role }]. */
export const teamPlayers = async (conn, tournamentTeamId) => {
  const [rows] = await conn.execute(
    `SELECT tp.playerId, COALESCE(p.name, tp.playerName) AS name, tp.role
     FROM tournament_team_players tp LEFT JOIN players p ON p.playerId = tp.playerId
     WHERE tp.tournamentTeamId = ? ORDER BY tp.role ASC, tp.id ASC`,
    [tournamentTeamId]
  );
  return rows;
};

/** Is this player already on a live team in the division? */
export const playerTeamInDivision = async (conn, divisionId, playerId, now) => {
  const [rows] = await conn.execute(
    `SELECT t.tournamentTeamId FROM tournament_team_players tp
     JOIN tournament_teams t ON t.tournamentTeamId = tp.tournamentTeamId
     WHERE t.divisionId = ? AND tp.playerId = ? AND ${LIVE_TEAM} LIMIT 1`,
    [divisionId, playerId, now]
  );
  return rows[0]?.tournamentTeamId || null;
};

/** Insert a team with a fresh teamCode (retrying the rare collision). */
export const insertTeam = async (conn, v) => {
  for (let attempt = 0; ; attempt += 1) {
    const [uuid] = await conn.execute(`SELECT UUID() AS id`);
    const teamCode = randomPayCode();
    try {
      await conn.execute(
        `INSERT INTO tournament_teams
           (tournamentTeamId, divisionId, captainPlayerId, name, teamCode, inviteToken, email, price,
            paymentStatus, holdExpiresAt, createdByAccountId, status, dateCreated, dateUpdated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?)`,
        [
          uuid[0].id,
          v.divisionId,
          v.captainPlayerId || null,
          v.name,
          teamCode,
          v.teamSize > 1 && v.captainPlayerId ? randomToken() : null,
          v.email || null,
          v.price,
          v.paymentStatus,
          v.holdExpiresAt || null,
          v.createdByAccountId || null,
          v.now,
          v.now,
        ]
      );
      return { tournamentTeamId: uuid[0].id, teamCode };
    } catch (err) {
      if (err.code !== "ER_DUP_ENTRY" || attempt >= 4) throw err;
    }
  }
};

export const addTeamPlayer = (conn, { tournamentTeamId, playerId = null, playerName = null, role, now }) =>
  conn.execute(
    `INSERT INTO tournament_team_players (tournamentTeamId, playerId, playerName, role, joinedAt) VALUES (?, ?, ?, ?, ?)`,
    [tournamentTeamId, playerId, playerName, role, now]
  );

/**
 * A Pending team that's paid (or free) and full becomes Registered; its invite stops working.
 * @returns {Promise<boolean>} whether it was registered just now
 */
export const registerIfComplete = async (conn, { tournamentTeamId, teamSize, now }) => {
  const [rows] = await conn.execute(
    `SELECT t.status, t.paymentStatus, (SELECT COUNT(*) FROM tournament_team_players tp
       WHERE tp.tournamentTeamId = t.tournamentTeamId) AS players
     FROM tournament_teams t WHERE t.tournamentTeamId = ? FOR UPDATE`,
    [tournamentTeamId]
  );
  const team = rows[0];
  if (!team || team.status !== "Pending") return false;
  if (!["Paid", "Free"].includes(team.paymentStatus) || Number(team.players) < teamSize) return false;
  await conn.execute(
    `UPDATE tournament_teams SET status = 'Registered', registeredAt = ?, inviteToken = NULL, holdExpiresAt = NULL,
       dateUpdated = ? WHERE tournamentTeamId = ?`,
    [now, now, tournamentTeamId]
  );
  return true;
};

/**
 * A team withdraws (or staff take it out): a paid entry's online payment is queued for a
 * refund (sent after commit). → the payment follow-up.
 */
export const withdrawTeamRow = async (conn, { team, venueId, now }) => {
  await conn.execute(
    `UPDATE tournament_teams SET status = 'Withdrawn', withdrawnAt = ?, inviteToken = NULL, holdExpiresAt = NULL,
       checkoutId = NULL, checkoutUrl = NULL, dateUpdated = ? WHERE tournamentTeamId = ?`,
    [now, now, team.tournamentTeamId]
  );
  const refundPaymentIds = [];
  if (team.paymentStatus === "Paid") {
    const [paid] = await conn.execute(
      `SELECT paymentId FROM payments
       WHERE tournamentTeamId = ? AND status = 'Paid' AND method = 'ONLINE' AND refundError IS NULL`,
      [team.tournamentTeamId]
    );
    for (const p of paid) {
      await conn.execute(`UPDATE payments SET refundError = ?, dateUpdated = ? WHERE paymentId = ?`, [
        REFUND_QUEUED,
        now,
        p.paymentId,
      ]);
      refundPaymentIds.push(p.paymentId);
    }
  }
  return { refundPaymentIds, closeCheckoutId: team.checkoutId || null, venueId };
};

/** Unpaid teams whose hold ran out → Expired. The minute job runs this. */
export const expireTeamHolds = async (db, { now = getCurrentTimestampLocal() } = {}) => {
  const result = await db.query(
    `UPDATE tournament_teams SET status = 'Expired', inviteToken = NULL, dateUpdated = ?
     WHERE status = 'Pending' AND paymentStatus = 'Unpaid' AND holdExpiresAt IS NOT NULL AND holdExpiresAt <= ?`,
    [now, now]
  );
  return Number(result?.affectedRows || 0);
};

/** Hold an entry for its checkout: the venue's online hold, but never past registration closing. */
export const teamHoldUntil = (tournament, now) => {
  const until = moment.tz(now, FORMAT, TIMEZONE).add(tournament.onlineHoldMinutes || 15, "minutes").format(FORMAT);
  return until < tournament.registrationClosesAt ? until : tournament.registrationClosesAt;
};

/** Why the division takes no new team now (null: it does). */
export const registrationProblem = (tournament, division, now) => {
  if (!tournament || tournament.venueStatus !== "Active" || tournament.companyStatus !== "Active") {
    return fail(404, "This tournament isn't available");
  }
  if (tournament.status !== "Open") return fail(409, "Registration isn't open");
  if (tournament.registrationClosesAt <= now) return fail(409, "Registration has closed");
  if (!division || division.status !== "Active") return fail(404, "Division not found");
  if (division.drawGeneratedAt) return fail(409, "The draw for this division is out");
  return null;
};

// ── the draw ────────────────────────────────────────────────────────────────

/** A team's strength for seeding: its players' average DUPR (or level 1–5). */
const teamStrength = (players) => {
  const duprs = players.map((p) => Number(p.duprRating)).filter((x) => x > 0);
  if (duprs.length === players.length && duprs.length) return 10 + duprs.reduce((a, b) => a + b, 0) / duprs.length;
  const levels = players.map((p) => SKILL_LEVELS.indexOf(p.skillLevel) + 1).map((x) => (x > 0 ? x : 3));
  return levels.length ? levels.reduce((a, b) => a + b, 0) / levels.length : 3;
};

/** Registered teams in seed order: staff's seed first, then strength, then who registered first. */
const seededTeams = async (conn, divisionId) => {
  const [teams] = await conn.execute(
    `SELECT tournamentTeamId, seed, registeredAt FROM tournament_teams
     WHERE divisionId = ? AND status = 'Registered' ORDER BY registeredAt ASC, id ASC`,
    [divisionId]
  );
  const [players] = await conn.execute(
    `SELECT tp.tournamentTeamId, sp.skillLevel, sp.duprRating
     FROM tournament_team_players tp
     JOIN tournament_teams t ON t.tournamentTeamId = tp.tournamentTeamId AND t.divisionId = ? AND t.status = 'Registered'
     LEFT JOIN player_sports sp ON sp.playerId = tp.playerId AND sp.sport = 'Pickleball' AND sp.status = 'Active'`,
    [divisionId]
  );
  const byTeam = new Map();
  for (const p of players) {
    if (!byTeam.has(p.tournamentTeamId)) byTeam.set(p.tournamentTeamId, []);
    byTeam.get(p.tournamentTeamId).push(p);
  }
  return teams
    .map((t, i) => ({ id: t.tournamentTeamId, seed: t.seed, power: teamStrength(byTeam.get(t.tournamentTeamId) || []), i }))
    .sort((a, b) => {
      if (a.seed !== null && b.seed !== null) return a.seed - b.seed;
      if (a.seed !== null) return -1;
      if (b.seed !== null) return 1;
      if (b.power !== a.power) return b.power - a.power;
      return a.i - b.i;
    })
    .map((t) => t.id);
};

const insertMatch = async (conn, m, now) => {
  const [uuid] = await conn.execute(`SELECT UUID() AS id`);
  await conn.execute(
    `INSERT INTO tournament_matches
       (matchId, divisionId, stage, groupNo, round, slot, teamAId, teamBId, status, winnerTeamId, dateCreated, dateUpdated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuid[0].id,
      m.divisionId,
      m.stage,
      m.groupNo ?? null,
      m.round,
      m.slot,
      m.teamA || null,
      m.teamB || null,
      m.status,
      m.winner || null,
      now,
      now,
    ]
  );
  return uuid[0].id;
};

/** Write a knockout tree (byes move on at once). */
const writeKnockout = async (conn, divisionId, seeds, now) => {
  const tree = knockout(seeds);
  const ids = new Map();
  for (const m of tree) {
    const status = m.round === 1 ? (m.bye ? "Bye" : "Ready") : "Pending";
    const winner = m.round === 1 && m.bye ? m.teamA || m.teamB : null;
    ids.set(`${m.round}:${m.slot}`, await insertMatch(conn, { divisionId, stage: "Knockout", ...m, status, winner }, now));
  }
  for (const m of tree) {
    if (!m.next) continue;
    await conn.execute(`UPDATE tournament_matches SET nextMatchId = ?, nextSlot = ? WHERE matchId = ?`, [
      ids.get(`${m.next.round}:${m.next.slot}`),
      m.next.side,
      ids.get(`${m.round}:${m.slot}`),
    ]);
  }
  // Byes: their team takes its place in round 2
  for (const m of tree.filter((x) => x.round === 1 && x.bye && x.next)) {
    await advanceWinner(conn, { matchId: ids.get(`1:${m.slot}`), winner: m.teamA || m.teamB, now });
  }
};

/**
 * Generate a division's draw (once): round robin, knockout, or groups then knockout.
 * @param division - the division row (its tournament locked by the caller)
 */
export const generateDraw = async (conn, { division, now }) => {
  if (division.drawGeneratedAt) return fail(409, "This division's draw is already out");
  const seeds = await seededTeams(conn, division.divisionId);
  if (seeds.length < 2) return fail(409, "A draw needs at least 2 registered teams");
  if (division.format === "SingleElimination") {
    await writeKnockout(conn, division.divisionId, seeds, now);
  } else {
    const groups =
      division.format === "RoundRobinThenKnockout" ? splitGroups(seeds, division.groupSize || 4) : [seeds];
    for (const [g, group] of groups.entries()) {
      for (const [r, pairs] of roundRobin(group).entries()) {
        for (const [i, [a, b]] of pairs.entries()) {
          await insertMatch(
            conn,
            { divisionId: division.divisionId, stage: "Group", groupNo: g + 1, round: r + 1, slot: i + 1, teamA: a, teamB: b, status: "Ready" },
            now
          );
        }
      }
    }
  }
  await conn.execute(`UPDATE tournament_divisions SET drawGeneratedAt = ?, dateUpdated = ? WHERE divisionId = ?`, [
    now,
    now,
    division.divisionId,
  ]);
  return { ok: true, teams: seeds.length };
};

/** Put a winner into the next match's slot; a match with both teams is Ready. */
const advanceWinner = async (conn, { matchId, winner, now }) => {
  const [rows] = await conn.execute(`SELECT nextMatchId, nextSlot FROM tournament_matches WHERE matchId = ?`, [matchId]);
  const link = rows[0];
  if (!link?.nextMatchId) return;
  await conn.execute(
    `UPDATE tournament_matches SET ${link.nextSlot === "A" ? "teamAId" : "teamBId"} = ?, dateUpdated = ? WHERE matchId = ?`,
    [winner, now, link.nextMatchId]
  );
  await conn.execute(
    `UPDATE tournament_matches SET status = 'Ready', dateUpdated = ?
     WHERE matchId = ? AND status = 'Pending' AND teamAId IS NOT NULL AND teamBId IS NOT NULL`,
    [now, link.nextMatchId]
  );
};

/** A division's group tables (Group stage only) → [[standing rows] per group]. */
export const groupTables = async (conn, divisionId) => {
  const [matches] = await conn.execute(
    `SELECT groupNo, teamAId, teamBId, scoreA, scoreB, status FROM tournament_matches
     WHERE divisionId = ? AND stage = 'Group' ORDER BY groupNo, round, slot`,
    [divisionId]
  );
  const groups = new Map();
  for (const m of matches) {
    if (!groups.has(m.groupNo)) groups.set(m.groupNo, { teams: [], matches: [] });
    const g = groups.get(m.groupNo);
    for (const t of [m.teamAId, m.teamBId]) if (t && !g.teams.includes(t)) g.teams.push(t);
    g.matches.push(m);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, g]) => standings(g.teams, g.matches));
};

/**
 * Record a match's score: Done, the winner set and moved on. When the last group
 * match of a groups-then-knockout division is in, the knockout is drawn.
 * @returns {Promise<{ ok: true, knockoutDrawn?: boolean } | { ok: false, … }>}
 */
export const scoreMatch = async (conn, { match, division, scoreA, scoreB, now }) => {
  if (!["Ready", "Playing", "Done"].includes(match.status)) return fail(409, "This match doesn't have both teams yet");
  if (!validScore(scoreA, scoreB, division)) {
    return fail(400, `That isn't a finished game to ${division.pointsToWin}, win by ${division.winBy}`);
  }
  if (match.status === "Done" && match.stage === "Knockout") {
    const [next] = await conn.execute(`SELECT status FROM tournament_matches WHERE matchId = ?`, [match.nextMatchId]);
    if (next[0] && ["Playing", "Done"].includes(next[0].status)) return fail(409, "The next round has started — this result can't change");
  }
  const winner = scoreA > scoreB ? match.teamAId : match.teamBId;
  await conn.execute(
    `UPDATE tournament_matches SET scoreA = ?, scoreB = ?, winnerTeamId = ?, status = 'Done', dateUpdated = ? WHERE matchId = ?`,
    [scoreA, scoreB, winner, now, match.matchId]
  );
  if (match.stage === "Knockout") {
    await advanceWinner(conn, { matchId: match.matchId, winner, now });
    return { ok: true };
  }
  if (division.format !== "RoundRobinThenKnockout") return { ok: true };
  const [left] = await conn.execute(
    `SELECT
       (SELECT COUNT(*) FROM tournament_matches WHERE divisionId = ? AND stage = 'Group' AND status != 'Done') AS open,
       (SELECT COUNT(*) FROM tournament_matches WHERE divisionId = ? AND stage = 'Knockout') AS ko`,
    [division.divisionId, division.divisionId]
  );
  if (Number(left[0].open) > 0 || Number(left[0].ko) > 0) return { ok: true };
  const seeds = knockoutSeeds(await groupTables(conn, division.divisionId), division.advancePerGroup || 2);
  if (seeds.length >= 2) await writeKnockout(conn, division.divisionId, seeds, now);
  return { ok: true, knockoutDrawn: true };
};
