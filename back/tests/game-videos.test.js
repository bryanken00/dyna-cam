// CR-006 — a game travels as ONE file per camera: after End game the box gets
// a game job per camera. CR-040 Phase 4: the box keeps the file and sends it
// straight to the court's Google Drive; the old upload to the API is gone.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { GAME_MP4, gameJobs, keepGame } from "./helpers/gameUpload.js";
import { startTestApp } from "./helpers/testApp.js";
import { insertLegacyClip } from "./helpers/legacyClip.js";

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
    // CR-039: New game is always free; this test is about an unpaid game (one made before)
    await ctx.makeUnpaid(created.data.sessionId);
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

  const video = async (id) =>
    (
      await ctx.sql.query(
        `SELECT status, delivery, driveStatus, uploadBytes, receivedBytes, deviceId, videoPath,
                sizeBytes, venueId
         FROM session_videos WHERE sessionVideoId = ?`,
        [id]
      )
    )[0][0];
  /** GET /jobs as the box sees it, without marking it "drive-direct". */
  const rawJobs = async (token) =>
    (await ctx.api("GET", "/device/jobs?wait=0", { headers: asBox(token) })).data.jobs;
  const page = async (token) => (await ctx.api("GET", `/public/sessions/${token}`)).data.session;

  before(async () => {
    ctx = await startTestApp();
    admin = await ctx.createStaff("Admin", { access: "write" });
    viewer = await ctx.createStaff("Viewer", { access: "read" });
    await setupVenue(home, "Home Courts");
    await setupVenue(away, "Away Courts");
  });
  after(() => ctx?.stop());

  describe("the box keeps the file (CR-040)", () => {
    let game;
    let id;

    it("is Ready and kept on the box on a court without Google Drive; no file links", async () => {
      game = await gameAt(home, -20, -2);
      id = game.jobs[0].sessionVideoId;
      assert.equal(game.jobs[0].delivery, "drive");
      const kept = await keepGame(ctx, home.token, id, { durationSeconds: 18 * 60 });
      assert.equal(kept.status, 200, JSON.stringify(kept.body));
      assert.equal(kept.data.drive, false);
      assert.equal(kept.data.reason, "NO_DRIVE");

      const row = await video(id);
      assert.equal(row.status, "Ready");
      assert.equal(row.delivery, "Drive");
      assert.equal(row.driveStatus, "Skipped");
      assert.equal(row.videoPath, null, "never on the API's disk");
      assert.equal(row.sizeBytes, GAME_MP4.length);

      const shown = await page(game.token);
      assert.equal(shown.status, "Ready");
      assert.equal(shown.uploadPercent, 100);
      assert.equal(shown.videos[0].status, "Ready");
      assert.equal(shown.videos[0].driveState, "NotShared");
      assert.equal(shown.videos[0].driveUrl, null);
      for (const key of ["videoUrl", "downloadUrl", "thumbnailUrl"]) {
        assert.equal(key in shown.videos[0], false, key);
      }
      assert.equal("parts" in shown, false);
    });

    it("accepts gap times with fractions of a millisecond, as the box's timeline has them", async () => {
      const other = await gameAt(home, -95, -85);
      const otherId = other.jobs[0].sessionVideoId;
      const end = other.jobs[0].windowEndMs;
      const res = await keepGame(ctx, home.token, otherId, {
        bytes: Buffer.alloc(10),
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

    it("refuses another venue's box and a second box of the same venue", async () => {
      const other = await gameAt(home, -110, -100);
      const otherId = other.jobs[0].sessionVideoId;
      const foreign = await keepGame(ctx, away.token, otherId);
      assert.equal(foreign.status, 404);
      // The home box has it (its progress is being sent)
      await ctx.sql.query(
        `UPDATE session_videos SET status = 'Uploading', deviceId =
           (SELECT deviceId FROM devices WHERE venueId = ? ORDER BY id ASC LIMIT 1)
         WHERE sessionVideoId = ?`,
        [home.venueId, otherId]
      );
      const second = (await ctx.pairBox(admin.token, home.venueId, "Box 2")).data.token;
      const res = await keepGame(ctx, second, otherId);
      assert.equal(res.status, 409);
      assert.equal((await video(otherId)).status, "Uploading", "left alone");
    });

    it("the old upload to the API answers 410 BOX_UPDATE_REQUIRED and changes nothing", async () => {
      const other = await gameAt(home, -125, -115);
      const otherId = other.jobs[0].sessionVideoId;
      const before = await video(otherId);
      const startRes = await ctx.api("POST", `/device/game-videos/${otherId}/start`, {
        headers: asBox(home.token),
        body: { sizeBytes: GAME_MP4.length, durationSeconds: 60, gaps: [] },
      });
      assert.equal(startRes.status, 410);
      assert.equal(startRes.body.code, "BOX_UPDATE_REQUIRED");
      const chunk = await ctx.get(`/api/v1/device/game-videos/${otherId}/chunk?offset=0`, {
        method: "PUT",
        headers: { ...asBox(home.token), "Content-Type": "application/octet-stream" },
        body: GAME_MP4,
      });
      assert.equal(chunk.status, 410);
      const finish = await ctx.api("POST", `/device/game-videos/${otherId}/finish`, {
        headers: asBox(home.token),
        form: [["note", "-"]],
      });
      assert.equal(finish.status, 410);
      assert.deepEqual(await video(otherId), before);
    });
  });

  describe("which box gets game jobs", () => {
    it("a box that doesn't send to Google Drive gets none until it does", async () => {
      const box = {};
      await setupVenue(box, "Old Box Courts");
      const created = await call("POST", "/admin/sessions", {
        courtId: box.courtId,
        startAt: await manila(1),
        durationMinutes: 5,
      });
      await ctx.sql.query(
        `UPDATE recording_sessions SET startAt = ?, endAt = ? WHERE sessionId = ?`,
        [await manila(-20), await manila(-2), created.data.sessionId]
      );
      const old = await ctx.api("POST", "/device/heartbeat", {
        headers: asBox(box.token),
        body: { cameras: [], capabilities: ["game-file"] },
      });
      assert.equal(old.status, 200);
      assert.deepEqual(await rawJobs(box.token), [], "an old box gets nothing to upload");
      const jobs = await gameJobs(ctx, box.token, created.data.sessionId);
      assert.equal(jobs.length, 1, "once it reports drive-direct");
      assert.equal(jobs[0].delivery, "drive");
    });

    it("hands out no clip jobs, even for a replay saved before CR-027", async () => {
      await insertLegacyClip(ctx.sql, { courtId: home.courtId });
      const jobs = await gameJobs(ctx, home.token);
      assert.ok(jobs.every((job) => job.type === "game"));
      const all = await rawJobs(home.token);
      assert.equal(all.filter((job) => job.type === "clip").length, 0, "no clip jobs at all");
    });

    it("404s an unknown video on every endpoint", async () => {
      for (const action of ["drive-session", "progress", "drive-done", "fail", "box-deleted"]) {
        const res = await ctx.api("POST", `/device/game-videos/no-such-video/${action}`, {
          headers: asBox(home.token),
          body: {
            sizeBytes: 1,
            durationSeconds: 1,
            uploadedBytes: 1,
            driveFileId: "abc",
            reason: "x",
          },
        });
        assert.equal(res.status, 404, action);
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
      assert.equal((await keepGame(ctx, both.token, cam1.sessionVideoId)).status, 200);
      let shown = await page(game.token);
      assert.equal(shown.status, "Processing", "still waiting for Cam 2");
      assert.equal((await keepGame(ctx, both.token, cam2.sessionVideoId)).status, 200);
      shown = await page(game.token);
      assert.equal(shown.status, "Ready");
      assert.deepEqual(
        shown.videos.map((v) => [v.camera, v.label, v.status]),
        [
          [1, "Cam 1", "Ready"],
          [2, "Cam 2", "Ready"],
        ]
      );
    });
  });
});
