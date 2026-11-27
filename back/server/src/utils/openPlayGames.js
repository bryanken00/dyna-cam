import { selectRows } from "./dbRows.js";
import { firstName } from "./openPlay.js";
import { partnerHistory, pickNextGame } from "./openPlayQueue.js";

/**
 * PLAN-009 phase D — an Open Play session's queue in the database. Every
 * function runs inside the caller's transaction with the session row locked
 * (lockSession … FOR UPDATE), so two staff tablets can't start the same game
 * or put one player on two courts.
 *
 *   loadQueue()     who's here, waiting (in order), resting, in a game; the games
 *   queueGame()     the next four waiting → a Queued game (pickNextGame)
 *   fillCourts()    every free court gets the next Queued game (made if needed) —
 *                   unless the queue is paused
 *   endGame()       Done (score optional); its players go to the back of the line
 *   voidGame()      called off; its players keep their place
 *   swapPlayer()    a waiting player takes someone's place in a Queued game
 */

const fail = (status, message) => ({ ok: false, status, message });

/** The whole queue of a session — inside a transaction (`conn`) or a plain read (`req.db`). */
export const loadQueue = async (conn, playSessionId) => {
  const spots = await selectRows(
    conn,
    `SELECT su.playSignupId, su.status, su.checkedInAt, su.queueEnteredAt, su.isResting,
            COALESCE(p.name, su.walkInName) AS name, sp.skillLevel, sp.duprRating
     FROM play_signups su
     LEFT JOIN players p ON p.playerId = su.playerId
     LEFT JOIN player_sports sp ON sp.playerId = su.playerId AND sp.sport = 'Pickleball' AND sp.status = 'Active'
     WHERE su.playSessionId = ? AND su.status IN ('Confirmed', 'CheckedIn')
     ORDER BY su.dateCreated ASC, su.id ASC`,
    [playSessionId]
  );
  const games = await selectRows(
    conn,
    `SELECT g.playGameId, g.courtId, g.status, g.reason, g.queuedAt, g.startedAt, g.endedAt, g.scoreA, g.scoreB,
            gp.playSignupId, gp.team
     FROM play_games g
     JOIN play_game_players gp ON gp.playGameId = g.playGameId
     WHERE g.playSessionId = ?
     ORDER BY g.queuedAt ASC, g.id ASC, gp.team ASC, gp.id ASC`,
    [playSessionId]
  );
  const courts = await selectRows(
    conn,
    `SELECT c.courtId, c.name FROM play_session_courts pc JOIN courts c ON c.courtId = pc.courtId
     WHERE pc.playSessionId = ? ORDER BY c.name ASC`,
    [playSessionId]
  );

  const byGame = new Map();
  for (const row of games) {
    if (!byGame.has(row.playGameId)) {
      const { playSignupId: _id, team: _team, ...game } = row;
      byGame.set(row.playGameId, { ...game, teamA: [], teamB: [] });
    }
    byGame.get(row.playGameId)[row.team === "A" ? "teamA" : "teamB"].push(row.playSignupId);
  }
  const all = [...byGame.values()];
  const live = all.filter((g) => g.status === "Queued" || g.status === "Playing");
  const busy = new Set(live.flatMap((g) => [...g.teamA, ...g.teamB]));
  const played = new Map();
  for (const g of all.filter((x) => x.status === "Done")) {
    for (const id of [...g.teamA, ...g.teamB]) played.set(id, (played.get(id) || 0) + 1);
  }

  const people = spots.map((s) => ({
    id: s.playSignupId,
    name: s.name || "Player",
    skillLevel: s.skillLevel || null,
    duprRating: s.duprRating === null || s.duprRating === undefined ? null : Number(s.duprRating),
    here: s.status === "CheckedIn",
    resting: Boolean(s.isResting),
    enteredAt: s.queueEnteredAt || s.checkedInAt,
    gamesPlayed: played.get(s.playSignupId) || 0,
    inGame: busy.has(s.playSignupId),
  }));
  const waiting = people
    .filter((p) => p.here && !p.resting && !p.inGame && p.enteredAt)
    .sort((a, b) => (a.enteredAt < b.enteredAt ? -1 : a.enteredAt > b.enteredAt ? 1 : a.id < b.id ? -1 : 1));

  return {
    people,
    byId: new Map(people.map((p) => [p.id, p])),
    waiting,
    games: all,
    queued: live.filter((g) => g.status === "Queued"),
    playing: live.filter((g) => g.status === "Playing"),
    courts,
  };
};

