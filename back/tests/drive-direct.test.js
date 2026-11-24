// CR-040 (PLAN-005) — videos never come to the API: a box that reports
// "drive-direct" keeps the game's file and sends it straight to the court's
// Google Drive. The API opens the Drive upload (the court's sign-in stays here),
// reads the file back from Drive before believing the box, shares it by link,
// and tells the box what to keep and until when. Google is a fake server.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { GAME_MP4, gameJobs } from "./helpers/gameUpload.js";
import { startTestApp } from "./helpers/testApp.js";
import { fakeGoogle } from "./helpers/fakeGoogle.js";

describe("videos straight from the box to Google Drive (CR-040)", () => {
  let ctx;
  let admin;
  let google;
  const home = {};
  const away = {};
  let courtNo = 0;

  const call = (method, url, body, who = admin) => ctx.api(method, url, { token: who.token, body });
  const asBox = (token) => ({ Authorization: `Device ${token}` });
  const box = (token, method, url, body) => ctx.api(method, url, { headers: asBox(token), body });
  const beat = (token, capabilities) =>
    box(token, "POST", "/device/heartbeat", { cameras: [], capabilities });

  const manila = async (minutes) => {
    const [[row]] = await ctx.sql.query(
      `SELECT DATE_FORMAT(DATE_ADD(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'),
               INTERVAL ? SECOND), '%Y-%m-%d %H:%i:%s') AS t`,
      [Math.round(minutes * 60)]
    );
    return row.t;
  };

  /** A court (with Drive when `email` is given) at the target's venue. */
  const newCourt = async (target, email = null) => {
    courtNo += 1;
    const court = await call("POST", "/admin/courts", {
      venueId: target.venueId,
      name: `Court ${courtNo}`,
      cameraRtspUrl: `rtsp://u:p@10.0.7.${courtNo}:554/stream1`,
    });
    assert.equal(court.status, 201, JSON.stringify(court.body));
    if (email) await connect(court.data.courtId, email);
    return court.data.courtId;
  };

  /** Connect a court's Google Drive through the consent round trip. */
  const connect = async (courtId, email) => {
    const started = await call("POST", `/admin/courts/${courtId}/google-drive/connect`);
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const state = new URL(started.data.url).searchParams.get("state");
    const res = await ctx.get(
      `/api/v1/oauth/google/callback?${new URLSearchParams({ code: email, state })}`,
      { redirect: "manual" }
    );
    assert.equal(res.status, 303);
  };

  /** A game on `courtId` that ran 20 → 2 minutes ago; its game jobs for the box. */
  const endedGame = async (target, courtId) => {
    const created = await call("POST", "/admin/sessions", {
      courtId,
      startAt: await manila(1),
      durationMinutes: 5,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    await ctx.sql.query(
      `UPDATE recording_sessions SET startAt = ?, endAt = ? WHERE sessionId = ?`,
      [await manila(-20), await manila(-2), created.data.sessionId]
    );
    const jobs = await gameJobs(ctx, target.token, created.data.sessionId);
    assert.equal(jobs.length, 1, JSON.stringify(jobs));
    return {
      sessionId: created.data.sessionId,
      shareToken: created.data.shareUrl.split("/").pop(),
      job: jobs[0],
    };
  };

  const driveSession = (token, id, body = {}) =>
    box(token, "POST", `/device/game-videos/${id}/drive-session`, {
      sizeBytes: GAME_MP4.length,
      durationSeconds: 18 * 60,
      gaps: [],
      ...body,
    });

  /** What the box does with the session address: PUT the bytes to Google (no token). */
  const sendToGoogle = async (uploadUrl, bytes = GAME_MP4) => {
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Range": `bytes 0-${bytes.length - 1}/${bytes.length}` },
      body: bytes,
    });
    assert.equal(res.status, 200);
    return (await res.json()).id;
  };

  const videoRow = async (id) =>
    (
      await ctx.sql.query(
        `SELECT status, delivery, videoPath, driveStatus, driveFileId, driveUrl, driveSessionUrl,
                receivedBytes, boxKeepUntil, boxDeletedAt, deviceId
         FROM session_videos WHERE sessionVideoId = ?`,
        [id]
      )
    )[0][0];
  const page = async (shareToken) =>
    (await ctx.api("GET", `/public/sessions/${shareToken}`)).data.session;
  const config = async (token) => (await box(token, "GET", "/device/config")).data;

  before(async () => {
    google = fakeGoogle();
    await new Promise((resolve) => google.server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${google.server.address().port}`;
    ctx = await startTestApp({
      env: {
        GOOGLE_CLIENT_ID: "test-client",
        GOOGLE_CLIENT_SECRET: "test-secret",
        GOOGLE_REDIRECT_URI: "http://localhost:4021/api/v1/oauth/google/callback",
        GOOGLE_AUTH_URL: `${base}/auth`,
        GOOGLE_TOKEN_URL: `${base}/token`,
        GOOGLE_REVOKE_URL: `${base}/revoke`,
        GOOGLE_DRIVE_API_URL: `${base}/drive`,
        GOOGLE_DRIVE_UPLOAD_URL: `${base}/upload`,
        APP_URL: "http://web.test",
      },
    });
    admin = await ctx.createStaff("Admin", { access: "write" });
    for (const [target, name] of [
      [home, "Drive Direct Courts"],
      [away, "Other Courts"],
    ]) {
      target.venueId = (await call("POST", "/admin/venues", { name })).data.venueId;
      target.token = (await ctx.pairBox(admin.token, target.venueId, "Box")).data.token;
      assert.equal((await beat(target.token, ["game-file", "drive-direct"])).status, 200);
    }
  });
  after(async () => {
    await ctx?.stop();
    google?.server.close();
  });

  it("an older box (no drive-direct) gets no game jobs until it reports drive-direct (Phase 4)", async () => {
    const venueId = (await call("POST", "/admin/venues", { name: "Old Box Courts" })).data.venueId;
    const old = { venueId, token: (await ctx.pairBox(admin.token, venueId, "Old")).data.token };
    assert.equal((await beat(old.token, ["game-file"])).status, 200);
    const courtId = await newCourt(old);
    const created = await call("POST", "/admin/sessions", {
      courtId,
      startAt: await manila(1),
      durationMinutes: 5,
    });
    await ctx.sql.query(
      `UPDATE recording_sessions SET startAt = ?, endAt = ? WHERE sessionId = ?`,
      [await manila(-20), await manila(-2), created.data.sessionId]
    );
    const before = await box(old.token, "GET", "/device/jobs?wait=0");
    assert.deepEqual(before.data.jobs, [], "nothing it could send");
    // The game's footage stays listed for the box meanwhile
    const listed = (await config(old.token)).sessions.map((s) => s.sessionId);
    assert.ok(listed.includes(created.data.sessionId));

    assert.equal((await beat(old.token, ["game-file", "drive-direct"])).status, 200);
    const after = await box(old.token, "GET", "/device/jobs?wait=0");
    assert.equal(after.data.jobs.length, 1);
    assert.equal(after.data.jobs[0].delivery, "drive");
  });

  it("sends a game straight to Drive: never on the API's disk, link on the game page", async () => {
    const courtId = await newCourt(home, "venue@drive.test");
    const game = await endedGame(home, courtId);
    assert.equal(game.job.delivery, "drive");
    const id = game.job.sessionVideoId;

    const opened = await driveSession(home.token, id);
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    assert.equal(opened.data.drive, true);
    assert.match(opened.data.uploadUrl, /\/session\//);
    assert.ok(
      opened.data.keepUntilMs > Date.now() + 6 * 24 * 3600 * 1000,
      "kept the venue's 7 days"
    );
    let row = await videoRow(id);
    assert.equal(row.status, "Uploading");
    assert.equal(row.delivery, "Drive");
    assert.notEqual(row.driveSessionUrl, opened.data.uploadUrl, "stored encrypted");

    // The same file again (a box restart): the same session; newSession: a fresh one
    const again = await driveSession(home.token, id);
    assert.equal(again.data.uploadUrl, opened.data.uploadUrl);

    // Progress for the game page
    const progress = await box(home.token, "POST", `/device/game-videos/${id}/progress`, {
      uploadedBytes: 100,
    });
    assert.equal(progress.status, 200, JSON.stringify(progress.body));
    let shown = await page(game.shareToken);
    assert.equal(shown.videos[0].status, "Saving");
    assert.equal(shown.videos[0].driveState, "Uploading");
    assert.equal(shown.uploadPercent, Math.floor((100 / GAME_MP4.length) * 100));

    const fileId = await sendToGoogle(opened.data.uploadUrl);
    const done = await box(home.token, "POST", `/device/game-videos/${id}/drive-done`, {
      driveFileId: fileId,
    });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    row = await videoRow(id);
    assert.equal(row.status, "Ready");
    assert.equal(row.driveStatus, "Uploaded");
    assert.equal(row.driveFileId, fileId);
    assert.equal(row.videoPath, null);
    assert.equal(row.driveSessionUrl, null);
    assert.equal(google.state.files.get(fileId).shared, true, "shared by link");
    assert.equal(google.state.files.get(fileId).name, "Whole game.mp4");

    // Nothing of it on the API's disk
    const folder = path.resolve(ctx.workDir, "public", "uploads", "admin", "clips");
    const stored = fs.existsSync(folder)
      ? fs.readdirSync(folder, { recursive: true }).filter((f) => String(f).includes(id))
      : [];
    assert.deepEqual(stored, []);

    shown = await page(game.shareToken);
    const [video] = shown.videos;
    assert.equal(video.status, "Ready");
    assert.equal(video.delivery, "Drive");
    assert.equal(video.driveState, "OnDrive");
    assert.equal(video.driveUrl, row.driveUrl);
    for (const key of ["videoUrl", "downloadUrl", "thumbnailUrl"]) {
      assert.equal(key in video, false, key);
    }
    assert.ok(shown.driveUrl, "the game's shared folder");

    // The box keeps its copy, and knows it's on Drive
    const kept = (await config(home.token)).keepVideos.find((v) => v.sessionVideoId === id);
    assert.equal(kept.onDrive, true);
    assert.ok(kept.keepUntilMs > Date.now());
  });

  it("opens a fresh session on request, and refuses a file Drive doesn't have as sent", async () => {
    const courtId = await newCourt(home, "venue2@drive.test");
    const game = await endedGame(home, courtId);
    const id = game.job.sessionVideoId;
    const first = await driveSession(home.token, id);
    const fresh = await driveSession(home.token, id, { newSession: true });
    assert.notEqual(fresh.data.uploadUrl, first.data.uploadUrl);

    // The old upload to the API: gone (Phase 4)
    const start = await box(home.token, "POST", `/device/game-videos/${id}/start`, {
      sizeBytes: GAME_MP4.length,
      durationSeconds: 60,
      gaps: [],
    });
    assert.equal(start.status, 410);
    assert.equal(start.body.code, "BOX_UPDATE_REQUIRED");

    // A file ID Drive doesn't know, or a file of another size: not believed
    const unknown = await box(home.token, "POST", `/device/game-videos/${id}/drive-done`, {
      driveFileId: "nope",
    });
    assert.equal(unknown.status, 409);
    assert.equal(unknown.body.code, "DRIVE_FILE_MISMATCH");
    assert.equal((await videoRow(id)).status, "Uploading");

    const other = await driveSession(home.token, id);
    const shortFile = GAME_MP4.subarray(0, 50);
    const session = google.state.sessions.get(other.data.uploadUrl.split("/session/")[1]);
    session.size = shortFile.length; // the box sent fewer bytes than it said
    const wrongId = await sendToGoogle(other.data.uploadUrl, shortFile);
    const wrong = await box(home.token, "POST", `/device/game-videos/${id}/drive-done`, {
      driveFileId: wrongId,
    });
    assert.equal(wrong.status, 409);
    assert.equal((await videoRow(id)).driveSessionUrl, null, "the next try opens a new session");
  });

  it("a court without Drive: kept on the box only; connecting Drive sends it", async () => {
    const courtId = await newCourt(home);
    const game = await endedGame(home, courtId);
    const id = game.job.sessionVideoId;

    const kept = await driveSession(home.token, id);
    assert.equal(kept.status, 200, JSON.stringify(kept.body));
    assert.equal(kept.data.drive, false);
    assert.equal(kept.data.reason, "NO_DRIVE");
    let row = await videoRow(id);
    assert.equal(row.status, "Ready");
    assert.equal(row.driveStatus, "Skipped");
    const shown = await page(game.shareToken);
    assert.equal(shown.videos[0].driveState, "NotShared");
    assert.equal(shown.videos[0].driveUrl, null);
    assert.equal((await gameJobs(ctx, home.token, game.sessionId)).length, 0);

    // Staff connect Drive: the box gets the job again (it still has the file)
    await connect(courtId, "late@drive.test");
    row = await videoRow(id);
    assert.equal(row.status, "Pending");
    assert.ok(row.deviceId, "still this box's — no other box has the file");
    const jobs = await gameJobs(ctx, home.token, game.sessionId);
    assert.equal(jobs.length, 1);
    const opened = await driveSession(home.token, id);
    assert.equal(opened.data.drive, true);
  });

  it("Admin retry sends a kept video again", async () => {
    const courtId = await newCourt(home);
    const game = await endedGame(home, courtId);
    const id = game.job.sessionVideoId;
    await driveSession(home.token, id);
    assert.equal((await videoRow(id)).driveStatus, "Skipped");
    const retry = await call("POST", `/admin/sessions/${game.sessionId}/videos/0/retry`);
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal((await videoRow(id)).status, "Pending");
  });

  it("Re-upload to Drive sends a box-kept video from the box (never queued for the server's Drive job)", async () => {
    const courtId = await newCourt(home, "venue5@drive.test");
    const game = await endedGame(home, courtId);
    const id = game.job.sessionVideoId;
    await ctx.sql.query(`UPDATE courts SET driveStatus = 'NeedsReconnect' WHERE courtId = ?`, [
      courtId,
    ]);
    const kept = await driveSession(home.token, id);
    assert.equal(kept.data.drive, false);
    assert.equal(kept.data.reason, "DRIVE_RECONNECT");
    await ctx.sql.query(`UPDATE courts SET driveStatus = 'Connected' WHERE courtId = ?`, [courtId]);

    const res = await call("POST", `/admin/sessions/${game.sessionId}/drive-upload`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.match(res.body.message, /from the venue box/);
    const row = await videoRow(id);
    assert.equal(row.status, "Pending");
    assert.equal(row.driveStatus, null);
    const jobs = await gameJobs(ctx, home.token, game.sessionId);
    assert.equal(jobs[0]?.delivery, "drive");
    assert.equal(jobs[0]?.sessionVideoId, id);
  });

  it("a Drive video the box reported failed stays on its keep list; Retry gives it back to that box", async () => {
    const courtId = await newCourt(home, "venue4@drive.test");
    const game = await endedGame(home, courtId);
    const id = game.job.sessionVideoId;
    await driveSession(home.token, id);
    const failed = await box(home.token, "POST", `/device/game-videos/${id}/fail`, {
      reason: "Google Drive refused the video: the court's Google Drive is full",
    });
    assert.equal(failed.status, 200, JSON.stringify(failed.body));
    assert.equal((await videoRow(id)).status, "Failed");
    const kept = (await config(home.token)).keepVideos.find((v) => v.sessionVideoId === id);
    assert.ok(kept, "a Failed Drive video is still kept on the box");
    assert.equal(kept.onDrive, false);

    const { deviceId } = await videoRow(id);
    const retry = await call("POST", `/admin/sessions/${game.sessionId}/videos/0/retry`);
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    const row = await videoRow(id);
    assert.equal(row.status, "Pending");
    assert.equal(row.deviceId, deviceId, "it stays with the box that holds the file");
    const jobs = await gameJobs(ctx, home.token, game.sessionId);
    assert.equal(jobs[0]?.delivery, "drive");
  });

  it("the heartbeat keeps the box's count of kept videos", async () => {
    const res = await box(home.token, "POST", "/device/heartbeat", {
      cameras: [],
      capabilities: ["game-file", "drive-direct"],
      system: { diskFreeMb: 1000, localVideos: 3, localVideoMb: 4200 },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const [[device]] = await ctx.sql.query(`SELECT lastStatus FROM devices WHERE venueId = ?`, [
      home.venueId,
    ]);
    const status =
      typeof device.lastStatus === "string" ? JSON.parse(device.lastStatus) : device.lastStatus;
    assert.equal(status.system.localVideos, 3);
    assert.equal(status.system.localVideoMb, 4200);
  });

  it("the box reports a removed copy; the keep list drops it", async () => {
    const courtId = await newCourt(home, "venue3@drive.test");
    const game = await endedGame(home, courtId);
    const id = game.job.sessionVideoId;
    const opened = await driveSession(home.token, id);
    const fileId = await sendToGoogle(opened.data.uploadUrl);
    await box(home.token, "POST", `/device/game-videos/${id}/drive-done`, { driveFileId: fileId });

    const res = await box(home.token, "POST", `/device/game-videos/${id}/box-deleted`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok((await videoRow(id)).boxDeletedAt);
    assert.ok(!(await config(home.token)).keepVideos.some((v) => v.sessionVideoId === id));
  });

  it("a video the box is still sending to Drive isn't given up after 24 h — only after its keep time", async () => {
    const { runClipMaintenance } = await ctx.importFromBack("server/src/jobs/clipMaintenance.js");
    const courtId = await newCourt(home, "venue7@drive.test");
    const game = await endedGame(home, courtId);
    const id = game.job.sessionVideoId;
    assert.equal((await driveSession(home.token, id)).data.drive, true);

    // The game ended 2 days ago; the box (offline) still holds the file
    await ctx.sql.query(
      `UPDATE recording_sessions SET endAt = DATE_SUB(NOW(), INTERVAL 2 DAY) WHERE sessionId = ?`,
      [game.sessionId]
    );
    await runClipMaintenance(ctx.db);
    assert.equal((await videoRow(id)).status, "Uploading");

    // Its keep time is over: given up, with a reason staff can read
    await ctx.sql.query(
      `UPDATE session_videos SET boxKeepUntil = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE sessionVideoId = ?`,
      [id]
    );
    await runClipMaintenance(ctx.db);
    const [[row]] = await ctx.sql.query(
      `SELECT status, failureReason FROM session_videos WHERE sessionVideoId = ?`,
      [id]
    );
    assert.equal(row.status, "Failed");
    assert.match(row.failureReason, /Google Drive before its keep time/);
  });

  it("Drive keeps it the venue's keep time (not 2 days); then it expires and goes", async () => {
    const { runDriveCleanup } = await ctx.importFromBack("server/src/jobs/driveCleanup.js");
    const { runClipMaintenance } = await ctx.importFromBack("server/src/jobs/clipMaintenance.js");
    const courtId = await newCourt(home, "venue6@drive.test");
    const game = await endedGame(home, courtId);
    const id = game.job.sessionVideoId;
    const opened = await driveSession(home.token, id);
    const fileId = await sendToGoogle(opened.data.uploadUrl);
    await box(home.token, "POST", `/device/game-videos/${id}/drive-done`, { driveFileId: fileId });

    // 3 days old: a server-held video's Drive copy would be gone; this one stays
    await ctx.sql.query(
      `UPDATE session_videos SET dateCreated = DATE_SUB(dateCreated, INTERVAL 3 DAY)
       WHERE sessionVideoId = ?`,
      [id]
    );
    await runDriveCleanup(ctx.db);
    assert.equal(google.state.files.get(fileId).trashed, undefined);
    assert.equal((await videoRow(id)).driveStatus, "Uploaded");

    // Past its keep time: Expired, and its Drive copy goes to the trash
    await ctx.sql.query(
      `UPDATE session_videos SET expiresAt = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE sessionVideoId = ?`,
      [id]
    );
    await runClipMaintenance(ctx.db);
    await runDriveCleanup(ctx.db);
    const row = await videoRow(id);
    assert.equal(row.status, "Expired");
    assert.equal(row.driveStatus, "Deleted");
    assert.equal(google.state.files.get(fileId).trashed, true);
  });

  it("another venue's box can't touch the video", async () => {
    const courtId = await newCourt(home, "venue4@drive.test");
    const game = await endedGame(home, courtId);
    const id = game.job.sessionVideoId;
    assert.equal((await driveSession(away.token, id)).status, 404);
    assert.equal(
      (await box(away.token, "POST", `/device/game-videos/${id}/progress`, { uploadedBytes: 1 }))
        .status,
      404
    );
    assert.equal(
      (await box(away.token, "POST", `/device/game-videos/${id}/drive-done`, { driveFileId: "x" }))
        .status,
      404
    );
    assert.equal(
      (await box(away.token, "POST", `/device/game-videos/${id}/box-deleted`)).status,
      404
    );
  });

  it("a Deleted game video is 404 and stays unchanged", async () => {
    const courtId = await newCourt(home, "venue5@drive.test");
    const game = await endedGame(home, courtId);
    const id = game.job.sessionVideoId;
    await ctx.sql.query(`UPDATE session_videos SET status = 'Deleted' WHERE sessionVideoId = ?`, [
      id,
    ]);
    assert.equal((await driveSession(home.token, id)).status, 404);
    const row = await videoRow(id);
    assert.equal(row.status, "Deleted");
    assert.equal(row.delivery, "Server", "unchanged");
  });
});
