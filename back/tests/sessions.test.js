// PLAN-001 Phase 3 — full-session recording: a booked court window is
// delivered as 5-minute parts (clips with explicit windows) the recorder box
// cuts like any clip; the session settles Ready/Failed from its parts.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { JPEG, startTestApp } from "./helpers/testApp.js";

const MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from("ftypisom"),
  Buffer.alloc(64, 1),
]);

describe("recording sessions", () => {
  let ctx;
  let admin;
  let viewer;
  const home = {};
  const other = {};

  const call = (method, url, body, who = admin) => ctx.api(method, url, { token: who.token, body });
  const asDevice =
    (token) =>
    (method, url, options = {}) =>
      ctx.api(method, url, { ...options, headers: { Authorization: `Device ${token}` } });
  const upload = (device, clipId) =>
    device("POST", `/device/clips/${clipId}/upload`, {
      form: [
        ["video", MP4, "video/mp4", "part.mp4"],
        ["thumbnail", JPEG, "image/jpeg", "part.jpg"],
      ],
    });

  /** "YYYY-MM-DD HH:mm:ss" in Manila, `minutes` from now (negative = ago). */
  const manila = async (minutes) => {
    const [[row]] = await ctx.sql.query(
      `SELECT DATE_FORMAT(DATE_ADD(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'),
               INTERVAL ? SECOND), '%Y-%m-%d %H:%i:%s') AS t`,
      [Math.round(minutes * 60)]
    );
    return row.t;
  };

  /** Book a session now, then move its window (a state the API can't produce). */
  const bookAt = async (target, startMinutes, endMinutes) => {
    const created = await call("POST", "/admin/sessions", {
      courtId: target.courtId,
      startAt: await manila(1),
      durationMinutes: 5,
      playerName: "Test Player",
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    await ctx.sql.query(
      `UPDATE recording_sessions SET startAt = ?, endAt = ? WHERE sessionId = ?`,
      [await manila(startMinutes), await manila(endMinutes), created.data.sessionId]
    );
    return created.data;
  };

  const sessionJobs = async (target, sessionId) =>
    (await target.device("GET", "/device/jobs?wait=0")).data.jobs
      .filter((j) => j.sessionId === sessionId)
      .sort((a, b) => a.partIndex - b.partIndex);

  const setupVenue = async (target, name) => {
    target.venueId = (await call("POST", "/admin/venues", { name })).data.venueId;
    const court = await call("POST", "/admin/courts", {
      venueId: target.venueId,
      name: "Court 1",
      cameraRtspUrl: "rtsp://u:p@10.0.0.9:554/stream1",
    });
    target.courtId = court.data.courtId;
    const box = await call("POST", "/admin/devices", { venueId: target.venueId, name: "Box" });
    target.device = asDevice(box.data.token);
  };

  before(async () => {
    ctx = await startTestApp();
    admin = await ctx.createStaff("Admin", { access: "write" });
    viewer = await ctx.createStaff("Viewer", { access: "read" });
    await setupVenue(home, "Session Courts");
    await setupVenue(other, "Other Courts");
  });
  after(() => ctx?.stop());

  describe("booking", () => {
    it("books a court and refuses an overlapping booking", async () => {
      const startAt = await manila(60);
      const created = await call("POST", "/admin/sessions", {
        courtId: home.courtId,
        startAt: startAt.slice(0, 16),
        durationMinutes: 90,
        playerName: "Ana",
        phone: "+639123456789",
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.match(created.data.shareUrl, /\/session\/[A-Za-z0-9_-]{16,}$/);

      const clash = await call("POST", "/admin/sessions", {
        courtId: home.courtId,
        startAt: (await manila(120)).slice(0, 16),
        durationMinutes: 30,
      });
      assert.equal(clash.status, 409);

      const one = await call("GET", `/admin/sessions/${created.data.sessionId}`);
      assert.equal(one.data.session.status, "Scheduled");
      assert.equal(one.data.session.partsTotal, 18);
      assert.equal(one.data.session.phone, "0912 3456 789");

      // Not started: can be cancelled; the slot is then free again
      assert.equal(
        (await call("POST", `/admin/sessions/${created.data.sessionId}/cancel`)).status,
        200
      );
      const again = await call("POST", "/admin/sessions", {
        courtId: home.courtId,
        startAt: (await manila(120)).slice(0, 16),
        durationMinutes: 30,
      });
      assert.equal(again.status, 201);
      await call("POST", `/admin/sessions/${again.data.sessionId}/cancel`);
    });

    it("refuses a start in the past, a bad length, a court without a camera, and read access", async () => {
      assert.equal(
        (
          await call("POST", "/admin/sessions", {
            courtId: home.courtId,
            startAt: await manila(-30),
            durationMinutes: 30,
          })
        ).status,
        400
      );
      assert.equal(
        (
          await call("POST", "/admin/sessions", {
            courtId: home.courtId,
            startAt: await manila(30),
            durationMinutes: 600,
          })
        ).status,
        400
      );
      const bare = await call("POST", "/admin/courts", { venueId: home.venueId, name: "No cam" });
      assert.equal(
        (
          await call("POST", "/admin/sessions", {
            courtId: bare.data.courtId,
            startAt: await manila(30),
            durationMinutes: 30,
          })
        ).status,
        400
      );
      assert.equal(
        (
          await call(
            "POST",
            "/admin/sessions",
            { courtId: home.courtId, startAt: await manila(30), durationMinutes: 30 },
            viewer
          )
        ).status,
        403
      );
    });
  });

  describe("parts", () => {
    let finished;

    it("creates one job per 5-minute part once the window has ended, for the home box only", async () => {
      finished = await bookAt(home, -14, -2); // 12 minutes → parts of 5, 5, 2
      const jobs = await sessionJobs(home, finished.sessionId);
      assert.deepEqual(
        jobs.map((j) => [j.partIndex, j.durationSeconds, j.windowEndMs - j.windowStartMs]),
        [
          [0, 300, 300_000],
          [1, 300, 300_000],
          [2, 120, 120_000],
        ]
      );
      assert.equal((await sessionJobs(other, finished.sessionId)).length, 0);

      const config = await home.device("GET", "/device/config");
      assert.ok(config.data.sessions.some((s) => s.sessionId === finished.sessionId));
      const otherConfig = await other.device("GET", "/device/config");
      assert.ok(!otherConfig.data.sessions.some((s) => s.sessionId === finished.sessionId));

      const one = await call("GET", `/admin/sessions/${finished.sessionId}`);
      assert.equal(one.data.session.status, "Processing");
      finished.jobs = jobs;
    });

    it("settles Ready once every part is in, and the player's page lists the parts", async () => {
      for (const job of finished.jobs) {
        assert.equal((await upload(home.device, job.clipId)).status, 200);
      }
      const one = await call("GET", `/admin/sessions/${finished.sessionId}`);
      assert.equal(one.data.session.status, "Ready");
      assert.equal(one.data.session.partsReady, 3);
      assert.ok(one.data.session.parts.every((p) => p.videoUrl && p.downloadUrl));

      const token = finished.shareUrl.split("/").pop();
      const page = await ctx.api("GET", `/public/sessions/${token}`);
      assert.equal(page.status, 200);
      assert.equal(page.data.session.status, "Ready");
      assert.equal(page.data.session.parts.length, 3);
      assert.equal(page.data.session.sessionId, undefined, "no IDs on the public page");
      assert.ok(page.data.session.parts[0].videoUrl);
    });

    it("is Ready with a note when only some parts could be saved", async () => {
      const partial = await bookAt(home, -30, -19); // 11 minutes → 3 parts
      const jobs = await sessionJobs(home, partial.sessionId);
      assert.equal(jobs.length, 3);
      await upload(home.device, jobs[0].clipId);
      await upload(home.device, jobs[1].clipId);
      await home.device("POST", `/device/clips/${jobs[2].clipId}/fail`, {
        body: { reason: "Camera was not recording at that time" },
      });
      const one = await call("GET", `/admin/sessions/${partial.sessionId}`);
      assert.equal(one.data.session.status, "Ready");
      assert.equal(one.data.session.failureReason, "1 of 3 parts could not be saved");
    });

    it("only cuts the parts that are due while a session is still recording, and can end early", async () => {
      const running = await bookAt(home, -7, 20); // 7 min in → only part 0 is due
      let jobs = await sessionJobs(home, running.sessionId);
      assert.deepEqual(
        jobs.map((j) => j.partIndex),
        [0]
      );
      let one = await call("GET", `/admin/sessions/${running.sessionId}`);
      assert.equal(one.data.session.status, "Recording");
      assert.equal(
        (await call("POST", `/admin/sessions/${running.sessionId}/cancel`)).status,
        409,
        "a started session is ended, not cancelled"
      );

      assert.equal((await call("POST", `/admin/sessions/${running.sessionId}/end`)).status, 200);
      jobs = await sessionJobs(home, running.sessionId);
      assert.deepEqual(
        jobs.map((j) => j.partIndex),
        [0, 1]
      );
      one = await call("GET", `/admin/sessions/${running.sessionId}`);
      assert.equal(one.data.session.status, "Processing");
    });

    it("gives a session part longer than a clip before giving up on it", async () => {
      const { runClipMaintenance } = await import("../server/src/jobs/clipMaintenance.js");
      const slow = await bookAt(home, -40, -30); // parts ended 30+ min ago, box busy
      const jobs = await sessionJobs(home, slow.sessionId);
      assert.equal(jobs.length, 2);
      await runClipMaintenance(ctx.db);
      const [rows] = await ctx.sql.query(
        `SELECT status FROM clips WHERE sessionId = ? ORDER BY partIndex`,
        [slow.sessionId]
      );
      assert.deepEqual(
        rows.map((r) => r.status),
        ["Pending", "Pending"],
        "a part 30 min old is still waiting"
      );
    });

    it("fails a session whose recorder box never picked it up", async () => {
      const { runClipMaintenance } = await import("../server/src/jobs/clipMaintenance.js");
      const lost = await bookAt(other, -100, -90); // parts > 60 min old; other box never polls
      await runClipMaintenance(ctx.db);
      const one = await call("GET", `/admin/sessions/${lost.sessionId}`);
      assert.equal(one.data.session.status, "Failed");
      assert.equal(one.data.session.failureReason, "None of the session's parts could be saved");
    });
  });

  it("treats an invalid or cancelled session link as missing", async () => {
    assert.equal((await ctx.api("GET", "/public/sessions/not-a-real-token-123456")).status, 404);
    const future = await call("POST", "/admin/sessions", {
      courtId: other.courtId,
      startAt: await manila(300),
      durationMinutes: 10,
    });
    await call("POST", `/admin/sessions/${future.data.sessionId}/cancel`);
    const token = future.data.shareUrl.split("/").pop();
    assert.equal((await ctx.api("GET", `/public/sessions/${token}`)).status, 404);
    assert.equal((await call("GET", "/admin/sessions/no-such-session")).status, 404);
  });
});
