// PLAN-009 phase E — tournaments: staff hold courts for the event's days (booking can't take
// them), add divisions and open registration; players register a doubles team, the partner
// joins by the invite link, the captain pays the entry online; staff generate the draw (round
// robin, knockout with byes, or groups then knockout), schedule and call matches and enter
// scores — winners move on by themselves. Withdrawing a paid team refunds it; cancelling the
// tournament gives the courts back. Company-scoped; the public pages carry no business IDs.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const ALL_DAY = EVERY_DAY.map((dayOfWeek) => ({ dayOfWeek, opensAt: "00:00", closesAt: "24:00" }));

describe("tournaments (PLAN-009 phase E)", () => {
  let ctx;
  let admin;
  let moment;
  let settleInvoice;
  let n = 0;
  const home = {};

  const call = (method, url, body) => ctx.api(method, url, { token: admin.token, body: body ?? undefined });
  const as = (p, method, url, body) => ctx.api(method, url, { player: p.token, body: body ?? undefined });
  const day = (d) => moment().tz("Asia/Manila").add(d, "days").format("YYYY-MM-DD");
  const player = () => {
    n += 1;
    return ctx.signInPlayer({ email: `t${n}@example.test`, name: `Tour${n} Person` });
  };
  const payCheckout = async (url) => {
    const id = url.split("/").pop();
    assert.equal((await ctx.api("POST", `/public/payment-sandbox/${id}/pay`)).status, 200);
    return settleInvoice(ctx.db, id);
  };
  const detail = async () => {
    const res = await call("GET", `/admin/tournaments/${home.id}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.data;
  };
  const division = async (name) => (await detail()).divisions.find((d) => d.name === name);
  const addDivision = async (body) => {
    const res = await call("POST", `/admin/tournaments/${home.id}/divisions`, {
      teamSize: 2,
      capacity: 8,
      entryFee: 0,
      pointsToWin: 11,
      winBy: 2,
      ...body,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.data.divisionId;
  };
  const staffTeams = async (divisionId, count, prefix) => {
    for (let i = 1; i <= count; i += 1) {
      const res = await call("POST", `/admin/tournaments/divisions/${divisionId}/teams`, {
        name: `${prefix}${i}`,
        players: [`${prefix}${i} One`, `${prefix}${i} Two`],
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
    }
  };
  const scoreAll = async (divisionId, filter = () => true) => {
    const d = (await detail()).divisions.find((x) => x.divisionId === divisionId);
    for (const m of d.matches.filter((x) => x.status === "Ready" && filter(x))) {
      const res = await call("POST", `/admin/tournaments/matches/${m.matchId}/score`, { scoreA: 11, scoreB: 6 });
      assert.equal(res.status, 200, JSON.stringify(res.body));
    }
  };

  before(async () => {
    ctx = await startTestApp();
    admin = await ctx.createStaff("Admin", { access: "write" });
    ({ moment } = await ctx.importFromBack("server/src/utils/dateUtils.js"));
    ({ settleInvoice } = await ctx.importFromBack("server/src/utils/bookingPayments.js"));
    home.venueId = (await call("POST", "/admin/venues", { name: "Tournament Courts" })).data.venueId;
    home.courts = [];
    for (const name of ["Court 1", "Court 2", "Court 3"]) {
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
    home.bookingToken = (await call("POST", `/admin/booking-settings/${home.venueId}/link`)).data.bookingUrl.split("/book/")[1];
    const page = await ctx.api("GET", `/public/book/${home.bookingToken}`);
    home.courtKeys = Object.fromEntries(page.data.courts.map((c) => [c.name, c.key]));
  });
  after(async () => {
    await ctx?.stop();
  });

  it("adds a Draft tournament that holds its courts on its days", async () => {
    const res = await call("POST", "/admin/tournaments", {
      venueId: home.venueId,
      name: "Club Doubles Open",
      startDate: day(10),
      endDate: day(11),
      dailyStart: "08:00",
      dailyEnd: "18:00",
      registrationClosesAt: `${day(9)} 20:00`,
      courtIds: home.courts.slice(0, 2),
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    home.id = res.data.tournamentId;
    home.token = res.data.shareUrl.split("/events/")[1];

    const p = await player();
    const refused = await ctx.api("POST", `/public/book/${home.bookingToken}/bookings`, {
      player: p.token,
      body: { date: day(10), slots: [{ courtKey: home.courtKeys["Court 1"], startTime: "10:00" }] },
    });
    assert.equal(refused.status, 409);
    const free = await ctx.api("POST", `/public/book/${home.bookingToken}/bookings`, {
      player: p.token,
      body: { date: day(10), slots: [{ courtKey: home.courtKeys["Court 3"], startTime: "10:00" }] },
    });
    assert.equal(free.status, 201, JSON.stringify(free.body));
    assert.equal((await call("GET", `/admin/closures?venueId=${home.venueId}&when=upcoming`)).data.closures.length, 0);
    // A Draft isn't public
    assert.equal((await ctx.api("GET", `/public/tournaments/${home.token}`)).status, 404);
  });

  it("opens registration only once it has a division", async () => {
    assert.equal((await call("POST", `/admin/tournaments/${home.id}/status`, { status: "Open" })).status, 409);
    home.rr = await addDivision({ name: "Mixed 3.5", format: "RoundRobin", capacity: 4 });
    assert.equal((await call("POST", `/admin/tournaments/${home.id}/status`, { status: "Finished" })).status, 409);
    assert.equal((await call("POST", `/admin/tournaments/${home.id}/status`, { status: "Open" })).status, 200);
    const list = await ctx.api("GET", "/public/tournaments");
    assert.ok(list.data.tournaments.some((t) => t.key === home.token && t.registrationOpen));
  });

  it("registers a doubles team: the partner joins by the invite, then it's registered", async () => {
    const pub = await ctx.api("GET", `/public/tournaments/${home.token}`);
    assert.equal(pub.status, 200, JSON.stringify(pub.body));
    const key = pub.data.divisions.find((d) => d.name === "Mixed 3.5").key;
    home.rrKey = key;
    const cap = await player();
    const reg = await as(cap, "POST", `/player/tournaments/${home.token}/divisions/${key}/register`, { name: "Smashers" });
    assert.equal(reg.status, 201, JSON.stringify(reg.body));
    assert.equal(reg.data.status, "Pending");
    const invite = reg.data.inviteUrl.split("/team-invite/")[1];
    const info = await ctx.api("GET", `/public/tournaments/invites/${invite}`);
    assert.equal(info.data.invite.teamName, "Smashers");

    const partner = await player();
    const joined = await as(partner, "POST", `/player/tournaments/invites/${invite}/join`);
    assert.equal(joined.status, 200, JSON.stringify(joined.body));
    assert.equal(joined.data.registered, true);
    assert.equal((await ctx.api("GET", `/public/tournaments/invites/${invite}`)).status, 404);
    // On a team already: can't register again
    const again = await as(partner, "POST", `/player/tournaments/${home.token}/divisions/${key}/register`, {});
    assert.equal(again.status, 409, JSON.stringify(again.body));
    const mine = await as(partner, "GET", "/player/tournaments/mine");
    assert.equal(mine.data.teams[0].name, "Smashers");
    assert.equal(mine.data.teams[0].captain, false);
  });

  it("keeps business IDs off the public page", async () => {
    const pub = await ctx.api("GET", `/public/tournaments/${home.token}`);
    const text = JSON.stringify(pub.body);
    assert.ok(!text.includes(home.id) && !text.includes(home.rr) && !text.includes(home.venueId));
    assert.ok(!text.includes("Person")); // first names only
  });

  it("round robin: draws every pair once, refuses a second draw and an unfinished score", async () => {
    await staffTeams(home.rr, 3, "RR");
    const draw = await call("POST", `/admin/tournaments/divisions/${home.rr}/draw`);
    assert.equal(draw.status, 200, JSON.stringify(draw.body));
    assert.equal((await call("POST", `/admin/tournaments/divisions/${home.rr}/draw`)).status, 409);
    const d = await division("Mixed 3.5");
    assert.equal(d.matches.length, 6);
    const bad = await call("POST", `/admin/tournaments/matches/${d.matches[0].matchId}/score`, { scoreA: 11, scoreB: 10 });
    assert.equal(bad.status, 400);
    // Registration is closed for a drawn division
    const p = await player();
    const late = await as(p, "POST", `/player/tournaments/${home.token}/divisions/${home.rrKey}/register`, {});
    assert.equal(late.status, 409, JSON.stringify(late.body));
    await scoreAll(home.rr);
    const table = (await division("Mixed 3.5")).tables[0].rows;
    assert.equal(table.length, 4);
    assert.ok(table[0].wins >= table[3].wins);
  });

  it("knockout: byes for the top seeds, winners move on to the final", async () => {
    const ko = await addDivision({ name: "Open Knockout", format: "SingleElimination" });
    await staffTeams(ko, 3, "KO");
    assert.equal((await call("POST", `/admin/tournaments/divisions/${ko}/draw`)).status, 200);
    let d = await division("Open Knockout");
    assert.equal(d.matches.filter((m) => m.status === "Bye").length, 1);
    await scoreAll(ko);
    d = await division("Open Knockout");
    const final = d.matches.find((m) => m.round === 2);
    assert.equal(final.status, "Ready");
    await scoreAll(ko);
    d = await division("Open Knockout");
    assert.ok(d.matches.find((m) => m.round === 2).winner);
  });

  it("groups then knockout: the knockout is drawn when the last group match is in", async () => {
    const gk = await addDivision({ name: "Groups", format: "RoundRobinThenKnockout", groupSize: 3, advancePerGroup: 2 });
    await staffTeams(gk, 6, "G");
    assert.equal((await call("POST", `/admin/tournaments/divisions/${gk}/draw`)).status, 200);
    let d = await division("Groups");
    assert.equal(d.matches.filter((m) => m.stage === "Group").length, 6);
    assert.equal(d.matches.filter((m) => m.stage === "Knockout").length, 0);
    await scoreAll(gk);
    d = await division("Groups");
    const ko = d.matches.filter((m) => m.stage === "Knockout");
    assert.equal(ko.length, 3); // 4 teams: two semis and a final
    assert.equal(ko.filter((m) => m.status === "Ready").length, 2);
  });

  it("schedules and calls a match only on the tournament's courts", async () => {
    const gk = (await division("Groups")).divisionId;
    const semi = (await detail()).divisions.find((x) => x.divisionId === gk).matches.find((m) => m.stage === "Knockout" && m.status === "Ready");
    assert.equal((await call("POST", `/admin/tournaments/matches/${semi.matchId}/call`)).status, 409);
    const wrong = await call("PUT", `/admin/tournaments/matches/${semi.matchId}`, { courtId: home.courts[2], scheduledAt: `${day(10)} 09:00` });
    assert.equal(wrong.status, 400);
    const ok = await call("PUT", `/admin/tournaments/matches/${semi.matchId}`, { courtId: home.courts[0], scheduledAt: `${day(10)} 09:00` });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const called = await call("POST", `/admin/tournaments/matches/${semi.matchId}/call`);
    assert.equal(called.status, 200, JSON.stringify(called.body));
    const after = (await detail()).divisions.find((x) => x.divisionId === gk).matches.find((m) => m.matchId === semi.matchId);
    assert.equal(after.status, "Playing");
    assert.equal(after.court, "Court 1");
  });

  it("a paid entry: the captain pays, the partner joins, a withdrawal before the draw is refunded", async () => {
    const paid = await addDivision({ name: "Paid Doubles", format: "SingleElimination", entryFee: 500 });
    const pub = await ctx.api("GET", `/public/tournaments/${home.token}`);
    const key = pub.data.divisions.find((d) => d.name === "Paid Doubles").key;
    const cap = await player();
    const reg = await as(cap, "POST", `/player/tournaments/${home.token}/divisions/${key}/register`, { name: "Payers" });
    assert.equal(reg.status, 201, JSON.stringify(reg.body));
    assert.ok(reg.data.checkoutUrl);
    assert.equal((await payCheckout(reg.data.checkoutUrl)).outcome, "CONFIRMED");
    const [[row]] = await ctx.sql.query(`SELECT status, paymentStatus FROM tournament_teams WHERE teamCode = ?`, [reg.data.teamCode]);
    assert.deepEqual([row.status, row.paymentStatus], ["Pending", "Paid"]);

    const partner = await player();
    const invite = reg.data.inviteUrl.split("/team-invite/")[1];
    assert.equal((await as(partner, "POST", `/player/tournaments/invites/${invite}/join`)).data.registered, true);

    const out = await as(cap, "POST", `/player/tournaments/teams/${reg.data.teamCode}/withdraw`);
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(out.data.refunded, 500);
    const [[gone]] = await ctx.sql.query(`SELECT status, paymentStatus FROM tournament_teams WHERE teamCode = ?`, [reg.data.teamCode]);
    assert.deepEqual([gone.status, gone.paymentStatus], ["Withdrawn", "Refunded"]);
    // Only the captain withdraws
    assert.equal((await as(partner, "POST", `/player/tournaments/teams/${reg.data.teamCode}/withdraw`)).status, 404);
    assert.ok(paid);
  });

  it("is a 404 for another company's staff", async () => {
    const other = (await ctx.createCompany("Tournament Rivals")).owner;
    const get = (url) => ctx.api("GET", url, { token: other.token });
    assert.equal((await get(`/admin/tournaments/${home.id}`)).status, 404);
    assert.equal((await ctx.api("POST", `/admin/tournaments/${home.id}/cancel`, { token: other.token, body: {} })).status, 404);
    assert.equal((await ctx.api("POST", `/admin/tournaments/divisions/${home.rr}/draw`, { token: other.token })).status, 404);
    assert.equal((await get("/admin/tournaments")).data.tournaments.length, 0);
  });

  it("cancelling gives the courts back", async () => {
    const res = await call("POST", `/admin/tournaments/${home.id}/cancel`, { reason: "Typhoon" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const p = await player();
    const booked = await ctx.api("POST", `/public/book/${home.bookingToken}/bookings`, {
      player: p.token,
      body: { date: day(10), slots: [{ courtKey: home.courtKeys["Court 1"], startTime: "11:00" }] },
    });
    assert.equal(booked.status, 201, JSON.stringify(booked.body));
    assert.equal((await call("POST", `/admin/tournaments/${home.id}/cancel`, {})).status, 409);
  });

  it("is a 404 for a Deleted tournament", async () => {
    await ctx.sql.query(`UPDATE tournaments SET status = 'Deleted' WHERE tournamentId = ?`, [home.id]);
    assert.equal((await call("GET", `/admin/tournaments/${home.id}`)).status, 404);
    assert.equal((await ctx.api("GET", `/public/tournaments/${home.token}`)).status, 404);
  });
});