const insertGame = async (conn, { playSessionId, teamA, teamB, reason, accountId, now }) => {
  const [uuid] = await conn.execute(`SELECT UUID() AS id`);
  const playGameId = uuid[0].id;
  await conn.execute(
    `INSERT INTO play_games
       (playGameId, playSessionId, status, reason, queuedAt, createdByAccountId, dateCreated, dateUpdated)
     VALUES (?, ?, 'Queued', ?, ?, ?, ?, ?)`,
    [playGameId, playSessionId, reason, now, accountId, now, now]
  );
  for (const [team, ids] of [
    ["A", teamA],
    ["B", teamB],
  ]) {
    for (const id of ids) {
      await conn.execute(`INSERT INTO play_game_players (playGameId, playSignupId, team) VALUES (?, ?, ?)`, [
        playGameId,
        id,
        team,
      ]);
    }
  }
  return playGameId;
};

/** The next four waiting → a Queued game. → { ok, playGameId } or a refusal. */
export const queueGame = async (conn, { session, accountId = null, now }) => {
  const state = await loadQueue(conn, session.playSessionId);
  const pick = pickNextGame(state.waiting, { partners: partnerHistory(state.games.filter((g) => g.status !== "Void")) });
  if (!pick) return fail(409, `${state.waiting.length} waiting — a game needs 4`);
  const playGameId = await insertGame(conn, { playSessionId: session.playSessionId, ...pick, accountId, now });
  return { ok: true, playGameId };
};

/**
 * Every free court of the session gets the oldest Queued game, or a new one
 * from the line. Nothing starts while the queue is paused.
 * @returns {Promise<number>} games started
 */
export const fillCourts = async (conn, { session, accountId = null, now }) => {
  if (session.queuePaused) return 0;
  let started = 0;
  for (let guard = 0; guard < 50; guard += 1) {
    const state = await loadQueue(conn, session.playSessionId);
    const taken = new Set(state.playing.map((g) => g.courtId));
    const court = state.courts.find((c) => !taken.has(c.courtId));
    if (!court) break;
    let next = state.queued[0]?.playGameId;
    if (!next) {
      const made = await queueGame(conn, { session, accountId, now });
      if (!made.ok) break;
      next = made.playGameId;
    }
    await conn.execute(
      `UPDATE play_games SET status = 'Playing', courtId = ?, startedAt = ?, dateUpdated = ? WHERE playGameId = ?`,
      [court.courtId, now, now, next]
    );
    started += 1;
  }
  return started;
};

/** Lock one game of this session. */
export const lockGame = async (conn, playGameId) => {
  const [rows] = await conn.execute(`SELECT * FROM play_games WHERE playGameId = ? LIMIT 1 FOR UPDATE`, [playGameId]);
  return rows[0] || null;
};

/** A Playing game ends (score optional); its players go to the back of the line. */
export const endGame = async (conn, { game, scoreA = null, scoreB = null, now }) => {
  if (game.status !== "Playing") return fail(409, "This game isn't on court");
  await conn.execute(
    `UPDATE play_games SET status = 'Done', endedAt = ?, scoreA = ?, scoreB = ?, dateUpdated = ? WHERE playGameId = ?`,
    [now, scoreA, scoreB, now, game.playGameId]
  );
  await conn.execute(
    `UPDATE play_signups su
     JOIN play_game_players gp ON gp.playSignupId = su.playSignupId AND gp.playGameId = ?
     SET su.queueEnteredAt = ?, su.dateUpdated = ?
     WHERE su.status = 'CheckedIn'`,
    [game.playGameId, now, now]
  );
  return { ok: true };
};

