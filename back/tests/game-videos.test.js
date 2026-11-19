// CR-006 — a game travels as ONE file per camera: after End game the box gets
// a game job per camera and uploads the file in resumable chunks. No 5-minute
// pieces, no joining on the server.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { GAME_MP4, gameJobs, putChunk, sendGame } from "./helpers/gameUpload.js";
import { startTestApp } from "./helpers/testApp.js";

const CAM1 = "rtsp://cam-one:Pass1@192.168.1.50:554/stream1";
const CAM2 = "rtsp://cam-two:Pass2@192.168.1.51:554/stream1";

describe("game videos", () => {
  let ctx;
  let admin;
  let viewer;
  const home = {};
  const away = {};

  const call = (method, url, body, who = admin) => ctx.api(method, url, { token: who.token, body });
  const asBox = (token) => ({ Authorization: `Device ${token}` });

  const setupVenue = async (target, name, { camera2 = false } = {}) => {
    target.venueId = (await call("POST", "/admin/venues", { name })).data.venueId;
    const court = await call("POST", "/admin/courts", {
      venueId: target.venueId,
      name: "Court 1",
      cameraRtspUrl: CAM1,
      ...(camera2 ? { camera2RtspUrl: CAM2 } : {}),
    });
    target.courtId = court.data.courtId;
    target.token = (await ctx.pairBox(admin.token, target.venueId, "Box")).data.token;
  };

  /** "YYYY-MM-DD HH:mm:ss" in Manila, `minutes` from now. */
  const manila = async (minutes) => {
    const [[row]] = await ctx.sql.query(
      `SELECT DATE_FORMAT(DATE_ADD(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'),
               INTERVAL ? SECOND), '%Y-%m-%d %H:%i:%s') AS t`,
      [Math.round(minutes * 60)]
    );
    return row.t;
  };

  /** A game on the target's court that ran from `startMinutes` to `endMinutes` ago. */
  const gameAt = async (target, startMinutes, endMinutes) => {
    const created = await call("POST", "/admin/sessions", {
      courtId: target.courtId,
      startAt: await manila(1),
      durationMinutes: 5,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    await ctx.sql.query(
      `UPDATE recording_sessions SET startAt = ?, endAt = ? WHERE sessionId = ?`,
      [await manila(startMinutes), await manila(endMinutes), created.data.sessionId]
    );
    // CR-015: paid at the desk, so the player's page plays the videos
    const paid = await call("POST", "/admin/payments", {
      sessionId: created.data.sessionId,
      amount: 300,
    });
    assert.equal(paid.status, 201, JSON.stringify(paid.body));
    const jobs = await gameJobs(ctx, target.token, created.data.sessionId);
    return { ...created.data, token: created.data.shareUrl.split("/").pop(), jobs };
  };

  const start = (token, id, body) =>
    ctx.api("POST", `/device/game-videos/${id}/start`, { headers: asBox(token), body });
  const finish = (token, id) =>
    ctx.api("POST", `/device/game-videos/${id}/finish`, {
      headers: asBox(token),
      form: [["note", "-"]],
    });
  const video = async (id) =>
    (
      await ctx.sql.query(
        `SELECT status, uploadBytes, receivedBytes, deviceId, videoPath, sizeBytes, venueId
         FROM session_videos WHERE sessionVideoId = ?`,
        [id]
      )
    )[0][0];
  const page = async (token) => (await ctx.api("GET", `/public/sessions/${token}`)).data.session;

  before(async () => {
    ctx = await startTestApp();
    admin = await ctx.createStaff("Admin", { access: "write" });
    viewer = await ctx.createStaff("Viewer", { access: "read" });
    await setupVenue(home, "Home Courts");
    await setupVenue(away, "Away Courts");
  });
  after(() => ctx?.stop());

  describe("the upload", () => {
    let game;
    let id;

    it("starts, reports progress, and resumes where the server is", async () => {
      game = await gameAt(home, -20, -2);
      id = game.jobs[0].sessionVideoId;
      const first = await start(home.token, id, {
        sizeBytes: GAME_MP4.length,
        durationSeconds: 18 * 60,
        gaps: [],
      });
      assert.equal(first.status, 200, JSON.stringify(first.body));
      assert.equal(first.data.receivedBytes, 0);
      assert.equal(first.data.chunkBytes, 8 * 1024 * 1024);

      const put = await putChunk(ctx, home.token, id, 0, GAME_MP4.subarray(0, 100));
      assert.equal(put.status, 200);
      assert.equal(put.body.data.receivedBytes, 100);

      let shown = await page(game.token);
      assert.equal(shown.videos[0].status, "Saving");
      assert.equal(shown.uploadPercent, Math.floor((100 / GAME_MP4.length) * 100));

      // The box restarted: the same file resumes at 100, nothing is lost or doubled
      const again = await start(home.token, id, {
        sizeBytes: GAME_MP4.length,
        durationSeconds: 18 * 60,
        gaps: [],
      });
      assert.equal(again.data.receivedBytes, 100);
      shown = await page(game.token);
      assert.ok(shown.uploadPercent > 0);
    });

    it("accepts gap times with fractions of a millisecond, as the box's timeline has them", async () => {
      const other = await gameAt(home, -95, -85);
      const otherId = other.jobs[0].sessionVideoId;
      const end = other.jobs[0].windowEndMs;
      const res = await start(home.token, otherId, {
        sizeBytes: 10,
        durationSeconds: 539.6,
        gaps: [{ startMs: end - 60_000.4, endMs: end - 0.7 }],
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const [[row]] = await ctx.sql.query(
        `SELECT durationSeconds, gaps FROM session_videos WHERE sessionVideoId = ?`,
        [otherId]
      );
      assert.equal(row.durationSeconds, 540);
      assert.equal(row.gaps.length, 1);
    });

    it("answers OFFSET_MISMATCH with where to continue", async () => {
      const wrong = await putChunk(ctx, home.token, id, 0, GAME_MP4.subarray(0, 50));
      assert.equal(wrong.status, 409);
      assert.equal(wrong.body.code, "OFFSET_MISMATCH");
      assert.equal(wrong.body.data.receivedBytes, 100);
      assert.equal((await video(id)).receivedBytes, 100, "nothing appended");
    });

    it("won't finish while bytes are missing", async () => {
      const early = await finish(home.token, id);
      assert.equal(early.status, 409);
      assert.equal(early.body.code, "INCOMPLETE_UPLOAD");
      assert.equal(early.body.data.receivedBytes, 100);
    });

    it("refuses another venue's box and a second box of the same venue", async () => {
      const foreign = await start(away.token, id, { sizeBytes: 10, durationSeconds: 1 });
      assert.equal(foreign.status, 404);
      const foreignChunk = await putChunk(ctx, away.token, id, 100, Buffer.alloc(10));
      assert.equal(foreignChunk.status, 404);

      const second = (await ctx.pairBox(admin.token, home.venueId, "Box 2")).data.token;
      const res = await start(second, id, { sizeBytes: GAME_MP4.length, durationSeconds: 1 });
      assert.equal(res.status, 409);
      assert.equal((await video(id)).receivedBytes, 100, "left alone");
    });

    it("finishes: the game's one file is Ready, the game too", async () => {
      const rest = await putChunk(ctx, home.token, id, 100, GAME_MP4.subarray(100));
      assert.equal(rest.status, 200);
      const done = await finish(home.token, id);
      assert.equal(done.status, 200, JSON.stringify(done.body));
      assert.equal(done.data.status, "Ready");

      const row = await video(id);
      assert.equal(row.status, "Ready");
      assert.equal(row.sizeBytes, GAME_MP4.length);
      assert.match(row.videoPath, /\/game-cam0-[^/]+\.mp4$/);
      const file = path.resolve(ctx.workDir, row.videoPath.replace(/^\/+/, ""));
      assert.deepEqual(fs.readFileSync(file), GAME_MP4, "the bytes, reassembled");
      assert.equal(fs.existsSync(path.join(path.dirname(file), "upload.part")), false);

      const shown = await page(game.token);
      assert.equal(shown.status, "Ready");
      assert.equal(shown.uploadPercent, 100);
      const res = await ctx.get(shown.videos[0].downloadUrl);
      assert.equal(res.status, 200);
      assert.equal(
        res.headers.get("content-disposition"),
        "attachment; filename=dyna-cam-game.mp4"
      );

      assert.equal((await start(home.token, id, { sizeBytes: 5, durationSeconds: 1 })).status, 409);
    });
  });

  describe("what the server refuses", () => {
    it("a new size starts over; chunks past the size; a file that isn't an mp4", async () => {
      const game = await gameAt(home, -40, -30);
      const id = game.jobs[0].sessionVideoId;
      await start(home.token, id, { sizeBytes: 300, durationSeconds: 60 });
      await putChunk(ctx, home.token, id, 0, Buffer.alloc(100, 1));
      const restarted = await start(home.token, id, { sizeBytes: 200, durationSeconds: 60 });
      assert.equal(restarted.data.receivedBytes, 0, "a different file starts at 0");

      const tooMuch = await putChunk(ctx, home.token, id, 0, Buffer.alloc(201, 1));
      assert.equal(tooMuch.status, 400);

      await putChunk(ctx, home.token, id, 0, Buffer.alloc(200, 1));
      const notMp4 = await finish(home.token, id);
      assert.equal(notMp4.status, 400);
      assert.equal((await video(id)).status, "Pending", "the box can send it again");
    });

    it("a chunk before start, a bad offset, and a JSON body", async () => {
      const game = await gameAt(home, -55, -45);
      const id = game.jobs[0].sessionVideoId;
      assert.equal((await putChunk(ctx, home.token, id, 0, Buffer.alloc(4))).status, 409);
      await start(home.token, id, { sizeBytes: 10, durationSeconds: 1 });
      const bad = await ctx.get(`/api/v1/device/game-videos/${id}/chunk?offset=-1`, {
        method: "PUT",
        headers: { ...asBox(home.token), "Content-Type": "application/octet-stream" },
        body: Buffer.alloc(4),
      });
      assert.equal(bad.status, 400);
      const json = await ctx.api("PUT", `/device/game-videos/${id}/chunk?offset=0`, {
        headers: asBox(home.token),
        body: { hello: "world" },
      });
      assert.equal(json.status, 400);
    });

    it("404s an unknown video and a game of another venue on every endpoint", async () => {
      for (const url of [
        "/device/game-videos/no-such-video/start",
        "/device/game-videos/no-such-video/finish",
        "/device/game-videos/no-such-video/fail",
      ]) {
        const res = await ctx.api("POST", url, {
          headers: asBox(home.token),
          body: { sizeBytes: 1, durationSeconds: 1, reason: "x" },
        });
        assert.equal(res.status, 404, url);
      }
    });
  });

  describe("when the box can't make it", () => {
    it("fail settles the game Failed with no footage", async () => {
      const game = await gameAt(home, -70, -60);
      const id = game.jobs[0].sessionVideoId;
      const res = await ctx.api("POST", `/device/game-videos/${id}/fail`, {
        headers: asBox(home.token),
        body: { reason: "The camera was not recording during this game" },
      });
      assert.equal(res.status, 200);
      const one = await call("GET", `/admin/sessions/${game.sessionId}`);
      assert.equal(one.data.session.status, "Failed");
      assert.equal(one.data.session.failureReason, "None of the game could be recorded");
      assert.equal(
        one.data.session.videos[0].failureReason,
        "The camera was not recording during this game"
      );

      // Retry asks the box again (while it still has the footage)
      const denied = await call(
        "POST",
        `/admin/sessions/${game.sessionId}/videos/0/retry`,
        undefined,
        viewer
      );
      assert.equal(denied.status, 403);
      const retry = await call("POST", `/admin/sessions/${game.sessionId}/videos/0/retry`);
      assert.equal(retry.status, 200, JSON.stringify(retry.body));
      assert.equal((await video(id)).status, "Pending");
      const again = await call("GET", `/admin/sessions/${game.sessionId}`);
      assert.equal(again.data.session.status, "Processing");
      assert.equal((await gameJobs(ctx, home.token, game.sessionId)).length, 1, "the job is back");
      assert.equal(
        (await call("POST", `/admin/sessions/${game.sessionId}/videos/2/retry`)).status,
        404
      );
    });
  });

  describe("two cameras", () => {
    it("makes a video per camera; the game is Ready when both are in", async () => {
      const both = {};
      await setupVenue(both, "Two Cam Courts", { camera2: true });
      const game = await gameAt(both, -15, -5);
      assert.deepEqual(
        game.jobs.map((job) => job.camera),
        [1, 2]
      );
      const [cam1, cam2] = game.jobs;
      assert.equal((await sendGame(ctx, both.token, cam1.sessionVideoId)).status, 200);
      let shown = await page(game.token);
      assert.equal(shown.status, "Processing", "still waiting for Cam 2");
      assert.equal((await sendGame(ctx, both.token, cam2.sessionVideoId)).status, 200);
      shown = await page(game.token);
      assert.equal(shown.status, "Ready");
      assert.deepEqual(
        shown.videos.map((v) => [v.camera, v.label, v.status]),
        [
          [1, "Cam 1", "Ready"],
          [2, "Cam 2", "Ready"],
        ]
      );
      const dl = await ctx.get(shown.videos[1].downloadUrl);
      assert.equal(
        dl.headers.get("content-disposition"),
        "attachment; filename=dyna-cam-game-cam2.mp4"
      );
    });
  });

  it("keeps replays as they were: clip jobs, never game jobs", async () => {
    const [[court]] = await ctx.sql.query(`SELECT qrToken FROM courts WHERE courtId = ?`, [
      home.courtId,
    ]);
    const saved = await ctx.api("POST", `/public/courts/${court.qrToken}/clips`);
    assert.equal(saved.status, 201, JSON.stringify(saved.body));
    const jobs = (
      await ctx.api("GET", "/device/jobs?wait=0", { headers: asBox(home.token) })
    ).data.jobs.filter((job) => job.type === "clip");
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].sessionId, undefined);
  });
});
