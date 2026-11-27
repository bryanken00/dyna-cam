import { SKILL_LEVELS } from "./venueFacts.js";

/**
 * PLAN-009 phase D — who plays next in an Open Play session. Pure: no database,
 * so every rule is unit-tested (tests/open-play-queue.test.js).
 *
 * The rules, in order:
 *   1. Queue priority is never broken: the next game is always the four players
 *      who have waited longest (earliest queueEnteredAt).
 *   2. Those four are split into the two teams whose strength is closest — DUPR
 *      when all four have one, else the level they set (Beginner 1 … Advanced 5,
 *      an unset level counts as the middle, 3).
 *   3. A tie goes to the split with the fewest repeat partners (who partnered
 *      whom earlier in this session).
 * The result carries a short reason staff can read out ("why these 4").
 */

/** A player's strength on one scale: DUPR when `useDupr`, else level 1–5. */
export const strength = (player, useDupr) => {
  if (useDupr) return Number(player.duprRating);
  const at = SKILL_LEVELS.indexOf(player.skillLevel);
  return at === -1 ? 3 : at + 1;
};

/** The three ways to split four players into two pairs, by index. */
const SPLITS = [
  [
    [0, 1],
    [2, 3],
  ],
  [
    [0, 2],
    [1, 3],
  ],
  [
    [0, 3],
    [1, 2],
  ],
];

const pairKey = (a, b) => [a, b].sort().join("|");

/**
 * Pick the next game.
 * @param {Array<{ id: string, name: string, enteredAt: string, skillLevel?: string|null,
 *   duprRating?: number|null }>} waiting - everyone in line (any order)
 * @param {{ partners?: Set<string> }} [history] - pairKey(id, id) of everyone who has
 *   already partnered in this session
 * @returns {null | { teamA: string[], teamB: string[], reason: string }} null: fewer than 4 waiting
 */
export const pickNextGame = (waiting, { partners = new Set() } = {}) => {
  if (waiting.length < 4) return null;
  const four = [...waiting]
    .sort((a, b) => (a.enteredAt < b.enteredAt ? -1 : a.enteredAt > b.enteredAt ? 1 : a.id < b.id ? -1 : 1))
    .slice(0, 4);
  const useDupr = four.every((p) => p.duprRating !== null && p.duprRating !== undefined && Number(p.duprRating) > 0);
  const power = four.map((p) => strength(p, useDupr));

  let best = null;
  for (const [a, b] of SPLITS) {
    const gap = Math.abs(power[a[0]] + power[a[1]] - (power[b[0]] + power[b[1]]));
    const repeats =
      Number(partners.has(pairKey(four[a[0]].id, four[a[1]].id))) +
      Number(partners.has(pairKey(four[b[0]].id, four[b[1]].id)));
    // Round away float noise (DUPR has 3 decimals)
    const score = Math.round(gap * 1000);
    if (!best || score < best.score || (score === best.score && repeats < best.repeats)) {
      best = { a, b, score, repeats, gap };
    }
  }

  const names = (idx) => idx.map((i) => four[i].name).join(" & ");
  const scale = useDupr ? "DUPR" : "level";
  const balance =
    best.score === 0 ? `teams even on ${scale}` : `closest teams on ${scale} (${useDupr ? best.gap.toFixed(2) : best.gap} apart)`;
  const fresh = best.repeats === 0 ? "new partners" : best.repeats === 1 ? "one pair played together before" : "both pairs played together before";
  return {
    teamA: best.a.map((i) => four[i].id),
    teamB: best.b.map((i) => four[i].id),
    reason: `Waited longest · ${balance} · ${fresh}: ${names(best.a)} vs ${names(best.b)}`.slice(0, 255),
  };
};

/** Everyone who partnered in these games → the Set pickNextGame takes. */
export const partnerHistory = (games) => {
  const partners = new Set();
  for (const game of games) {
    for (const team of [game.teamA, game.teamB]) {
      if (team.length === 2) partners.add(pairKey(team[0], team[1]));
    }
  }
  return partners;
};
