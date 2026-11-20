// CR-016 — New game takes a game time: the game records at once (no device
// needed) and stops by itself at the end. Staff can Add time while it records,
// up to 6 hours in all; the payment is left as it is.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

describe("game time (CR-016)", () => {
  let ctx;
  let admin;
  let viewer;
  const home = {};
  let courtNo = 0;

  const call = (method, url, body, who = admin) => ctx.api(method, url, { token: who.token, body });

  const newCourt = async () => {
    courtNo += 1;
    const court = await call("POST", "/admin/courts", {
      venueId: home.venueId,
      name: `Court ${courtNo}`,
      cameraRtspUrl: `rtsp://u:p@10.0.1.${courtNo}:554/stream1`,
    });
    assert.equal(court.status, 201, JSON.stringify(court.body));
    return court.data.courtId;
  };

  const newGame = async (durationMinutes = 60, body = {}) => {
    const res = await call("POST", "/admin/sessions", {
      courtId: await newCourt(),
      startNow: true,
      durationMinutes,
      ...body,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.data;
  };

  const row = async (sessionId) =>
    (
      await ctx.sql.query(
        `SELECT status, startAt, endAt, openEnded, addedMinutes, paymentStatus
         FROM recording_sessions WHERE sessionId = ?`,
        [sessionId]
      )
    )[0][0];

  const minutesBetween = (from, to) =>
    Math.round((new Date(to.replace(" ", "T")) - new Date(from.replace(" ", "T"))) / 60000);

  const extend = (sessionId, minutes, who = admin) =>
    call("POST", `/admin/sessions/${sessionId}/extend`, { minutes }, who);

  before(async () => {
    ctx = await startTestApp();
    admin = await ctx.createStaff("Admin", { access: "write" });
    viewer = await ctx.createStaff("Viewer", { access: "read" });
    home.venueId = (await call("POST", "/admin/venues", { name: "Timed Courts" })).data.venueId;
  });
  after(() => ctx?.stop());

  it("records at once, with no device paired, for the game time", async () => {
    const game = await newGame(45);
    assert.equal(game.status, "Recording");

    const r = await row(game.sessionId);
    assert.equal(r.status, "Recording");
    assert.equal(Number(r.openEnded), 0);
    assert.equal(minutesBetween(r.startAt, r.endAt), 45);

    const one = await call("GET", `/admin/sessions/${game.sessionId}`);
    assert.equal(one.status, 200);
    assert.equal(one.data.session.status, "Recording");
    assert.equal(one.data.session.openEnded, false);
    assert.equal(one.data.session.durationMinutes, 45);
    assert.equal(one.data.session.addedMinutes, 0);
    assert.equal(one.data.session.devicesCount, 0);
  });

  it("refuses a game time under 5 minutes or over 3 hours", async () => {
    const courtId = await newCourt();
    for (const durationMinutes of [4, 181]) {
      const res = await call("POST", "/admin/sessions", { courtId, startNow: true, durationMinutes });
      assert.equal(res.status, 400, `${durationMinutes} min`);
    }
  });

  it("refuses a second game on a court that has one", async () => {
    const game = await newGame(60);
    const [[{ courtId }]] = await ctx.sql.query(
      `SELECT courtId FROM recording_sessions WHERE sessionId = ?`,
      [game.sessionId]
    );
    const again = await call("POST", "/admin/sessions", {
      courtId,
      startNow: true,
      durationMinutes: 30,
    });
    assert.equal(again.status, 409);
  });

  it("stops by itself when the game time is over", async () => {
    const game = await newGame(30);
    // As if the 30 minutes had passed
    await ctx.sql.query(
      `UPDATE recording_sessions
       SET startAt = DATE_SUB(startAt, INTERVAL 31 MINUTE), endAt = DATE_SUB(endAt, INTERVAL 31 MINUTE)
       WHERE sessionId = ?`,
      [game.sessionId]
    );
    const one = await call("GET", `/admin/sessions/${game.sessionId}`);
    assert.equal(one.data.session.status, "Processing");
    assert.equal(one.data.session.videosTotal, 1); // the whole video is on its way
  });

  it("adds time: the end moves later, the total is kept, the payment stays", async () => {
    const game = await newGame(60);
    const pay = await call("POST", "/admin/payments", { sessionId: game.sessionId, amount: 300 });
    assert.equal(pay.status, 201, JSON.stringify(pay.body));
    const before = await row(game.sessionId);
    assert.equal(before.paymentStatus, "Paid");

    const res = await extend(game.sessionId, 30);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.data.session.addedMinutes, 30);
    assert.equal(res.data.session.durationMinutes, 90);

    const again = await extend(game.sessionId, 15);
    assert.equal(again.status, 200);

    const after = await row(game.sessionId);
    assert.equal(minutesBetween(before.endAt, after.endAt), 45);
    assert.equal(after.startAt, before.startAt);
    assert.equal(Number(after.addedMinutes), 45);
    assert.equal(after.paymentStatus, "Paid");
    assert.equal(after.status, "Recording");
  });

  it("keeps a game to 6 hours in all", async () => {
    const game = await newGame(180);
    assert.equal((await extend(game.sessionId, 180)).status, 200);
    const full = await row(game.sessionId);

    const over = await extend(game.sessionId, 1);
    assert.equal(over.status, 400);
    assert.equal((await row(game.sessionId)).endAt, full.endAt);
    assert.equal(Number((await row(game.sessionId)).addedMinutes), 180);
  });

  it("only adds time to a game that is recording, and leaves others unchanged", async () => {
    // Missing
    assert.equal((await extend("no-such-session", 10)).status, 404);

    // Ended (End in Admin)
    const ended = await newGame(60);
    // Started 10 minutes ago (End keeps a game at least a second long)
    await ctx.sql.query(
      `UPDATE recording_sessions SET startAt = DATE_SUB(startAt, INTERVAL 10 MINUTE)
       WHERE sessionId = ?`,
      [ended.sessionId]
    );
    assert.equal((await call("POST", `/admin/sessions/${ended.sessionId}/end`)).status, 200);
    const endedBefore = await row(ended.sessionId);
    assert.equal((await extend(ended.sessionId, 10)).status, 409);
    assert.deepEqual(await row(ended.sessionId), endedBefore);

    // An open game (CR-005, older clients) has no end to move
    const open = await call("POST", "/admin/sessions", { courtId: await newCourt() });
    assert.equal(open.status, 201);
    const openBefore = await row(open.data.sessionId);
    assert.equal((await extend(open.data.sessionId, 10)).status, 409);
    assert.deepEqual(await row(open.data.sessionId), openBefore);

    // Cancelled
    const cancelled = await call("POST", "/admin/sessions", { courtId: await newCourt() });
    await call("POST", `/admin/sessions/${cancelled.data.sessionId}/cancel`);
    assert.equal((await extend(cancelled.data.sessionId, 10)).status, 409);
    assert.equal((await row(cancelled.data.sessionId)).status, "Cancelled");
  });

  it("treats a game in a deleted venue as missing", async () => {
    const venueId = (await call("POST", "/admin/venues", { name: "Closing Courts" })).data.venueId;
    const court = await call("POST", "/admin/courts", {
      venueId,
      name: "Last Court",
      cameraRtspUrl: "rtsp://u:p@10.0.2.1:554/stream1",
    });
    const game = await call("POST", "/admin/sessions", {
      courtId: court.data.courtId,
      startNow: true,
      durationMinutes: 60,
    });
    assert.equal(game.status, 201);
    assert.equal((await call("DELETE", `/admin/venues/${venueId}`)).status, 200);
    const before = await row(game.data.sessionId);

    assert.equal((await extend(game.data.sessionId, 10)).status, 404);
    assert.deepEqual(await row(game.data.sessionId), before);
  });

  it("needs write access and a sensible amount of time", async () => {
    const game = await newGame(60);
    assert.equal((await extend(game.sessionId, 10, viewer)).status, 403);
    assert.equal((await extend(game.sessionId, 0)).status, 400);
    assert.equal((await extend(game.sessionId, 1.5)).status, 400);
    assert.equal(Number((await row(game.sessionId)).addedMinutes), 0);
  });
});
