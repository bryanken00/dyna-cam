// CR-025 — the player's game page (the game's share link) gets the court
// device's live view and "Save the last …" while the game records: the same
// signed LAN live link as GET /app/session, and a save with the same rules as
// the device's (after the first minute, the game's limit, double tap = same
// save). End game stays off the page. An unpaid game gets both; its videos
// stay locked.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

const LIVE_KEY = "cd".repeat(32);
const BOX_URL = "http://192.168.1.60:8090";

describe("live view and saves on the game page (CR-025)", () => {
  let ctx;
  let admin;
  const home = {};

  const call = (method, url, body) => ctx.api(method, url, { token: admin.token, body });
  const asDevice = (token) => (method, url, options = {}) =>
    ctx.api(method, url, { ...options, headers: { Authorization: `Device ${token}` } });

  const tokenOf = (game) => game.shareUrl.split("/").pop();
  const page = (game) => ctx.api("GET", `/public/sessions/${tokenOf(game)}`);
  const save = (game, seconds) =>
    ctx.api("POST", `/public/sessions/${tokenOf(game)}/captures`, { body: { seconds } });

  /** A game that records at once (CR-016), with no device paired. */
  const newGame = async (courtId) => {
    const res = await call("POST", "/admin/sessions", {
      courtId,
      startNow: true,
      durationMinutes: 60,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(res.data.shareUrl);
    // CR-039: New game is always free; this test is about an unpaid game (one made before)
    res.data.payCode = await ctx.makeUnpaid(res.data.sessionId);
    return res.data;
  };

  /** Manila time two hours from now, as New game takes it. */
  const inTwoHours = async () => {
    const [[row]] = await ctx.sql.query(
      `SELECT DATE_FORMAT(DATE_ADD(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'),
               INTERVAL 2 HOUR), '%Y-%m-%d %H:%i:%s') AS t`
    );
    return row.t;
  };

  /** Pretend the game started `minutes` ago (the API can't wait). */
  const playedFor = (sessionId, minutes) =>
    ctx.sql.query(
      `UPDATE recording_sessions SET startAt = DATE_SUB(startAt, INTERVAL ? SECOND)
       WHERE sessionId = ?`,
      [Math.round(minutes * 60), sessionId]
    );

  before(async () => {
    ctx = await startTestApp({ env: { RATE_LIMIT_PUBLIC_CAPTURE_POINTS: "1000" } });
    admin = await ctx.createStaff("Admin", { access: "write" });
    home.venueId = (await call("POST", "/admin/venues", { name: "Live Page Courts" })).data.venueId;
    home.court1 = (
      await call("POST", "/admin/courts", {
        venueId: home.venueId,
        name: "Court 1",
        cameraRtspUrl: "rtsp://u:p@10.0.2.1:554/stream1",
      })
    ).data.courtId;
    home.court2 = (
      await call("POST", "/admin/courts", {
        venueId: home.venueId,
        name: "Court 2",
        cameraRtspUrl: "rtsp://u:p@10.0.2.2:554/stream1",
        camera2RtspUrl: "rtsp://u:p@10.0.2.3:554/stream1",
      })
    ).data.courtId;
    const box = asDevice((await ctx.pairBox(admin.token, home.venueId, "Box")).data.token);
    const beat = await box("POST", "/device/heartbeat", {
      body: { cameras: [], live: { url: BOX_URL, key: LIVE_KEY } },
    });
    assert.equal(beat.status, 200, JSON.stringify(beat.body));
  });
  after(() => ctx?.stop());

  let game;

  it("shows a recording game's live link and save limits", async () => {
    game = await newGame(home.court1);
    const res = await page(game);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const url = new URL(res.data.live.hlsUrl);
    assert.equal(url.origin, BOX_URL);
    assert.match(url.pathname, /^\/live\/[^/]+\/index\.m3u8$/);
    assert.ok(url.searchParams.get("exp") && url.searchParams.get("sig"), "signed and expiring");
    assert.ok(res.data.live.expiresAt);
    assert.equal(res.data.live.cameras, undefined, "one camera, no switch");

    assert.deepEqual(
      { ...res.data.capture, playedSeconds: undefined },
      { minSeconds: 60, available: true, maxPerGame: 5, used: 0, playedSeconds: undefined }
    );
    assert.ok(res.data.capture.playedSeconds <= 5);
  });

  it("gives a two-camera court a link per camera", async () => {
    const two = await newGame(home.court2);
    const { live } = (await page(two)).data;
    assert.equal(live.cameras.length, 2);
    assert.match(new URL(live.cameras[1].hlsUrl).pathname, /\/cam2\/index\.m3u8$/);
  });

  it("refuses a save before the first minute, and one shorter than a minute", async () => {
    const early = await save(game, 120);
    assert.equal(early.status, 409);
    assert.equal(early.body.code, "TOO_EARLY");

    const short = await save(game, 10);
    assert.equal(short.status, 400);
  });

  it("10 minutes in, saves the last 2 minutes — no IDs back, no device on the save", async () => {
    await playedFor(game.sessionId, 10);
    const saved = await save(game, 120);
    assert.equal(saved.status, 201, JSON.stringify(saved.body));
    assert.deepEqual(saved.data, { repeated: false });

    const res = await page(game);
    assert.equal(res.data.session.captures.length, 1);
    assert.equal(res.data.session.captures[0].number, 1);
    assert.equal(res.data.capture.used, 1);
    assert.ok(Math.abs(res.data.capture.playedSeconds - 600) <= 5);

    const [[row]] = await ctx.sql.query(
      `SELECT pairedAppId, seconds FROM session_captures WHERE sessionId = ?`,
      [game.sessionId]
    );
    assert.equal(row.pairedAppId, null);
    assert.equal(row.seconds, 120);
  });

  it("answers a double tap with the same save", async () => {
    const again = await save(game, 120);
    assert.equal(again.status, 200);
    assert.deepEqual(again.data, { repeated: true });
    assert.equal((await page(game)).data.capture.used, 1);
  });

  it("stops at the game's save limit", async () => {
    await ctx.sql.query(`UPDATE recording_sessions SET maxCaptures = 1 WHERE sessionId = ?`, [
      game.sessionId,
    ]);
    const full = await save(game, 300);
    assert.equal(full.status, 409);
    assert.equal(full.body.code, "TOO_MANY");
  });

  it("works on an unpaid game, whose videos stay locked", async () => {
    const res = await page(game);
    assert.equal(res.data.session.locked, true, "new games are unpaid");
    assert.ok(res.data.live.hlsUrl);
    assert.equal(res.data.capture.available, true);
  });

  it("drops the live link and refuses saves once the game ends", async () => {
    const ended = await call("POST", `/admin/sessions/${game.sessionId}/end`);
    assert.equal(ended.status, 200, JSON.stringify(ended.body));

    const res = await page(game);
    assert.equal(res.data.live, null);
    assert.equal(res.data.capture.available, false);
    assert.equal(res.data.capture.playedSeconds, 0);

    const late = await save(game, 120);
    assert.equal(late.status, 409);
    assert.equal(late.body.code, "NOT_RECORDING");
  });

  it("404s an unknown or cancelled game's link, 400s a malformed one", async () => {
    const unknown = await ctx.api("POST", `/public/sessions/${"x".repeat(32)}/captures`, {
      body: { seconds: 120 },
    });
    assert.equal(unknown.status, 404);

    const scheduled = await call("POST", "/admin/sessions", {
      courtId: home.court1,
      startAt: (await inTwoHours()).slice(0, 16),
      durationMinutes: 60,
    });
    assert.equal(scheduled.status, 201, JSON.stringify(scheduled.body));
    const cancel = await call("POST", `/admin/sessions/${scheduled.data.sessionId}/cancel`);
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
    assert.equal((await save(scheduled.data, 120)).status, 404);
    assert.equal((await page(scheduled.data)).status, 404);

    const malformed = await ctx.api("POST", "/public/sessions/not a token/captures", {
      body: { seconds: 120 },
    });
    assert.equal(malformed.status, 400);
  });

  it("has no End game for the page", async () => {
    const stop = await ctx.api("POST", `/public/sessions/${tokenOf(game)}/stop`);
    assert.equal(stop.status, 404);
  });
});
