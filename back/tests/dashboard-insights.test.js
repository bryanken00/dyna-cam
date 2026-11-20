// CR-023 — Dashboard insights: games played, average game length, recorded
// time per day, unpaid games, cash, peak hours and busiest days, over the last
// 7 or 30 days (Manila time).

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

describe("dashboard insights (CR-023)", () => {
  let ctx;
  let admin;
  let viewer;
  let nobody;
  const games = {};

  const call = (method, url, body, who = admin) => ctx.api(method, url, { token: who.token, body });

  /** Manila "now" moved by `minutes`, as stored. */
  const manila = async (minutes) =>
    (
      await ctx.sql.query(
        `SELECT DATE_FORMAT(DATE_ADD(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'),
                INTERVAL ? MINUTE), '%Y-%m-%d %H:%i:%s') AS t`,
        [minutes]
      )
    )[0][0].t;

  /** A game on its own court, then moved to [start, start + length] and settled. */
  const playedGame = async (name, startMinutesAgo, lengthMinutes, fields = {}) => {
    const court = await call("POST", "/admin/courts", {
      venueId: games.venueId,
      name,
      cameraRtspUrl: `rtsp://u:p@10.0.5.${Object.keys(games).length}:554/stream1`,
    });
    const created = await call("POST", "/admin/sessions", {
      courtId: court.data.courtId,
      startNow: true,
      durationMinutes: 60,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const sessionId = created.data.sessionId;
    await ctx.sql.query(
      `UPDATE recording_sessions SET startAt = ?, endAt = ?, status = ?, paymentStatus = ?
       WHERE sessionId = ?`,
      [
        await manila(-startMinutesAgo),
        await manila(-startMinutesAgo + lengthMinutes),
        fields.status || "Ready",
        fields.paymentStatus || "Unpaid",
        sessionId,
      ]
    );
    return sessionId;
  };

  const insights = (query = "", who = admin) =>
    call("GET", `/admin/dashboard/insights${query}`, undefined, who);

  before(async () => {
    ctx = await startTestApp();
    admin = await ctx.createStaff("Admin", { access: "write" });
    viewer = await ctx.createStaff("Viewer", { access: "read" });
    nobody = await ctx.createStaff("Nobody");
    games.venueId = (await call("POST", "/admin/venues", { name: "Insight Courts" })).data.venueId;

    // Today-ish: 90 min, unpaid
    games.long = await playedGame("Court A", 180, 90);
    // Yesterday: 30 min, then paid ₱300 at the desk
    games.short = await playedGame("Court B", 24 * 60 + 120, 30);
    assert.equal(
      (await call("POST", "/admin/payments", { sessionId: games.short, amount: 300 })).status,
      201
    );
    // 10 days ago: 60 min, free — in the last 30 days, and the 7 days before the last 7
    games.old = await playedGame("Court C", 10 * 24 * 60, 60, { paymentStatus: "Free" });
    // Cancelled before it recorded — never counted
    games.cancelled = await playedGame("Court D", 60, 0, { status: "Cancelled" });
  });
  after(() => ctx?.stop());

  it("sums the last 7 days", async () => {
    const res = await insights();
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const i = res.data.insights;
    assert.equal(i.days, 7);
    assert.equal(i.perDay.length, 7);
    assert.equal(i.gamesPlayed, 2);
    assert.equal(i.gamesPrevious, 1, "the game 10 days ago");
    assert.equal(i.totalRecordedSeconds, (90 + 30) * 60);
    assert.equal(i.averageGameSeconds, 60 * 60);
    assert.equal(i.recordedPerDaySeconds, Math.round((120 * 60) / 7));
    assert.deepEqual(i.cash, { total: 300, payments: 1, gamePayments: 1, averagePerGame: 300 });
    assert.equal(i.perDay.reduce((sum, d) => sum + d.games, 0), 2);
  });

  it("counts every finished game still unpaid, whatever the period", async () => {
    const i = (await insights()).data.insights;
    assert.equal(i.unpaidGames.count, 1);
    assert.ok(i.unpaidGames.oldestEndAt);
  });

  it("shows when games start and the busiest day", async () => {
    const i = (await insights()).data.insights;
    assert.equal(i.byHour.length, 24);
    assert.equal(i.byHour.reduce((sum, h) => sum + h.games, 0), 2);
    const [[{ hour }]] = await ctx.sql.query(
      `SELECT HOUR(startAt) AS hour FROM recording_sessions WHERE sessionId = ?`,
      [games.long]
    );
    assert.ok(i.byHour[hour].games >= 1);
    assert.ok(i.busiestHour.games >= 1);
    assert.deepEqual(
      i.byWeekday.map((d) => d.label),
      ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    );
    assert.equal(i.byWeekday.reduce((sum, d) => sum + d.games, 0), 2);
  });

  it("covers 30 days when asked, and nothing else", async () => {
    const i = (await insights("?days=30")).data.insights;
    assert.equal(i.perDay.length, 30);
    assert.equal(i.gamesPlayed, 3);
    assert.equal(i.totalRecordedSeconds, (90 + 30 + 60) * 60);
    assert.equal((await insights("?days=14")).status, 400);
  });

  it("needs the Dashboard permission", async () => {
    assert.equal((await insights("", viewer)).status, 200);
    assert.equal((await insights("", nobody)).status, 403);
  });
});
