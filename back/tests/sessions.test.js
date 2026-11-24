// PLAN-001 Phase 3 — full-session recording: a booked court window is
// delivered as 5-minute parts (clips with explicit windows) the recorder box
// cuts like any clip; the session settles Ready/Failed from its parts.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { gameJobs, keepGame } from "./helpers/gameUpload.js";
import { startTestApp } from "./helpers/testApp.js";

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
    // CR-039: New game is always free; this test is about an unpaid game (one made before)
    created.data.payCode = await ctx.makeUnpaid(created.data.sessionId);
    await ctx.sql.query(
      `UPDATE recording_sessions SET startAt = ?, endAt = ? WHERE sessionId = ?`,
      [await manila(startMinutes), await manila(endMinutes), created.data.sessionId]
    );
    return created.data;
  };

  const setupVenue = async (target, name) => {
    target.venueId = (await call("POST", "/admin/venues", { name })).data.venueId;
    const court = await call("POST", "/admin/courts", {
      venueId: target.venueId,
      name: "Court 1",
      cameraRtspUrl: "rtsp://u:p@10.0.0.9:554/stream1",
    });
    target.courtId = court.data.courtId;
    const box = await ctx.pairBox(admin.token, target.venueId, "Box");
    target.device = asDevice(box.data.token);
    target.token = box.data.token;
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

  // CR-006: a game travels as one file per camera, uploaded after it ends
  describe("game videos", () => {
    let finished;

    it("makes one game job per camera once the game has ended, for the home box only", async () => {
      finished = await bookAt(home, -14, -2);
      const jobs = await gameJobs(ctx, home.token, finished.sessionId);
      assert.equal(jobs.length, 1, "a one-camera court: one video");
      assert.equal(jobs[0].camera, 0);
      assert.equal(jobs[0].windowEndMs - jobs[0].windowStartMs, 12 * 60_000);
      assert.equal((await gameJobs(ctx, other.token, finished.sessionId)).length, 0);

      const [clips] = await ctx.sql.query(`SELECT COUNT(*) AS n FROM clips WHERE sessionId = ?`, [
        finished.sessionId,
      ]);
      assert.equal(clips[0].n, 0, "no 5-minute pieces at all");

      const config = await home.device("GET", "/device/config");
      assert.ok(config.data.sessions.some((s) => s.sessionId === finished.sessionId));
      const otherConfig = await other.device("GET", "/device/config");
      assert.ok(!otherConfig.data.sessions.some((s) => s.sessionId === finished.sessionId));

      const one = await call("GET", `/admin/sessions/${finished.sessionId}`);
      assert.equal(one.data.session.status, "Processing");
      assert.equal(one.data.session.videosTotal, 1);
      assert.equal(one.data.session.uploadPercent, null, "the box hasn't started sending");
      finished.jobs = jobs;
    });

    it("settles Ready once the file is in; the player's page shows the video, never parts", async () => {
      // CR-040: on a court without Google Drive the box keeps it — Ready
      const done = await keepGame(ctx, home.token, finished.jobs[0].sessionVideoId);
      assert.equal(done.status, 200, JSON.stringify(done.body));
      const one = await call("GET", `/admin/sessions/${finished.sessionId}`);
      assert.equal(one.data.session.status, "Ready");
      assert.equal(one.data.session.failureReason, null);
      assert.equal(one.data.session.videosReady, 1);
      assert.equal(one.data.session.videos[0].status, "Ready");

      const token = finished.shareUrl.split("/").pop();
      // CR-015: locked until paid at the desk — the code, nothing to play
      const locked = await ctx.api("GET", `/public/sessions/${token}`);
      assert.equal(locked.data.session.locked, true);
      assert.match(locked.data.session.payCode, /^[A-Z0-9]{6}$/);
      assert.equal(locked.data.session.videos[0].driveUrl, null);
      assert.equal("videoUrl" in locked.data.session.videos[0], false, "never a file link");
      const paid = await call("POST", "/admin/payments", {
        sessionId: finished.sessionId,
        amount: 300,
      });
      assert.equal(paid.status, 201, JSON.stringify(paid.body));

      const page = await ctx.api("GET", `/public/sessions/${token}`);
      assert.equal(page.data.session.locked, false);
      assert.equal(page.data.session.payCode, null);
      assert.equal(page.status, 200);
      assert.equal(page.data.session.status, "Ready");
      assert.equal(page.data.session.sessionId, undefined, "no IDs on the public page");
      assert.equal("parts" in page.data.session, false);
      assert.equal(page.data.session.uploadPercent, 100);
      assert.equal(page.data.session.videos[0].status, "Ready");
      assert.equal(page.data.session.videos[0].driveState, "NotShared", "no Drive on this court");
      for (const key of ["videoUrl", "downloadUrl", "thumbnailUrl"]) {
        assert.equal(key in page.data.session.videos[0], false, key);
      }
      assert.equal(
        (await gameJobs(ctx, home.token, finished.sessionId)).length,
        0,
        "no job once it's in"
      );
    });

    it("is Ready with a note in minutes when the camera missed a stretch", async () => {
      const partial = await bookAt(home, -30, -19);
      const [job] = await gameJobs(ctx, home.token, partial.sessionId);
      const end = job.windowEndMs;
      const done = await keepGame(ctx, home.token, job.sessionVideoId, {
        gaps: [{ startMs: end - 60_000, endMs: end }],
      });
      assert.equal(done.status, 200, JSON.stringify(done.body));
      const one = await call("GET", `/admin/sessions/${partial.sessionId}`);
      assert.equal(one.data.session.status, "Ready");
      assert.match(
        one.data.session.failureReason,
        /^1 minute wasn't recorded \(\d{1,2}:\d{2}( [AP]M)? – \d{1,2}:\d{2} [AP]M\)$/
      );
    });

    it("has no job while the game is recording, and one as soon as it's ended early", async () => {
      const running = await bookAt(home, -7, 20);
      assert.equal((await gameJobs(ctx, home.token, running.sessionId)).length, 0);
      let one = await call("GET", `/admin/sessions/${running.sessionId}`);
      assert.equal(one.data.session.status, "Recording");
      assert.equal(
        (await call("POST", `/admin/sessions/${running.sessionId}/cancel`)).status,
        409,
        "a started session is ended, not cancelled"
      );

      assert.equal((await call("POST", `/admin/sessions/${running.sessionId}/end`)).status, 200);
      const jobs = await gameJobs(ctx, home.token, running.sessionId);
      assert.equal(jobs.length, 1);
      assert.ok(jobs[0].windowEndMs <= Date.now() + 2000, "the window ends at End");
      one = await call("GET", `/admin/sessions/${running.sessionId}`);
      assert.equal(one.data.session.status, "Processing");
    });

    it("gives a game whose box never sends it a day before giving up", async () => {
      const { runClipMaintenance } = await import("../server/src/jobs/clipMaintenance.js");
      const lost = await bookAt(other, -100, -90); // the other box never polls
      await runClipMaintenance(ctx.db);
      let one = await call("GET", `/admin/sessions/${lost.sessionId}`);
      assert.equal(one.data.session.status, "Processing", "still waiting after 90 minutes");

      await ctx.sql.query(
        `UPDATE recording_sessions SET startAt = DATE_SUB(startAt, INTERVAL 1 DAY),
                endAt = DATE_SUB(endAt, INTERVAL 1 DAY)
         WHERE sessionId = ?`,
        [lost.sessionId]
      );
      await runClipMaintenance(ctx.db);
      one = await call("GET", `/admin/sessions/${lost.sessionId}`);
      assert.equal(one.data.session.status, "Failed");
      assert.equal(one.data.session.failureReason, "None of the game could be recorded");
      assert.match(one.data.session.videos[0].failureReason, /didn't send this game in time/);
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
