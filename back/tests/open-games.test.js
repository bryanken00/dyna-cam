// CR-005 — a game is created without times: it waits for a session device,
// pairing the first device starts the recording, and only End game (device)
// or End (Admin) stops it. Nothing ends it by the clock.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

describe("open games", () => {
  let ctx;
  let admin;
  let viewer;
  const home = {};

  const call = (method, url, body, who = admin) => ctx.api(method, url, { token: who.token, body });
  const asDevice =
    (token) =>
    (method, url, options = {}) =>
      ctx.api(method, url, { ...options, headers: { Authorization: `Device ${token}` } });
  const asApp = (token) => (method, url, body) =>
    ctx.api(method, url, { body, headers: { Authorization: `App ${token}` } });

  const newGame = (courtId = home.courtId, body = {}) =>
    call("POST", "/admin/sessions", { courtId, ...body });

  /** Pair a device to the game with a fresh 6-digit key. @returns the device's API */
  const pair = async (sessionId, name = "Court 1 tablet") => {
    const key = await call("POST", `/admin/sessions/${sessionId}/pairing-codes`, { name });
    assert.equal(key.status, 201, JSON.stringify(key.body));
    const res = await ctx.api("POST", "/pair/app", { body: { code: key.data.code } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return { app: asApp(res.data.token), session: res.data.session };
  };

  const row = async (sessionId) =>
    (
      await ctx.sql.query(
        `SELECT status, startAt, endAt, openEnded, dateCreated FROM recording_sessions
         WHERE sessionId = ?`,
        [sessionId]
      )
    )[0][0];

  const nowManila = async (minutes = 0) => {
    const [[r]] = await ctx.sql.query(
      `SELECT DATE_FORMAT(DATE_ADD(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'),
               INTERVAL ? SECOND), '%Y-%m-%d %H:%i:%s') AS t`,
      [Math.round(minutes * 60)]
    );
    return r.t;
  };

  const jobsFor = async (sessionId) =>
    (await home.device("GET", "/device/jobs?wait=0")).data.jobs.filter(
      (job) => job.sessionId === sessionId
    );

  before(async () => {
    ctx = await startTestApp({
      env: { RATE_LIMIT_PAIR_POINTS: "1000", RATE_LIMIT_PAIR_HOURLY_POINTS: "1000" },
    });
    admin = await ctx.createStaff("Admin", { access: "write" });
    viewer = await ctx.createStaff("Viewer", { access: "read" });
    home.venueId = (await call("POST", "/admin/venues", { name: "Open Courts" })).data.venueId;
    const court = await call("POST", "/admin/courts", {
      venueId: home.venueId,
      name: "Court 1",
      cameraRtspUrl: "rtsp://u:p@10.0.0.9:554/stream1",
    });
    home.courtId = court.data.courtId;
    const court2 = await call("POST", "/admin/courts", {
      venueId: home.venueId,
      name: "Court 2",
      cameraRtspUrl: "rtsp://u:p@10.0.0.10:554/stream1",
    });
    home.court2Id = court2.data.courtId;
    home.device = asDevice((await ctx.pairBox(admin.token, home.venueId, "Box")).data.token);
  });
  after(() => ctx?.stop());

  let game;

  it("creates a game without times that waits for a device and records nothing", async () => {
    const created = await newGame(home.courtId, { playerName: "Open Player" });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.data.status, "Waiting");
    game = created.data;

    const stored = await row(game.sessionId);
    assert.equal(stored.status, "Waiting");
    assert.equal(stored.openEnded, 1);
    assert.deepEqual(await jobsFor(game.sessionId), [], "nothing to cut while waiting");

    const detail = await call("GET", `/admin/sessions/${game.sessionId}`);
    assert.equal(detail.data.session.status, "Waiting");
    assert.equal(detail.data.session.openEnded, true);
    assert.equal(detail.data.session.startAt, null);
    assert.equal(detail.data.session.endAt, null, "no placeholder end shown");

    const page = await ctx.api("GET", `/public/sessions/${game.shareUrl.split("/").pop()}`);
    assert.equal(page.data.session.status, "Waiting");
    assert.equal(page.data.session.endAt, null);
  });

  it("refuses a second game on a court that has one, and read-only staff", async () => {
    const again = await newGame(home.courtId);
    assert.equal(again.status, 409);
    assert.match(again.body.message, /already has a game/);
    const denied = await call("POST", "/admin/sessions", { courtId: home.court2Id }, viewer);
    assert.equal(denied.status, 403);
  });

  let device;

  it("starts recording the moment the first device pairs", async () => {
    const before = await nowManila(-2);
    device = await pair(game.sessionId);
    assert.equal(device.session.status, "Recording");
    assert.equal(device.session.openEnded, true);
    assert.equal(device.session.endsInSeconds, 0, "no countdown to an end");
    assert.ok(device.session.elapsedSeconds <= 5, "the timer starts at 0:00");

    const stored = await row(game.sessionId);
    assert.equal(stored.status, "Recording");
    assert.ok(stored.startAt >= before, "starts at pairing, not at creation");
    assert.ok(stored.endAt > (await nowManila(5 * 60)), "its end is far ahead");
  });

  it("doesn't restart when a second device pairs", async () => {
    const { startAt } = await row(game.sessionId);
    await new Promise((r) => setTimeout(r, 1100));
    const second = await pair(game.sessionId, "Phone 2");
    assert.equal(second.session.status, "Recording");
    assert.equal((await row(game.sessionId)).startAt, startAt);
  });

  it("is never ended by the clock: its end keeps rolling ahead", async () => {
    // Pretend the game has run 12 minutes and its rolling end is about to pass
    await ctx.sql.query(
      `UPDATE recording_sessions SET startAt = ?, endAt = ? WHERE sessionId = ?`,
      [await nowManila(-12), await nowManila(1), game.sessionId]
    );
    const jobs = await jobsFor(game.sessionId); // a box poll makes the parts due
    assert.deepEqual(
      jobs.map((job) => job.partIndex),
      [0, 1],
      "two full 5-minute pieces so far"
    );
    const stored = await row(game.sessionId);
    assert.equal(stored.status, "Recording");
    assert.ok(stored.endAt > (await nowManila(5 * 60)), "rolled ahead again");

    const config = await home.device("GET", "/device/config");
    assert.ok(
      config.data.sessions.some((s) => s.sessionId === game.sessionId),
      "the box keeps the game's footage"
    );

    const detail = await call("GET", `/admin/sessions/${game.sessionId}`);
    assert.equal(detail.data.session.partsTotal, 3, "only what has run so far (12 min)");
    assert.ok(
      detail.data.session.durationMinutes >= 11 && detail.data.session.durationMinutes <= 13
    );
  });

  it("can't be cancelled once recording, only ended", async () => {
    const cancel = await call("POST", `/admin/sessions/${game.sessionId}/cancel`);
    assert.equal(cancel.status, 409);
    assert.equal((await row(game.sessionId)).status, "Recording");
  });

  it("ends with End game on the device, and saves what was recorded", async () => {
    const ended = await device.app("POST", "/app/session/stop");
    assert.equal(ended.status, 200, JSON.stringify(ended.body));
    const stored = await row(game.sessionId);
    assert.equal(stored.status, "Processing");
    assert.ok(stored.endAt <= (await nowManila(0.1)), "the real end is now");
    const jobs = await jobsFor(game.sessionId);
    assert.ok(
      jobs.some((job) => job.partIndex === 2),
      "the last piece is cut to the end"
    );

    const page = await ctx.api("GET", `/public/sessions/${game.shareUrl.split("/").pop()}`);
    assert.ok(page.data.session.endAt, "a finished game shows its end");
    assert.ok(page.data.session.totalSeconds >= 12 * 60);
  });

  it("frees the court: a new game can start", async () => {
    const next = await newGame(home.courtId);
    assert.equal(next.status, 201, JSON.stringify(next.body));
    home.waitingId = next.data.sessionId;
  });

  it("lets staff cancel a game still waiting for a device", async () => {
    const res = await call("POST", `/admin/sessions/${home.waitingId}/cancel`);
    assert.equal(res.status, 200);
    assert.equal((await row(home.waitingId)).status, "Cancelled");
  });

  it("lets staff End a recording game from Admin", async () => {
    const created = await newGame(home.court2Id);
    await pair(created.data.sessionId);
    await new Promise((r) => setTimeout(r, 1100)); // a game keeps at least 1 s of footage
    const end = await call("POST", `/admin/sessions/${created.data.sessionId}/end`);
    assert.equal(end.status, 200, JSON.stringify(end.body));
    assert.equal((await row(created.data.sessionId)).status, "Processing");
  });

  it("can't End a game that never started, and 404s an unknown one", async () => {
    const created = await newGame(home.court2Id);
    assert.equal((await call("POST", `/admin/sessions/${created.data.sessionId}/end`)).status, 409);
    assert.equal((await row(created.data.sessionId)).status, "Waiting");
    assert.equal((await call("POST", `/admin/sessions/no-such-game/end`)).status, 404);
    assert.equal((await call("POST", `/admin/sessions/no-such-game/cancel`)).status, 404);
  });

  it("still books a time window for older clients", async () => {
    const [[court]] = await ctx.sql.query(`SELECT courtId FROM courts WHERE courtId = ?`, [
      home.courtId,
    ]);
    const booked = await call("POST", "/admin/sessions", {
      courtId: court.courtId,
      startAt: await nowManila(24 * 60),
      durationMinutes: 30,
    });
    assert.equal(booked.status, 201, JSON.stringify(booked.body));
    assert.equal((await row(booked.data.sessionId)).openEnded, 0);
    const half = await call("POST", "/admin/sessions", {
      courtId: court.courtId,
      startAt: await nowManila(48 * 60),
    });
    assert.equal(half.status, 400, "a start time needs a length");
  });
});
