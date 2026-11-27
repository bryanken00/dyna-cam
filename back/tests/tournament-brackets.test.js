// PLAN-009 phase E — the pure tournament draw logic (utils/tournamentBrackets.js).

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

describe("tournament brackets (PLAN-009 phase E)", () => {
  let b;
  before(async () => {
    b = await import("../server/src/utils/tournamentBrackets.js");
  });

  const pairsOf = (rounds) => rounds.flat().map(([x, y]) => [x, y].sort().join("-"));

  it("round robin: every pair exactly once, nobody twice in a round", () => {
    for (const n of [2, 3, 4, 5, 6, 7, 8]) {
      const teams = Array.from({ length: n }, (_, i) => `t${i + 1}`);
      const rounds = b.roundRobin(teams);
      const pairs = pairsOf(rounds);
      assert.equal(pairs.length, (n * (n - 1)) / 2, `n=${n}`);
      assert.equal(new Set(pairs).size, pairs.length, `n=${n} repeats`);
      for (const round of rounds) {
        const seen = round.flat();
        assert.equal(new Set(seen).size, seen.length, `n=${n}: a team twice in a round`);
      }
    }
  });

  it("splits groups by snake seeding", () => {
    const groups = b.splitGroups(["1", "2", "3", "4", "5", "6", "7", "8"], 4);
    assert.deepEqual(groups, [
      ["1", "4", "5", "8"],
      ["2", "3", "6", "7"],
    ]);
  });

  it("ranks a group by wins, then point difference, then head-to-head", () => {
    const table = b.standings(
      ["a", "b", "c"],
      [
        { teamAId: "a", teamBId: "b", scoreA: 11, scoreB: 9, status: "Done" },
        { teamAId: "b", teamBId: "c", scoreA: 11, scoreB: 3, status: "Done" },
        { teamAId: "c", teamBId: "a", scoreA: 11, scoreB: 5, status: "Done" },
      ]
    );
    // All 1–1; diffs: a −4, b +6, c −2
    assert.deepEqual(table.map((r) => r.teamId), ["b", "c", "a"]);
    assert.equal(table[0].wins, 1);
    const tied = b.standings(["x", "y"], [{ teamAId: "y", teamBId: "x", scoreA: 11, scoreB: 9, status: "Done" }]);
    assert.equal(tied[0].teamId, "y");
  });

  it("builds a knockout with byes for the top seeds and links every winner forward", () => {
    const tree = b.knockout(["s1", "s2", "s3", "s4", "s5", "s6"]);
    const first = tree.filter((m) => m.round === 1);
    assert.equal(first.length, 4);
    const byes = first.filter((m) => m.bye);
    assert.equal(byes.length, 2);
    assert.deepEqual(byes.map((m) => m.teamA || m.teamB).sort(), ["s1", "s2"]);
    // 1 and 2 can only meet in the final
    const half = (seed) => first.findIndex((m) => m.teamA === seed || m.teamB === seed) < 2;
    assert.notEqual(half("s1"), half("s2"));
    const final = tree.find((m) => m.round === 3);
    assert.equal(final.next, null);
    assert.ok(tree.filter((m) => m.round < 3).every((m) => m.next));
  });

  it("seeds a knockout from groups so group-mates meet only in the final", () => {
    for (const groupCount of [2, 3, 4]) {
      const tables = Array.from({ length: groupCount }, (_, g) => [
        { teamId: `G${g}-1` },
        { teamId: `G${g}-2` },
      ]);
      const seeds = b.knockoutSeeds(tables, 2);
      assert.equal(seeds.length, groupCount * 2);
      assert.deepEqual(seeds.slice(0, groupCount), tables.map((t) => t[0].teamId));
      const tree = b.knockout(seeds);
      const firstRound = tree.filter((m) => m.round === 1);
      const halfOf = (team) => {
        const i = firstRound.findIndex((m) => m.teamA === team || m.teamB === team);
        return i < firstRound.length / 2 ? 0 : 1;
      };
      for (let g = 0; g < groupCount; g += 1) {
        assert.notEqual(halfOf(`G${g}-1`), halfOf(`G${g}-2`), `${groupCount} groups: group ${g} in one half`);
      }
    }
  });

  it("knows a finished pickleball game score", () => {
    assert.equal(b.validScore(11, 9), true);
    assert.equal(b.validScore(11, 10), false);
    assert.equal(b.validScore(12, 10), true);
    assert.equal(b.validScore(13, 10), false);
    assert.equal(b.validScore(15, 13, { pointsToWin: 15 }), true);
    assert.equal(b.validScore(9, 3), false);
  });
});