/** A Queued or Playing game is called off; its players keep their place in line. */
export const voidGame = async (conn, { game, now }) => {
  if (game.status !== "Queued" && game.status !== "Playing") return fail(409, "This game is already over");
  await conn.execute(`UPDATE play_games SET status = 'Void', endedAt = ?, dateUpdated = ? WHERE playGameId = ?`, [
    now,
    now,
    game.playGameId,
  ]);
  return { ok: true };
};

/** In a Queued game, `inId` (waiting) takes `outId`'s place (on the same team). */
export const swapPlayer = async (conn, { session, game, outId, inId, now }) => {
  if (game.status !== "Queued") return fail(409, "Only a game that hasn't started can change players");
  const state = await loadQueue(conn, session.playSessionId);
  if (!state.waiting.some((p) => p.id === inId)) return fail(409, "That player isn't waiting");
  const [rows] = await conn.execute(
    `SELECT id FROM play_game_players WHERE playGameId = ? AND playSignupId = ? LIMIT 1`,
    [game.playGameId, outId]
  );
  if (!rows.length) return fail(409, "That player isn't in this game");
  await conn.execute(`UPDATE play_game_players SET playSignupId = ? WHERE id = ?`, [inId, rows[0].id]);
  await conn.execute(`UPDATE play_games SET reason = ?, dateUpdated = ? WHERE playGameId = ?`, [
    "Changed by staff",
    now,
    game.playGameId,
  ]);
  return { ok: true };
};

/** The queue as staff see it. */
export const queueView = (session, state) => {
  const person = (id) => {
    const p = state.byId.get(id);
    return p ? { playSignupId: id, name: p.name, level: p.skillLevel, gamesPlayed: p.gamesPlayed } : { playSignupId: id, name: "Player" };
  };
  const gameView = (g) => ({
    playGameId: g.playGameId,
    status: g.status,
    reason: g.reason,
    queuedAt: g.queuedAt,
    startedAt: g.startedAt,
    teamA: g.teamA.map(person),
    teamB: g.teamB.map(person),
  });
  return {
    paused: Boolean(session.queuePaused),
    courts: state.courts.map((c) => {
      const game = state.playing.find((g) => g.courtId === c.courtId);
      return { courtId: c.courtId, name: c.name, game: game ? gameView(game) : null };
    }),
    next: state.queued.map(gameView),
    waiting: state.waiting.map((p, i) => ({ ...person(p.id), place: i + 1, waitingSince: p.enteredAt })),
    resting: state.people.filter((p) => p.here && p.resting).map((p) => person(p.id)),
    notHere: state.people.filter((p) => !p.here).map((p) => person(p.id)),
    recent: state.games
      .filter((g) => g.status === "Done")
      .slice(-10)
      .reverse()
      .map((g) => ({ ...gameView(g), scoreA: g.scoreA, scoreB: g.scoreB, endedAt: g.endedAt })),
  };
};

/** The queue as one player sees it: their place, or their game (first names only). */
export const playerQueueView = (state, playSignupId) => {
  const me = state.byId.get(playSignupId);
  const names = (ids) => ids.map((id) => firstName(state.byId.get(id)?.name));
  const game = [...state.playing, ...state.queued].find((g) => g.teamA.includes(playSignupId) || g.teamB.includes(playSignupId));
  const base = { waiting: state.waiting.length, gamesPlayed: me?.gamesPlayed || 0 };
  if (!me) return { ...base, state: "out" };
  if (!me.here) return { ...base, state: "notCheckedIn" };
  if (game) {
    const mineA = game.teamA.includes(playSignupId);
    const court = state.courts.find((c) => c.courtId === game.courtId);
    return {
      ...base,
      state: game.status === "Playing" ? "playing" : "next",
      court: court?.name || null,
      partners: names((mineA ? game.teamA : game.teamB).filter((id) => id !== playSignupId)),
      opponents: names(mineA ? game.teamB : game.teamA),
      gamesAhead: game.status === "Queued" ? state.queued.findIndex((g) => g.playGameId === game.playGameId) : 0,
    };
  }
  if (me.resting) return { ...base, state: "resting" };
  const place = state.waiting.findIndex((p) => p.id === playSignupId) + 1;
  return { ...base, state: "waiting", place };
};
