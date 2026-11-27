// PLAN-009 phase D — the Open Play queue: the next game is always the four who waited
// longest, split into the fairest teams (DUPR when all four have one, else level), new
// partners breaking a tie. Staff run it: free courts fill, ending a game sends its players
// to the back of the line and refills the court, a voided game keeps their place, two
// tablets can't start the same game. Players see their place; the TV board shows it all
// (first names only).

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const ALL_DAY = EVERY_DAY.map((dayOfWeek) => ({ dayOfWeek, opensAt: "00:00", closesAt: "24:00" }));

describe("Open Play queue (PLAN-009 phase D)", () => {
  describe("pickNextGame", () => {
    let pickNextGame;
    let partnerHistory;
    before(async () => {
      ({ pickNextGame, partnerHistory } = await import("../server/src/utils/openPlayQueue.js"));
    });

    const p = (id, enteredAt, extra = {}) => ({ id, name: id.toUpperCase(), enteredAt, ...extra });

    it("needs four waiting", () => {
      assert.equal(pickNextGame([p("a", "1"), p("b", "2"), p("c", "3")]), null);
    });

    it("always takes the four who waited longest", () => {
      const game = pickNextGame([p("e", "5"), p("a", "1"), p("d", "4"), p("b", "2"), p("c", "3")]);
      assert.deepEqual([...game.teamA, ...game.teamB].sort(), ["a", "b", "c", "d"]);
    });

    it("splits by level so the teams are closest", () => {
      const game = pickNextGame([
        p("a", "1", { skillLevel: "Advanced" }),
        p("b", "2", { skillLevel: "High Intermediate" }),
        p("c", "3", { skillLevel: "Beginner" }),
        p("d", "4", { skillLevel: "Low Intermediate" }),
      ]);
      // Advanced (5) + Beginner (1) = 6 vs High Int (4) + Low Int (2) = 6
      const teams = [game.teamA.slice().sort().join(""), game.teamB.slice().sort().join("")].sort();
      assert.deepEqual(teams, ["ac", "bd"]);
      assert.match(game.reason, /teams even on level/);
    });

    it("uses DUPR when all four have one", () => {
      const game = pickNextGame([
        p("a", "1", { duprRating: 4.5, skillLevel: "Beginner" }),
        p("b", "2", { duprRating: 4.4, skillLevel: "Beginner" }),
        p("c", "3", { duprRating: 3.0, skillLevel: "Advanced" }),
        p("d", "4", { duprRating: 3.1, skillLevel: "Advanced" }),
      ]);
      const teams = [game.teamA.slice().sort().join(""), game.teamB.slice().sort().join("")].sort();
      assert.deepEqual(teams, ["ac", "bd"]);
      assert.match(game.reason, /DUPR/);
    });

    it("breaks a tie with new partners", () => {
      const four = [p("a", "1"), p("b", "2"), p("c", "3"), p("d", "4")];
      const history = partnerHistory([{ teamA: ["a", "b"], teamB: ["c", "d"] }]);
      const game = pickNextGame(four, { partners: history });
      const teams = [game.teamA.slice().sort().join(""), game.teamB.slice().sort().join("")].sort();
      assert.notDeepEqual(teams, ["ab", "cd"]);
      assert.match(game.reason, /new partners/);
    });
  });

  describe("running a session's queue", () => {
    let ctx;
    let admin;
    let moment;
    const home = {};
    const signups = [];

    const call = (method, url, body) => ctx.api(method, url, { token: admin.token, body: body ?? undefined });
    const queue = async () => (await call("GET", `/admin/open-play/sessions/${home.id}/queue`)).data.queue;

    before(async () => {
      ctx = await startTestApp();
      admin = await ctx.createStaff("Admin", { access: "write" });
      ({ moment } = await ctx.importFromBack("server/src/utils/dateUtils.js"));
      home.venueId = (await call("POST", "/admin/venues", { name: "Queue Courts" })).data.venueId;
      home.courts = [];
      for (const name of ["Court 1", "Court 2"]) {
        home.courts.push((await call("POST", "/admin/courts", { venueId: home.venueId, name })).data.courtId);
      }
      await call("PUT", `/admin/booking-settings/${home.venueId}`, {
        maxBookingMinutes: 180,
        bookingDaysAhead: 14,
        deskHoldMinutes: 30,
        onlineHoldMinutes: 15,
        cancelCutoffHours: 24,
        checkInEarlyMinutes: 10,
        hours: ALL_DAY,
        rates: [{ name: "All day", daysOfWeek: EVERY_DAY, startTime: "00:00", endTime: "24:00", pricePerHour: 300 }],
      });
      const display = await call("POST", `/admin/booking-settings/${home.venueId}/display-link`);
      assert.equal(display.status, 200, JSON.stringify(display.body));
      home.displayToken = display.data.displayUrl.split("/board/")[1];

      // A session running now: from the start of this hour for two hours (same day)
      const start = moment().tz("Asia/Manila").startOf("hour");
      const end = moment.min(start.clone().add(2, "hours"), start.clone().endOf("day").add(1, "second"));
      const made = await call("POST", "/admin/open-play/sessions", {
        venueId: home.venueId,
        title: "Live Open Play",
        date: start.format("YYYY-MM-DD"),
        startTime: start.format("HH:mm"),
        endTime: end.format("HH:mm") === "00:00" ? "24:00" : end.format("HH:mm"),
        courtIds: home.courts,
        capacity: 20,
        pricePerHead: 0,
      });
      assert.equal(made.status, 201, JSON.stringify(made.body));
      home.id = made.data.playSessionId;
      home.token = made.data.shareUrl.split("/open-play/")[1];

      // Nine players join and check in (one at a time, so the line has an order)
      for (let i = 1; i <= 9; i += 1) {
        const player = await ctx.signInPlayer({ email: `q${i}@example.test`, name: `Queue${i} Player` });
        const joined = await ctx.api("POST", `/player/play/sessions/${home.token}/join`, { player: player.token });
        assert.equal(joined.status, 201, JSON.stringify(joined.body));
        signups.push({ ...player, signupCode: joined.data.signupCode });
      }
      const detail = await call("GET", `/admin/open-play/sessions/${home.id}`);
      for (const [i, s] of detail.data.signups.entries()) {
        signups[i].playSignupId = s.playSignupId;
        await ctx.sql.query(`UPDATE play_signups SET status = 'CheckedIn', checkedInAt = ?, queueEnteredAt = ? WHERE playSignupId = ?`, [
          start.format("YYYY-MM-DD HH:mm:ss"),
          start.clone().add(i, "seconds").format("YYYY-MM-DD HH:mm:ss"),
          s.playSignupId,
        ]);
      }
    });
    after(async () => {
      await ctx?.stop();
    });

    it("fills both courts with the eight who waited longest — once, even from two tablets", async () => {
      const [one, two] = await Promise.all([
        call("POST", `/admin/open-play/sessions/${home.id}/queue/fill`),
        call("POST", `/admin/open-play/sessions/${home.id}/queue/fill`),
      ]);
      assert.equal(one.status, 200, JSON.stringify(one.body));
      assert.equal(two.status, 200, JSON.stringify(two.body));
      assert.equal(one.data.started + two.data.started, 2);

      const q = await queue();
      assert.ok(q.courts.every((c) => c.game));
      const onCourt = q.courts.flatMap((c) => [...c.game.teamA, ...c.game.teamB].map((x) => x.name));
      assert.equal(new Set(onCourt).size, 8);
      assert.deepEqual(q.waiting.map((w) => w.name), ["Queue9 Player"]);
    });

    it("tells a player their place, or their court and partner", async () => {
      const waiting = await ctx.api("GET", `/player/play/signups/${signups[8].signupCode}/queue`, { player: signups[8].token });
      assert.equal(waiting.status, 200, JSON.stringify(waiting.body));
      assert.equal(waiting.data.queue.state, "waiting");
      assert.equal(waiting.data.queue.place, 1);

      const playing = await ctx.api("GET", `/player/play/signups/${signups[0].signupCode}/queue`, { player: signups[0].token });
      assert.equal(playing.data.queue.state, "playing");
      assert.ok(playing.data.queue.court);
      assert.equal(playing.data.queue.partners.length, 1);
      assert.equal(playing.data.queue.opponents.length, 2);
      assert.ok(!JSON.stringify(playing.body).includes("Player")); // first names only
    });

    it("ends a game: its four go to the back, and the court refills with the next four", async () => {
      const before = await queue();
      const court = before.courts[0];
      const ended = await call("POST", `/admin/open-play/games/${court.game.playGameId}/end`, { scoreA: 11, scoreB: 7 });
      assert.equal(ended.status, 200, JSON.stringify(ended.body));
      const q = ended.data.queue;
      const next = q.courts.find((c) => c.courtId === court.courtId).game;
      assert.ok(next, "the court got a new game");
      const names = [...next.teamA, ...next.teamB].map((x) => x.name);
      // Queue9 waited longest; the other three come from the four who just finished
      assert.ok(names.includes("Queue9 Player"));
      assert.equal(q.waiting.length, 1);
      assert.equal(q.recent[0].scoreA, 11);
    });

    it("keeps a voided game's players in their place, and pausing stops new games", async () => {
      assert.equal((await call("POST", `/admin/open-play/sessions/${home.id}/queue/pause`, { paused: true })).status, 200);
      const q = await queue();
      const game = q.courts[1].game;
      const voided = await call("POST", `/admin/open-play/games/${game.playGameId}/void`);
      assert.equal(voided.status, 200);
      const after = voided.data.queue;
      assert.equal(after.courts[1].game, null, "paused: the court stays free");
      assert.equal(after.waiting.length, 5);

      const resumed = await call("POST", `/admin/open-play/sessions/${home.id}/queue/pause`, { paused: false });
      assert.ok(resumed.data.queue.courts.every((c) => c.game));
    });

    it("rests a player (skipped by the queue) and brings them back at the end of the line", async () => {
      const q = await queue();
      const waiter = q.waiting[0];
      const rested = await call("POST", `/admin/open-play/signups/${waiter.playSignupId}/rest`, { resting: true });
      assert.equal(rested.status, 200, JSON.stringify(rested.body));
      assert.ok(rested.data.queue.resting.some((r) => r.playSignupId === waiter.playSignupId));
      assert.ok(!rested.data.queue.waiting.some((w) => w.playSignupId === waiter.playSignupId));
      const back = await call("POST", `/admin/open-play/signups/${waiter.playSignupId}/rest`, { resting: false });
      const line = back.data.queue.waiting;
      assert.equal(line[line.length - 1].playSignupId, waiter.playSignupId);
    });

    it("lines up the next game and swaps a waiting player in", async () => {
      // Walk-ins until five wait — a game lined up, and one left to swap in
      const names = ["Walk Inna", "Walk Otto", "Walk Pia", "Walk Quin", "Walk Rae"];
      while ((await queue()).waiting.length < 5) {
        const extra = await call("POST", `/admin/open-play/sessions/${home.id}/walk-ins`, { name: names.shift() });
        assert.equal((await call("POST", `/admin/open-play/signups/${extra.data.playSignupId}/check-in`)).status, 200);
      }
      const lined = await call("POST", `/admin/open-play/sessions/${home.id}/queue/next`);
      assert.equal(lined.status, 200, JSON.stringify(lined.body));
      const game = lined.data.queue.next[0];
      const out = game.teamA[0];
      const inn = lined.data.queue.waiting[0];
      const swapped = await call("POST", `/admin/open-play/games/${game.playGameId}/swap`, {
        outSignupId: out.playSignupId,
        inSignupId: inn.playSignupId,
      });
      assert.equal(swapped.status, 200, JSON.stringify(swapped.body));
      const now = swapped.data.queue.next[0];
      assert.ok(now.teamA.some((x) => x.playSignupId === inn.playSignupId));
      assert.equal(now.reason, "Changed by staff");
    });

    it("shows the session on the TV board with first names only", async () => {
      const board = await ctx.api("GET", `/public/board/${home.displayToken}`);
      assert.equal(board.status, 200, JSON.stringify(board.body));
      const live = board.data.openPlay[0];
      assert.equal(live.title, "Live Open Play");
      assert.ok(live.courts.every((c) => c.game && c.game.teamA.length === 2));
      assert.ok(!JSON.stringify(live).includes("Player"));
    });

    it("lists a player's finished games with partner, opponents and score", async () => {
      // End the session's games, then read the first player's past spot
      const q = await queue();
      for (const c of q.courts) {
        if (c.game) await call("POST", `/admin/open-play/games/${c.game.playGameId}/end`, { scoreA: 11, scoreB: 9 });
      }
      await ctx.sql.query(`UPDATE play_sessions SET endAt = startAt + INTERVAL 1 MINUTE WHERE playSessionId = ?`, [home.id]);
      const past = await ctx.api("GET", "/player/play/signups?when=past", { player: signups[0].token });
      assert.equal(past.status, 200, JSON.stringify(past.body));
      const games = past.data.spots[0].games;
      assert.ok(games.length >= 1);
      assert.equal(games[0].partners.length, 1);
      assert.equal(games[0].opponents.length, 2);
      assert.equal(typeof games[0].won, "boolean");
    });

    it("is a 404 for another company's staff", async () => {
      const other = await ctx.createCompany("Queue Rivals");
      const res = await ctx.api("GET", `/admin/open-play/sessions/${home.id}/queue`, { token: other.owner.token });
      assert.equal(res.status, 404);
      const fill = await ctx.api("POST", `/admin/open-play/sessions/${home.id}/queue/fill`, { token: other.owner.token });
      assert.equal(fill.status, 404);
    });
  });
});
