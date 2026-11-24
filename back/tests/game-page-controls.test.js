// CR-028 — the courtside device's controls on the game's page: End game,
// delete a save (by its number + savedAt, no IDs), and the player's own
// stream (a setup link, Stop streaming). The share link is the credential.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

describe("device controls on the game page (CR-028)", () => {
  let ctx;
  let admin;
  const home = {};
  let courtNo = 0;

  const call = (method, url, body) => ctx.api(method, url, { token: admin.token, body });

  /** A free game recording now on a fresh court; returns its share token. */
  const newGame = async () => {
    courtNo += 1;
    const court = await call("POST", "/admin/courts", {
      venueId: home.venueId,
      name: `Court ${courtNo}`,
      cameraRtspUrl: `rtsp://u:p@10.0.4.${courtNo}:554/stream1`,
    });
    assert.equal(court.status, 201, JSON.stringify(court.body));
    const res = await call("POST", "/admin/sessions", {
      courtId: court.data.courtId,
      startNow: true,
      durationMinutes: 60,
      maxCaptures: 5,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    // A free game with 5 saves, as a booked game is (CR-034: the court QR no
    // longer starts games, so it comes from Admin's New game)
    const token = res.data.shareUrl.split("/").pop();
    await ctx.sql.query(
      `UPDATE recording_sessions SET paymentStatus = 'Free', payCode = NULL WHERE shareToken = ?`,
      [token]
    );
    return token;
  };

  const page = (token) => ctx.api("GET", `/public/sessions/${token}`);
  const row = async (token) =>
    (
      await ctx.sql.query(
        `SELECT sessionId, status, streamUrl FROM recording_sessions WHERE shareToken = ?`,
        [token]
      )
    )[0][0];

  /** Pretend the game started `minutes` ago (the API can't wait). */
  const playedFor = (token, minutes) =>
    ctx.sql.query(
      `UPDATE recording_sessions SET startAt = DATE_SUB(startAt, INTERVAL ? SECOND)
       WHERE shareToken = ?`,
      [Math.round(minutes * 60), token]
    );

  const save = (token, seconds = 60) =>
    ctx.api("POST", `/public/sessions/${token}/captures`, { body: { seconds } });

  before(async () => {
    ctx = await startTestApp({
      env: {
        RATE_LIMIT_PUBLIC_CAPTURE_POINTS: "1000",
        RATE_LIMIT_PUBLIC_CONTROL_POINTS: "1000",
      },
    });
    admin = await ctx.createStaff("Admin", { access: "write" });
    home.venueId = (await call("POST", "/admin/venues", { name: "Control Courts" })).data.venueId;
    const box = (await ctx.pairBox(admin.token, home.venueId, "Box")).data.token;
    const beat = await ctx.api("POST", "/device/heartbeat", {
      body: { cameras: [] },
      headers: { Authorization: `Device ${box}` },
    });
    assert.equal(beat.status, 200);
  });
  after(() => ctx?.stop());

  describe("End game", () => {
    it("stops recording, and the page shows it being saved", async () => {
      const token = await newGame();
      await playedFor(token, 3);
      const ended = await ctx.api("POST", `/public/sessions/${token}/end`);
      assert.equal(ended.status, 200, JSON.stringify(ended.body));
      assert.notEqual((await row(token)).status, "Recording");

      const after = await page(token);
      assert.notEqual(after.data.session.status, "Recording");
      assert.equal(after.data.capture.available, false);
      assert.equal(after.data.canStream, false);

      // Once ended, again is refused
      assert.equal((await ctx.api("POST", `/public/sessions/${token}/end`)).status, 409);
    });

    it("is 404 for an unknown or cancelled game's link", async () => {
      assert.equal(
        (await ctx.api("POST", `/public/sessions/${"x".repeat(32)}/end`)).status,
        404
      );
      const token = await newGame();
      await ctx.sql.query(`UPDATE recording_sessions SET status = 'Cancelled' WHERE shareToken = ?`, [
        token,
      ]);
      assert.equal((await ctx.api("POST", `/public/sessions/${token}/end`)).status, 404);
      assert.equal((await row(token)).status, "Cancelled");
    });
  });

  describe("delete a save", () => {
    it("deletes Save N by its number and savedAt, freeing a slot", async () => {
      const token = await newGame();
      await playedFor(token, 5);
      assert.equal((await save(token, 60)).status, 201);
      await playedFor(token, 1); // a new save, not a double tap
      assert.equal((await save(token, 120)).status, 201);

      let game = await page(token);
      assert.equal(game.data.session.captures.length, 2);
      assert.equal(game.data.capture.used, 2);
      const [first, second] = game.data.session.captures;
      assert.equal(first.captureId, undefined, "no IDs on the page");

      const removed = await ctx.api(
        "DELETE",
        `/public/sessions/${token}/captures/1?savedAt=${encodeURIComponent(first.savedAt)}`
      );
      assert.equal(removed.status, 200, JSON.stringify(removed.body));

      game = await page(token);
      assert.equal(game.data.session.captures.length, 1);
      assert.equal(game.data.capture.used, 1);
      assert.equal(game.data.session.captures[0].savedAt, second.savedAt);
    });

    it("deletes nothing when the number moved (savedAt doesn't match)", async () => {
      const token = await newGame();
      await playedFor(token, 5);
      assert.equal((await save(token, 60)).status, 201);
      const [only] = (await page(token)).data.session.captures;

      const wrong = await ctx.api(
        "DELETE",
        `/public/sessions/${token}/captures/1?savedAt=${encodeURIComponent("2020-01-01 00:00:00")}`
      );
      assert.equal(wrong.status, 404);
      const missing = await ctx.api(
        "DELETE",
        `/public/sessions/${token}/captures/2?savedAt=${encodeURIComponent(only.savedAt)}`
      );
      assert.equal(missing.status, 404);
      assert.equal((await page(token)).data.session.captures.length, 1);

      // Another game's link can't reach it
      const other = await newGame();
      const cross = await ctx.api(
        "DELETE",
        `/public/sessions/${other}/captures/1?savedAt=${encodeURIComponent(only.savedAt)}`
      );
      assert.equal(cross.status, 404);
      assert.equal((await page(token)).data.session.captures.length, 1);
    });

    it("needs savedAt", async () => {
      const token = await newGame();
      assert.equal((await ctx.api("DELETE", `/public/sessions/${token}/captures/1`)).status, 400);
    });
  });

  describe("the player's own stream", () => {
    it("gives a setup link while the game runs, and stops a stream", async () => {
      const token = await newGame();
      let game = await page(token);
      assert.equal(game.data.canStream, true);
      assert.equal(game.data.stream, null);

      const link = await ctx.api("POST", `/public/sessions/${token}/stream-link`);
      assert.equal(link.status, 201, JSON.stringify(link.body));
      const code = link.data.url.split("/").pop();
      assert.match(link.data.url, /\/stream\//);

      // The stream page takes a key with that code
      const saved = await ctx.api("PUT", `/public/stream-setup/${code}`, {
        body: { platform: "YOUTUBE", streamKey: "abcd-efgh-ijkl-mnop" },
      });
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      game = await page(token);
      assert.equal(game.data.stream.platform, "YOUTUBE");
      assert.ok(!JSON.stringify(game.data.stream).includes("abcd-efgh-ijkl-mnop"), "key never sent");

      const stopped = await ctx.api("POST", `/public/sessions/${token}/stream/stop`);
      assert.equal(stopped.status, 200);
      assert.equal((await row(token)).streamUrl, null);
      assert.equal((await page(token)).data.stream, null);
    });

    it("refuses a setup link once the game has ended", async () => {
      const token = await newGame();
      await playedFor(token, 2);
      assert.equal((await ctx.api("POST", `/public/sessions/${token}/end`)).status, 200);
      assert.equal((await ctx.api("POST", `/public/sessions/${token}/stream-link`)).status, 409);
    });
  });
});
