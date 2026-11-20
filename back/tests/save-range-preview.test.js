// CR-029 — a save can be any stretch of the game so far (fromSeconds →
// toSeconds), and the page can preview a stretch first: a replay link signed
// by the API for that stretch only (HMAC(liveKey, `replay.court.from.to.exp`)),
// served by the venue's recorder box.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

const LIVE_KEY = "ef".repeat(32);
const BOX_URL = "http://192.168.1.70:8090";

describe("save a picked stretch, and preview it (CR-029)", () => {
  let ctx;
  let admin;
  const home = {};
  let courtNo = 0;

  const call = (method, url, body) => ctx.api(method, url, { token: admin.token, body });
  const asBox = { Authorization: "" };

  /** A player-started game on a fresh court → { token, courtId }. */
  const newGame = async (venueId = home.venueId) => {
    courtNo += 1;
    const court = await call("POST", "/admin/courts", {
      venueId,
      name: `Court ${courtNo}`,
      cameraRtspUrl: `rtsp://u:p@10.0.5.${courtNo}:554/stream1`,
    });
    assert.equal(court.status, 201, JSON.stringify(court.body));
    const res = await ctx.api("POST", `/public/courts/${court.data.qrToken}/games`, {
      body: { durationMinutes: 60 },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return { token: res.data.shareToken, courtId: court.data.courtId };
  };

  /** Pretend the game started `minutes` ago. */
  const playedFor = (token, minutes) =>
    ctx.sql.query(
      `UPDATE recording_sessions SET startAt = DATE_SUB(startAt, INTERVAL ? SECOND)
       WHERE shareToken = ?`,
      [Math.round(minutes * 60), token]
    );

  const save = (token, body) =>
    ctx.api("POST", `/public/sessions/${token}/captures`, { body });

  const gameRow = async (token) =>
    (
      await ctx.sql.query(
        `SELECT sessionId, startAt, UNIX_TIMESTAMP(startAt) AS startEpoch
         FROM recording_sessions WHERE shareToken = ?`,
        [token]
      )
    )[0][0];

  const saves = async (token) =>
    (
      await ctx.sql.query(
        `SELECT TIMESTAMPDIFF(SECOND, s.startAt, sc.startAt) AS fromS,
                TIMESTAMPDIFF(SECOND, s.startAt, sc.endAt) AS toS, sc.seconds
         FROM session_captures sc JOIN recording_sessions s ON s.sessionId = sc.sessionId
         WHERE s.shareToken = ? AND sc.status = 'Active'
         ORDER BY sc.dateCreated, sc.id`,
        [token]
      )
    )[0];

  before(async () => {
    ctx = await startTestApp({
      env: {
        RATE_LIMIT_PUBLIC_START_POINTS: "1000",
        RATE_LIMIT_PUBLIC_CAPTURE_POINTS: "1000",
        RATE_LIMIT_PUBLIC_CONTROL_POINTS: "1000",
      },
    });
    admin = await ctx.createStaff("Admin", { access: "write" });
    home.venueId = (await call("POST", "/admin/venues", { name: "Range Courts" })).data.venueId;
    const box = (await ctx.pairBox(admin.token, home.venueId, "Box")).data.token;
    asBox.Authorization = `Device ${box}`;
    const beat = await ctx.api("POST", "/device/heartbeat", {
      body: { cameras: [], live: { url: BOX_URL, key: LIVE_KEY } },
      headers: asBox,
    });
    assert.equal(beat.status, 200, JSON.stringify(beat.body));
  });
  after(() => ctx?.stop());

  describe("a picked stretch", () => {
    it("saves exactly fromSeconds → toSeconds of the game", async () => {
      const { token } = await newGame();
      await playedFor(token, 5);
      const res = await save(token, { fromSeconds: 60, toSeconds: 180 });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const [row] = await saves(token);
      assert.equal(Number(row.fromS), 60);
      assert.equal(Number(row.toS), 180);
      assert.equal(Number(row.seconds), 120);

      const page = await ctx.api("GET", `/public/sessions/${token}`);
      const [shown] = page.data.session.captures;
      assert.equal(shown.fromSeconds, 60);
      assert.equal(shown.toSeconds, 180);
    });

    it("pulls an end past now back to now", async () => {
      const { token } = await newGame();
      await playedFor(token, 3);
      assert.equal((await save(token, { fromSeconds: 100, toSeconds: 900 })).status, 201);
      const [row] = await saves(token);
      assert.equal(Number(row.fromS), 100);
      assert.ok(Math.abs(Number(row.toS) - 180) <= 2, `ends at now, got ${row.toS}`);
    });

    it("refuses under a minute, or a stretch not yet played", async () => {
      const { token } = await newGame();
      await playedFor(token, 5);
      const short = await save(token, { fromSeconds: 60, toSeconds: 100 });
      assert.equal(short.status, 400);
      const ahead = await save(token, { fromSeconds: 290, toSeconds: 600 });
      assert.equal(ahead.status, 400);
      assert.equal(ahead.body.code, "BAD_RANGE");
      assert.equal((await save(token, { fromSeconds: 60 })).status, 400, "needs both ends");
      assert.equal((await saves(token)).length, 0);
    });

    it("treats a double tap of the same stretch as one save, a different one as another", async () => {
      const { token } = await newGame();
      await playedFor(token, 5);
      assert.equal((await save(token, { fromSeconds: 60, toSeconds: 180 })).status, 201);
      const again = await save(token, { fromSeconds: 60, toSeconds: 180 });
      assert.equal(again.status, 200);
      assert.equal(again.data.repeated, true);
      // Same length, another start: its own save
      assert.equal((await save(token, { fromSeconds: 120, toSeconds: 240 })).status, 201);
      assert.equal((await saves(token)).length, 2);
    });

    it("still saves the last N seconds", async () => {
      const { token } = await newGame();
      await playedFor(token, 5);
      assert.equal((await save(token, { seconds: 120 })).status, 201);
      const [row] = await saves(token);
      assert.ok(Math.abs(Number(row.toS) - 300) <= 2);
      assert.ok(Math.abs(Number(row.toS) - Number(row.fromS) - 120) <= 1);
    });
  });

  describe("preview", () => {
    it("signs a replay link for exactly that stretch of the game", async () => {
      const { token, courtId } = await newGame();
      await playedFor(token, 5);
      const res = await ctx.api("GET", `/public/sessions/${token}/preview?from=60&to=180`);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const { preview } = res.data;
      assert.equal(preview.fromSeconds, 60);
      assert.equal(preview.toSeconds, 180);

      const url = new URL(preview.hlsUrl);
      assert.equal(url.origin, BOX_URL);
      assert.equal(url.pathname, `/live/${courtId}/replay.m3u8`);
      const { startEpoch } = await gameRow(token);
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const exp = url.searchParams.get("exp");
      assert.equal(Number(from), Number(startEpoch) + 60);
      assert.equal(Number(to), Number(startEpoch) + 180);
      const expected = crypto
        .createHmac("sha256", LIVE_KEY)
        .update(`replay.${courtId}.${from}.${to}.${exp}`)
        .digest("hex");
      assert.equal(url.searchParams.get("sig"), expected);
    });

    it("keeps the stretch inside the game played so far", async () => {
      const { token } = await newGame();
      await playedFor(token, 2);
      const res = await ctx.api("GET", `/public/sessions/${token}/preview?from=60&to=9999`);
      assert.equal(res.status, 200);
      assert.ok(Math.abs(res.data.preview.toSeconds - 120) <= 2);
      assert.equal(
        (await ctx.api("GET", `/public/sessions/${token}/preview?from=500&to=600`)).status,
        400
      );
      assert.equal(
        (await ctx.api("GET", `/public/sessions/${token}/preview?from=60&to=60`)).status,
        400
      );
    });

    it("is 503 when no recorder box can serve it, 404 for an unknown link", async () => {
      const venueId = (await call("POST", "/admin/venues", { name: "Quiet Courts" })).data.venueId;
      const box = (await ctx.pairBox(admin.token, venueId, "Box 2")).data.token;
      // Online, but without a live view
      await ctx.api("POST", "/device/heartbeat", {
        body: { cameras: [] },
        headers: { Authorization: `Device ${box}` },
      });
      const { token } = await newGame(venueId);
      await playedFor(token, 2);
      assert.equal(
        (await ctx.api("GET", `/public/sessions/${token}/preview?from=0&to=60`)).status,
        503
      );
      assert.equal(
        (await ctx.api("GET", `/public/sessions/${"y".repeat(32)}/preview?from=0&to=60`)).status,
        404
      );
    });
  });
});
