/**
 * PLAN-009 phase E — tournament draws, pure (no database), unit-tested in
 * tests/tournament-brackets.test.js.
 *
 *   roundRobin(teams)            every pair once, in rounds (circle method; a bye for an odd count)
 *   splitGroups(teams, size)     snake seeding into groups of about `size`
 *   standings(teams, matches)    a group's table: wins, then point difference, then head-to-head
 *   knockout(seeded)             a single-elimination tree for any count (byes for the top seeds)
 *   knockoutSeeds(groupTables, n) group winners first, then runners-up …, crossed so two
 *                                teams of one group meet as late as possible
 */

/** Every pair once: [[ [a, b], … ] per round]. Teams are IDs, in seed order. */
export const roundRobin = (teams) => {
  const list = [...teams];
  if (list.length < 2) return [];
  if (list.length % 2) list.push(null); // a bye
  const n = list.length;
  const rounds = [];
  let ring = list.slice(1);
  for (let r = 0; r < n - 1; r += 1) {
    const order = [list[0], ...ring];
    const pairs = [];
    for (let i = 0; i < n / 2; i += 1) {
      const a = order[i];
      const b = order[n - 1 - i];
      if (a !== null && b !== null) pairs.push(r % 2 ? [b, a] : [a, b]);
    }
    rounds.push(pairs);
    ring = [ring[ring.length - 1], ...ring.slice(0, -1)];
  }
  return rounds;
};

/**
 * Snake seeding into groups: with 3 groups, seeds 1-2-3 go to groups 1-2-3,
 * seeds 4-5-6 to 3-2-1, and so on. → [[ids of group 1], [ids of group 2], …]
 */
export const splitGroups = (teams, size) => {
  const count = Math.max(1, Math.round(teams.length / Math.max(2, size)));
  const groups = Array.from({ length: count }, () => []);
  teams.forEach((team, i) => {
    const lap = Math.floor(i / count);
    const at = i % count;
    groups[lap % 2 ? count - 1 - at : at].push(team);
  });
  return groups;
};

/**
 * A group's table from its Done matches.
 * @param {string[]} teams
 * @param {Array<{ teamAId, teamBId, scoreA, scoreB, status }>} matches
 * @returns {Array<{ teamId, played, wins, losses, pointsFor, pointsAgainst, diff }>} best first
 */
export const standings = (teams, matches) => {
  const rows = new Map(
    teams.map((t) => [t, { teamId: t, played: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, diff: 0 }])
  );
  const beat = new Set();
  for (const m of matches) {
    if (m.status !== "Done" || !rows.has(m.teamAId) || !rows.has(m.teamBId)) continue;
    const a = rows.get(m.teamAId);
    const b = rows.get(m.teamBId);
    a.played += 1;
    b.played += 1;
    a.pointsFor += m.scoreA;
    a.pointsAgainst += m.scoreB;
    b.pointsFor += m.scoreB;
    b.pointsAgainst += m.scoreA;
    const aWon = m.scoreA > m.scoreB;
    (aWon ? a : b).wins += 1;
    (aWon ? b : a).losses += 1;
    beat.add(aWon ? `${m.teamAId}>${m.teamBId}` : `${m.teamBId}>${m.teamAId}`);
  }
  for (const r of rows.values()) r.diff = r.pointsFor - r.pointsAgainst;
  return [...rows.values()].sort((x, y) => {
    if (y.wins !== x.wins) return y.wins - x.wins;
    if (y.diff !== x.diff) return y.diff - x.diff;
    if (beat.has(`${x.teamId}>${y.teamId}`)) return -1;
    if (beat.has(`${y.teamId}>${x.teamId}`)) return 1;
    return teams.indexOf(x.teamId) - teams.indexOf(y.teamId);
  });
};

/** Seed positions in a bracket of `size` (a power of 2): 1 v size, 2 v size-1 meet last … */
const bracketOrder = (size) => {
  let order = [1];
  while (order.length < size) {
    const next = order.length * 2 + 1;
    order = order.flatMap((s) => [s, next - s]);
  }
  return order;
};

/**
 * A single-elimination tree. → matches [{ round, slot, teamA, teamB, bye, next: { round, slot, side } }]
 * Round 1 has size/2 matches (size = the next power of 2); a missing seed is a bye: its
 * opponent moves on at once. Rounds count up to the final.
 */
export const knockout = (seeded) => {
  if (seeded.length < 2) return [];
  let size = 1;
  while (size < seeded.length) size *= 2;
  const order = bracketOrder(size);
  const rounds = Math.log2(size);
  const matches = [];
  for (let r = 1; r <= rounds; r += 1) {
    const count = size / 2 ** r;
    for (let slot = 1; slot <= count; slot += 1) {
      const m = { round: r, slot, teamA: null, teamB: null, bye: false, next: null };
      if (r === 1) {
        m.teamA = seeded[order[(slot - 1) * 2] - 1] ?? null;
        m.teamB = seeded[order[(slot - 1) * 2 + 1] - 1] ?? null;
        m.bye = !m.teamA || !m.teamB;
      }
      if (r < rounds) m.next = { round: r + 1, slot: Math.ceil(slot / 2), side: slot % 2 ? "A" : "B" };
      matches.push(m);
    }
  }
  return matches;
};

/**
 * The knockout's seeds from group tables: every group's 1st (in group order),
 * then each lower place, each team put on a seed line in the other half of the
 * bracket from its group's winner — so group-mates meet as late as possible.
 * @param {Array<Array<{ teamId }>>} tables - standings per group
 */
export const knockoutSeeds = (tables, advancePerGroup) => {
  const total = tables.reduce((n, t) => n + Math.min(t.length, advancePerGroup), 0);
  let size = 1;
  while (size < total) size *= 2;
  const order = bracketOrder(size);
  const half = (seedNumber) => (order.indexOf(seedNumber) < size / 2 ? 0 : 1);

  const winners = tables.map((t) => t[0]?.teamId).filter(Boolean);
  const seeds = [...winners];
  const winnerHalf = new Map(tables.map((t, g) => [g, half(g + 1)]));
  for (let place = 1; place < advancePerGroup; place += 1) {
    const left = tables.map((t, g) => ({ g, teamId: t[place]?.teamId })).filter((x) => x.teamId);
    while (left.length) {
      const seedNumber = seeds.length + 1;
      let at = left.findIndex((x) => winnerHalf.get(x.g) !== half(seedNumber));
      if (at === -1) at = 0;
      seeds.push(left.splice(at, 1)[0].teamId);
    }
  }
  return seeds;
};

/** Is a score a finished game? (to pointsToWin, win by winBy; deuce allowed past it) */
export const validScore = (a, b, { pointsToWin = 11, winBy = 2 } = {}) => {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (hi < pointsToWin || hi - lo < winBy) return false;
  return hi === pointsToWin || hi - lo === winBy;
};
