// CR-003 — a recorded game reaches the player as ONE whole video per camera.
// The box still uploads 5-minute parts; once every part is in, the API joins
// them (ffmpeg, stream copy) and deletes the part files. Two-camera courts get
// a set of parts per camera — only from boxes that say they can cut per camera.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { hasFfmpeg, makeMp4, probeSeconds } from "./helpers/media.js";
import { JPEG, startTestApp } from "./helpers/testApp.js";

const FFMPEG = hasFfmpeg();
const CAM1 = "rtsp://cam-one:Pass1@192.168.1.50:554/stream1";
const CAM2 = "rtsp://cam-two:Pass2@192.168.1.51:554/stream1";

describe("whole-game videos", { skip: FFMPEG ? false : "ffmpeg is not installed" }, () => {
  let ctx;
  let admin;
  let viewer;
  let runSessionJoins;
  let runClipMaintenance;
  let resetFfmpegCheck;
  const PART = FFMPEG ? makeMp4(1) : null;

  const call = (method, url, body, who = admin) => ctx.api(method, url, { token: who.token, body });
  const asDevice =
    (token) =>
    (method, url, options = {}) =>
      ctx.api(method, url, { ...options, headers: { Authorization: `Device ${token}` } });

  /** A venue with one court (optionally two cameras) and its box. */
  const setupVenue = async (name, { camera2 = false, capable = false } = {}) => {
    const venueId = (await call("POST", "/admin/venues", { name })).data.venueId;
    const court = await call("POST", "/admin/courts", {
      venueId,
      name: "Court 1",
      cameraRtspUrl: CAM1,
      ...(camera2 ? { camera2RtspUrl: CAM2 } : {}),
    });
    assert.equal(court.status, 201, JSON.stringify(court.body));
    const device = asDevice((await ctx.pairBox(admin.token, venueId, "Box")).data.token);
    const beat = await device("POST", "/device/heartbeat", {
      body: {
        agentVersion: "test",
        cameras: [],
        ...(capable ? { capabilities: ["session-part-camera"] } : {}),
      },
    });
    assert.equal(beat.status, 200, JSON.stringify(beat.body));
    return { venueId, courtId: court.data.courtId, device };
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

  /** A game that ran from `startMinutes` to `endMinutes` ago (negative). */
  const gameAt = async (target, startMinutes, endMinutes) => {
    const created = await call("POST", "/admin/sessions", {
      courtId: target.courtId,
      startAt: await manila(1),
      durationMinutes: 5,
      playerName: "Whole Game",
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    await ctx.sql.query(
      `UPDATE recording_sessions SET startAt = ?, endAt = ? WHERE sessionId = ?`,
      [await manila(startMinutes), await manila(endMinutes), created.data.sessionId]
    );
    const jobs = (await target.device("GET", "/device/jobs?wait=0")).data.jobs
      .filter((job) => job.sessionId === created.data.sessionId)
      .sort((a, b) => a.partIndex - b.partIndex || a.camera - b.camera);
    return { ...created.data, token: created.data.shareUrl.split("/").pop(), jobs };
  };

  const upload = (target, clipId, video = PART) =>
    target.device("POST", `/device/clips/${clipId}/upload`, {
      form: [
        ["video", video, "video/mp4", "part.mp4"],
        ["thumbnail", JPEG, "image/jpeg", "part.jpg"],
      ],
    });

  const absolute = (stored) => path.resolve(ctx.workDir, stored.replace(/^\/+/, ""));
  const page = async (token) => (await ctx.api("GET", `/public/sessions/${token}`)).data.session;

  before(async () => {
    ctx = await startTestApp();
    ({ runSessionJoins } = await ctx.importFromBack("server/src/jobs/sessionJoin.js"));
    ({ runClipMaintenance } = await ctx.importFromBack("server/src/jobs/clipMaintenance.js"));
    ({ resetFfmpegCheck } = await ctx.importFromBack("server/src/utils/sessionVideos.js"));
    admin = await ctx.createStaff("Admin", { access: "write" });
    viewer = await ctx.createStaff("Viewer", { access: "read" });
  });
  after(() => ctx?.stop());

  describe("one camera", () => {
    let home;
    let game;

    before(async () => {
      home = await setupVenue("One Cam Courts");
    });

    it("joins every part into one video and frees the parts", async () => {
      game = await gameAt(home, -14, -2); // 12 min → parts of 5, 5 and 2 min
      assert.deepEqual(
        game.jobs.map((job) => [job.partIndex, job.camera]),
        [
          [0, 0],
          [1, 0],
          [2, 0],
        ]
      );
      for (const job of game.jobs) assert.equal((await upload(home, job.clipId)).status, 200);

      let shown = await page(game.token);
      assert.equal(shown.parts.length, 3, "the parts show while the game is being saved");
      assert.equal(shown.partsTotal, 3);

      assert.deepEqual(await runSessionJoins(ctx.db, { limit: 10 }), { joined: 1 });

      const [[video]] = await ctx.sql.query(
        `SELECT status, camera, videoPath, partsJoined, partsMissing, durationSeconds, expiresAt
         FROM session_videos WHERE sessionId = ?`,
        [game.sessionId]
      );
      assert.equal(video.status, "Ready");
      assert.equal(video.camera, 0);
      assert.equal(video.partsJoined, 3);
      assert.equal(video.partsMissing, 0);
      assert.equal(video.durationSeconds, 12 * 60, "the windows' length");
      assert.ok(video.expiresAt);
      assert.ok(fs.existsSync(absolute(video.videoPath)));
      const seconds = probeSeconds(absolute(video.videoPath));
      assert.ok(seconds > 2.5 && seconds < 3.5, `3 one-second parts → ~3 s, got ${seconds}`);

      const [parts] = await ctx.sql.query(
        `SELECT joinedAt, videoPath FROM clips WHERE sessionId = ?`,
        [game.sessionId]
      );
      assert.ok(parts.every((part) => part.joinedAt && part.videoPath === null));

      const [[session]] = await ctx.sql.query(
        `SELECT wholeVideo FROM recording_sessions WHERE sessionId = ?`,
        [game.sessionId]
      );
      assert.equal(session.wholeVideo, "Done");

      shown = await page(game.token);
      assert.equal(shown.parts.length, 0, "joined parts leave the page");
      assert.equal(shown.videos.length, 1);
      assert.equal(shown.videos[0].label, "Whole game");
      assert.equal(shown.videos[0].status, "Ready");
      assert.deepEqual(shown.videos[0].gaps, []);
      assert.ok(shown.videos[0].videoUrl && shown.videos[0].thumbnailUrl);
    });

    it("downloads as one file named dyna-cam-game.mp4", async () => {
      const shown = await page(game.token);
      const res = await ctx.get(shown.videos[0].downloadUrl);
      assert.equal(res.status, 200);
      assert.equal(
        res.headers.get("content-disposition"),
        "attachment; filename=dyna-cam-game.mp4"
      );
      const body = Buffer.from(await res.arrayBuffer());
      assert.ok(body.length > PART.length * 2, "the whole game, not one part");
    });

    it("keeps joined parts out of the Clips page and shows the video in Sessions", async () => {
      const clips = await call("GET", `/admin/clips?source=SESSION&venueId=${home.venueId}`);
      assert.equal(clips.status, 200);
      assert.equal(clips.data.clips.length, 0);

      const detail = await call("GET", `/admin/sessions/${game.sessionId}`);
      assert.equal(detail.data.session.videos.length, 1);
      assert.equal(detail.data.session.videos[0].status, "Ready");
      assert.equal(detail.data.session.videos[0].partsJoined, 3);
      assert.ok(detail.data.session.parts.every((part) => part.joinedAt && !part.videoUrl));
    });

    it("skips a stretch the camera missed and names it", async () => {
      const gappy = await gameAt(home, -29, -17); // 3 parts
      await upload(home, gappy.jobs[0].clipId);
      const failed = await home.device("POST", `/device/clips/${gappy.jobs[1].clipId}/fail`, {
        body: { reason: "Camera was not recording during this part of the session" },
      });
      assert.equal(failed.status, 200);
      await upload(home, gappy.jobs[2].clipId);

      assert.deepEqual(await runSessionJoins(ctx.db, { limit: 10 }), { joined: 1 });
      const video = (await page(gappy.token)).videos[0];
      assert.equal(video.status, "Ready");
      assert.equal(video.partsMissing, 1);
      const [[part]] = await ctx.sql.query(
        `SELECT windowStartAt, windowEndAt FROM clips WHERE clipId = ?`,
        [gappy.jobs[1].clipId]
      );
      assert.deepEqual(video.gaps, [{ startAt: part.windowStartAt, endAt: part.windowEndAt }]);
    });

    it("expires the whole video with the venue's retention", async () => {
      await ctx.sql.query(
        `UPDATE session_videos SET expiresAt = '2000-01-01 00:00:00' WHERE sessionId = ?`,
        [game.sessionId]
      );
      const [[before]] = await ctx.sql.query(
        `SELECT videoPath FROM session_videos WHERE sessionId = ?`,
        [game.sessionId]
      );
      await runClipMaintenance(ctx.db);
      const [[row]] = await ctx.sql.query(
        `SELECT status, videoPath FROM session_videos WHERE sessionId = ?`,
        [game.sessionId]
      );
      assert.deepEqual({ ...row }, { status: "Expired", videoPath: null });
      assert.equal(fs.existsSync(absolute(before.videoPath)), false);
      const shown = (await page(game.token)).videos[0];
      assert.equal(shown.status, "Expired");
      assert.equal(shown.videoUrl, null);
    });
  });

  describe("two cameras", () => {
    it("cuts a set of parts per camera and joins one video per camera", async () => {
      const both = await setupVenue("Two Cam Courts", { camera2: true, capable: true });
      const game = await gameAt(both, -12, -2); // 2 windows × 2 cameras
      assert.deepEqual(
        game.jobs.map((job) => [job.partIndex, job.camera]),
        [
          [0, 1],
          [0, 2],
          [1, 1],
          [1, 2],
        ]
      );
      for (const job of game.jobs) assert.equal((await upload(both, job.clipId)).status, 200);
      assert.equal((await page(game.token)).partsTotal, 4);

      assert.deepEqual(await runSessionJoins(ctx.db, { limit: 10 }), { joined: 2 });
      const shown = await page(game.token);
      assert.deepEqual(
        shown.videos.map((video) => [video.camera, video.label, video.status]),
        [
          [1, "Cam 1", "Ready"],
          [2, "Cam 2", "Ready"],
        ]
      );
      const cam2 = await ctx.get(shown.videos[1].downloadUrl);
      assert.equal(
        cam2.headers.get("content-disposition"),
        "attachment; filename=dyna-cam-game-cam2.mp4"
      );

      const [[session]] = await ctx.sql.query(
        `SELECT status, failureReason FROM recording_sessions WHERE sessionId = ?`,
        [game.sessionId]
      );
      assert.deepEqual({ ...session }, { status: "Ready", failureReason: null });
    });

    it("keeps one stacked set of parts while a box can't cut per camera", async () => {
      const old = await setupVenue("Old Box Courts", { camera2: true, capable: false });
      const game = await gameAt(old, -7, -2); // 1 window
      assert.deepEqual(
        game.jobs.map((job) => [job.partIndex, job.camera]),
        [[0, 0]]
      );
    });

    it("keeps replays as they were", async () => {
      const both = await setupVenue("Replay Courts", { camera2: true, capable: true });
      const [[court]] = await ctx.sql.query(`SELECT qrToken FROM courts WHERE courtId = ?`, [
        both.courtId,
      ]);
      const saved = await ctx.api("POST", `/public/courts/${court.qrToken}/clips`);
      assert.equal(saved.status, 201, JSON.stringify(saved.body));
      const jobs = (await both.device("GET", "/device/jobs?wait=0")).data.jobs;
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].camera, 0, "a replay is the box's usual (stacked) output");
      assert.equal(jobs[0].sessionId, null);
    });
  });

  describe("when joining can't happen", () => {
    let home;

    before(async () => {
      home = await setupVenue("Trouble Courts");
    });

    it("waits without ffmpeg (parts stay on the page), but copies a one-part game", async () => {
      const saved = process.env.FFMPEG_PATH;
      process.env.FFMPEG_PATH = "/nonexistent/ffmpeg";
      resetFfmpegCheck();
      try {
        const long = await gameAt(home, -12, -2); // 2 parts
        const short = await gameAt(home, -20, -17); // 1 part
        for (const job of [...long.jobs, ...short.jobs]) await upload(home, job.clipId);

        const tally = await runSessionJoins(ctx.db, { limit: 10 });
        assert.deepEqual(tally, { waiting: 1, joined: 1 });
        assert.equal((await page(long.token)).parts.length, 2, "the player still has the parts");
        assert.equal((await page(long.token)).videos[0].status, "Saving");
        assert.equal((await page(short.token)).videos[0].status, "Ready");
      } finally {
        if (saved === undefined) delete process.env.FFMPEG_PATH;
        else process.env.FFMPEG_PATH = saved;
        resetFfmpegCheck();
      }
    });

    it("gives up after three failed joins, keeps the parts, and can try again", async () => {
      // A file that passes the upload check but isn't a real video
      const fake = Buffer.concat([
        Buffer.from([0, 0, 0, 0x18]),
        Buffer.from("ftypisom"),
        Buffer.alloc(64, 1),
      ]);
      const broken = await gameAt(home, -42, -32); // 2 parts
      for (const job of broken.jobs) await upload(home, job.clipId, fake);

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await ctx.sql.query(
          `UPDATE session_videos SET nextAttemptAt = NULL WHERE sessionId = ? AND status = 'Pending'`,
          [broken.sessionId]
        );
        await runSessionJoins(ctx.db, { limit: 10 });
      }
      const [[video]] = await ctx.sql.query(
        `SELECT status, attempts, failureReason FROM session_videos WHERE sessionId = ?`,
        [broken.sessionId]
      );
      assert.equal(video.status, "Failed");
      assert.equal(video.attempts, 3);
      assert.match(video.failureReason, /Joining the parts failed/);
      const [parts] = await ctx.sql.query(
        `SELECT videoPath, joinedAt FROM clips WHERE sessionId = ?`,
        [broken.sessionId]
      );
      assert.ok(
        parts.every((part) => part.videoPath && !part.joinedAt),
        "parts are kept"
      );
      assert.equal((await page(broken.token)).parts.length, 2);

      const denied = await call(
        "POST",
        `/admin/sessions/${broken.sessionId}/videos/0/retry`,
        undefined,
        viewer
      );
      assert.equal(denied.status, 403);
      const retry = await call("POST", `/admin/sessions/${broken.sessionId}/videos/0/retry`);
      assert.equal(retry.status, 200, JSON.stringify(retry.body));
      const [[again]] = await ctx.sql.query(
        `SELECT status, attempts FROM session_videos WHERE sessionId = ?`,
        [broken.sessionId]
      );
      assert.deepEqual({ ...again }, { status: "Pending", attempts: 0 });
    });

    it("answers 404 for a camera, session or video that has nothing to retry", async () => {
      const done = await gameAt(home, -55, -50);
      await upload(home, done.jobs[0].clipId);
      await runSessionJoins(ctx.db, { limit: 10 });

      for (const url of [
        `/admin/sessions/${done.sessionId}/videos/0/retry`, // Ready, not Failed
        `/admin/sessions/${done.sessionId}/videos/2/retry`, // no such camera
        `/admin/sessions/no-such-session/videos/0/retry`,
      ]) {
        assert.equal((await call("POST", url)).status, 404, url);
      }
      const [[row]] = await ctx.sql.query(`SELECT status FROM session_videos WHERE sessionId = ?`, [
        done.sessionId,
      ]);
      assert.equal(row.status, "Ready", "left alone");
      assert.equal(
        (await call("POST", `/admin/sessions/${done.sessionId}/videos/9/retry`)).status,
        400
      );
    });
  });
});
