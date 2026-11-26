// CR-001 — Google Drive per court: staff connect a Google account on a court,
// and the player's page offers "Open in Google Drive". CR-040: the venue's
// recorder box sends each game straight to that Drive (the API opens the
// upload and checks the file); the API itself never uploads. CR-017 / CR-026:
// Drive copies go to the Drive's trash after their keep time.
// Google is a fake server here (OAuth token/revoke + Drive v3 files, resumable
// uploads, permissions), so nothing leaves the machine.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { gameJobs, keepGame, sendGameToDrive } from "./helpers/gameUpload.js";
import { startTestApp } from "./helpers/testApp.js";
import { insertLegacyClip, readyLegacyClip } from "./helpers/legacyClip.js";
import { DRIVE_SCOPE, fakeGoogle } from "./helpers/fakeGoogle.js";

describe("Google Drive per court", () => {
  let ctx;
  let admin;
  let viewer;
  let google;
  let runDriveCleanup;
  let runClipMaintenance;
  let db;
  const home = {};

  const call = (method, url, body, who = admin) => ctx.api(method, url, { token: who.token, body });
  const court = async (courtId = home.courtId) =>
    (await call("GET", `/admin/courts/${courtId}`)).data.court;

  /** Connect a court through the real consent round trip. @returns the redirect target */
  const connect = async (email, courtId = home.courtId) => {
    const started = await call("POST", `/admin/courts/${courtId}/google-drive/connect`);
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const consent = new URL(started.data.url);
    return callback({ code: email, state: consent.searchParams.get("state") });
  };
  const callback = async (query) => {
    const res = await ctx.get(`/api/v1/oauth/google/callback?${new URLSearchParams(query)}`, {
      redirect: "manual",
    });
    assert.equal(res.status, 303);
    return new URL(res.headers.get("location"));
  };

  /** "YYYY-MM-DD HH:mm:ss" in Manila, `minutes` from now. */
  const manila = async (minutes) =>
    (
      await ctx.sql.query(
        `SELECT DATE_FORMAT(DATE_ADD(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'),
                 INTERVAL ? SECOND), '%Y-%m-%d %H:%i:%s') AS t`,
        [Math.round(minutes * 60)]
      )
    )[0][0].t;

  /**
   * A paid game on `courtId` that ran 12 → 2 minutes ago, with its game job.
   * @returns {{ sessionId, shareToken, sessionVideoId }}
   */
  const endedGame = async (courtId = home.courtId, { playerName } = {}) => {
    const created = await call("POST", "/admin/sessions", {
      courtId,
      startAt: await manila(1),
      durationMinutes: 5,
      ...(playerName ? { playerName } : {}),
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const { sessionId, shareUrl } = created.data;
    // CR-039 / CR-046: games are free — nothing to pay before the videos open
    await ctx.sql.query(
      `UPDATE recording_sessions SET startAt = ?, endAt = ? WHERE sessionId = ?`,
      [await manila(-12), await manila(-2), sessionId]
    );
    const jobs = await gameJobs(ctx, home.token, sessionId);
    assert.equal(jobs.length, 1, "one file for the whole game");
    return {
      sessionId,
      shareToken: shareUrl.split("/").pop(),
      sessionVideoId: jobs[0].sessionVideoId,
    };
  };
  /** A game the box sent to the court's Drive. */
  const sentGame = async (courtId = home.courtId, opts = {}) => {
    const game = await endedGame(courtId, opts);
    const sent = await sendGameToDrive(ctx, home.token, game.sessionVideoId);
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    return game;
  };
  const videoRow = async (sessionVideoId) =>
    (
      await ctx.sql.query(
        `SELECT status, driveStatus, driveFileId, driveUrl, driveError, expiresAt
         FROM session_videos WHERE sessionVideoId = ?`,
        [sessionVideoId]
      )
    )[0][0];
  const sessionPage = async (shareToken) =>
    (await ctx.api("GET", `/public/sessions/${shareToken}`)).data.session;

  /**
   * A replay saved before CR-027 whose copy is in the court's Drive (the API
   * uploaded those before CR-040), owned by `owner`.
   */
  const replayOnDrive = async (owner = "alice@club.test") => {
    const clip = await insertLegacyClip(ctx.sql, { courtId: home.courtId });
    await readyLegacyClip(ctx.sql, clip.clipId);
    const driveFileId = `seeded-${clip.clipId.slice(0, 8)}`;
    google.state.files.set(driveFileId, { name: "replay.mp4", parents: [], owner, shared: true });
    await ctx.sql.query(
      `UPDATE clips SET driveStatus = 'Uploaded', driveFileId = ?, driveUrl = ?,
              driveUploadedAt = dateCreated
       WHERE clipId = ?`,
      [driveFileId, `https://drive.test/file/${driveFileId}`, clip.clipId]
    );
    return clip;
  };

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
    ({ runDriveCleanup } = await ctx.importFromBack("server/src/jobs/driveCleanup.js"));
    ({ runClipMaintenance } = await ctx.importFromBack("server/src/jobs/clipMaintenance.js"));
    db = ctx.db;
    admin = await ctx.createStaff("Admin", { access: "write" });
    viewer = await ctx.createStaff("Viewer", { access: "read" });

    home.venueId = (await call("POST", "/admin/venues", { name: "Drive Courts" })).data.venueId;
    const created = await call("POST", "/admin/courts", {
      venueId: home.venueId,
      name: "Court 1",
      cameraRtspUrl: "rtsp://u:p@10.0.0.7:554/stream1",
    });
    home.courtId = created.data.courtId;
    const second = await call("POST", "/admin/courts", {
      venueId: home.venueId,
      name: "Court 2",
      cameraRtspUrl: "rtsp://u:p@10.0.0.8:554/stream1",
    });
    home.court2Id = second.data.courtId;
    home.token = (await ctx.pairBox(admin.token, home.venueId, "Box")).data.token;
  });
  after(async () => {
    await ctx?.stop();
    google?.server.close();
  });

  describe("connecting a court", () => {
    it("starts disconnected, and read-only staff can't connect", async () => {
      const shown = await court();
      assert.deepEqual(
        {
          configured: shown.googleDrive.configured,
          connected: shown.googleDrive.connected,
          email: shown.googleDrive.email,
        },
        { configured: true, connected: false, email: null }
      );
      const denied = await call(
        "POST",
        `/admin/courts/${home.courtId}/google-drive/connect`,
        undefined,
        viewer
      );
      assert.equal(denied.status, 403);
      assert.equal((await court()).googleDrive.connected, false, "a viewer still sees the status");
    });

    it("sends staff to Google's consent screen for Drive files only, offline", async () => {
      const started = await call("POST", `/admin/courts/${home.courtId}/google-drive/connect`);
      const consent = new URL(started.data.url);
      assert.ok(consent.href.startsWith(`http://127.0.0.1:${google.server.address().port}/auth?`));
      assert.equal(consent.searchParams.get("client_id"), "test-client");
      assert.equal(consent.searchParams.get("access_type"), "offline");
      assert.deepEqual(consent.searchParams.get("scope").split(" "), [
        "openid",
        "email",
        DRIVE_SCOPE,
      ]);
      assert.ok(consent.searchParams.get("state"));
    });

    it("refuses a forged or garbled state and changes nothing", async () => {
      const back = await callback({ code: "eve@evil.test", state: "v1:AAAA:BBBB:CCCC" });
      assert.equal(back.pathname, "/admin/setup/venues");
      assert.equal(back.searchParams.get("drive"), "error");
      assert.equal((await court()).googleDrive.connected, false);
      assert.equal(google.state.refresh.size, 0, "the code was never traded");
    });

    it("comes back with an error when the Drive permission was left unticked", async () => {
      const back = await connect("nodrive:alice@club.test");
      assert.equal(back.searchParams.get("drive"), "error");
      assert.match(back.searchParams.get("reason"), /permission to add files/);
      assert.equal((await court()).googleDrive.connected, false);
    });

    it("stores the sign-in encrypted, shows the email, never the token", async () => {
      const back = await connect("alice@club.test");
      assert.equal(back.origin, "http://web.test");
      assert.equal(back.pathname, `/admin/setup/venues/${home.venueId}/courts/${home.courtId}`);
      assert.equal(back.searchParams.get("drive"), "connected");

      const shown = await court();
      assert.equal(shown.googleDrive.connected, true);
      assert.equal(shown.googleDrive.email, "alice@club.test");
      assert.equal(shown.googleDrive.status, "Connected");
      assert.deepEqual(shown.googleDrive.queue, {
        waiting: 0,
        failed: 0,
        lastUploadedAt: null,
        lastError: null,
      });
      assert.doesNotMatch(JSON.stringify(shown), /refresh-/);

      const [[row]] = await ctx.sql.query(
        `SELECT driveRefreshToken, driveConnectedBy FROM courts WHERE courtId = ?`,
        [home.courtId]
      );
      assert.ok(row.driveRefreshToken.startsWith("v1:"), "encrypted at rest");
      assert.doesNotMatch(row.driveRefreshToken, /refresh-/);
      assert.equal(row.driveConnectedBy, admin.accountId);

      const list = await call("GET", `/admin/courts?venueId=${home.venueId}`);
      assert.doesNotMatch(JSON.stringify(list.body), /refresh-|v1:/);

      const [audit] = await ctx.sql.query(
        `SELECT accountId, description, metadata FROM audit_trail
         WHERE module = 'courts' AND description LIKE 'Connected Google Drive%'`
      );
      assert.equal(audit.length, 1);
      assert.equal(audit[0].accountId, admin.accountId);
      assert.doesNotMatch(JSON.stringify(audit), /refresh-/);
    });

    it("treats a deleted court as missing and leaves it alone", async () => {
      const gone = await call("POST", "/admin/courts", {
        venueId: home.venueId,
        name: "Gone",
      });
      const goneId = gone.data.courtId;
      // A state issued while the court still existed…
      const started = await call("POST", `/admin/courts/${goneId}/google-drive/connect`);
      const state = new URL(started.data.url).searchParams.get("state");
      assert.equal((await call("DELETE", `/admin/courts/${goneId}`)).status, 200);

      assert.equal(
        (await call("POST", `/admin/courts/${goneId}/google-drive/connect`)).status,
        404
      );
      assert.equal((await call("DELETE", `/admin/courts/${goneId}/google-drive`)).status, 404);
      // …is useless once it is deleted
      const back = await callback({ code: "mallory@club.test", state });
      assert.equal(back.searchParams.get("drive"), "error");
      const [[row]] = await ctx.sql.query(
        `SELECT status, driveRefreshToken, driveEmail FROM courts WHERE courtId = ?`,
        [goneId]
      );
      assert.deepEqual(
        { ...row },
        { status: "Deleted", driveRefreshToken: null, driveEmail: null }
      );
    });
  });

  describe("a game from the venue box (CR-040)", () => {
    it("puts a whole game in its own shared folder, as one video", async () => {
      const game = await sentGame(home.courtId, { playerName: "Drive Player" });
      const row = await videoRow(game.sessionVideoId);
      assert.equal(row.status, "Ready");
      assert.equal(row.driveStatus, "Uploaded");

      const file = google.state.files.get(row.driveFileId);
      assert.equal(file.owner, "alice@club.test");
      assert.equal(file.shared, true, "anyone with the link");
      assert.equal(file.name, "Whole game.mp4");
      const [[session]] = await ctx.sql.query(
        `SELECT driveFolderId, driveUrl FROM recording_sessions WHERE sessionId = ?`,
        [game.sessionId]
      );
      const folder = google.state.files.get(session.driveFolderId);
      assert.equal(file.parents[0], session.driveFolderId);
      assert.match(folder.name, / game$/);
      assert.equal(folder.shared, true, "players open the game's folder");
      const courtFolder = google.state.files.get(folder.parents[0]);
      assert.equal(courtFolder.name, "DGSports · Drive Courts · Court 1");
      assert.equal(courtFolder.shared, false, "the court's folder itself stays private");

      const page = await sessionPage(game.shareToken);
      assert.equal(page.driveUrl, session.driveUrl);
      assert.equal(page.videos[0].driveUrl, `https://drive.test/file/${row.driveFileId}`);
      assert.equal("videoUrl" in page.videos[0], false, "no file link from the API");
      assert.equal((await court()).googleDrive.queue.waiting, 0);

      // Staff get the game's Drive folder link in Sessions, for the QR dialog
      const listed = await call("GET", `/admin/sessions?courtId=${home.courtId}`);
      assert.equal(
        listed.data.sessions.find((g) => g.sessionId === game.sessionId).driveUrl,
        session.driveUrl
      );
      const one = await call("GET", `/admin/sessions/${game.sessionId}`);
      assert.equal(one.data.session.driveUrl, session.driveUrl);
    });

    it("re-creates the court's folder when it was deleted in Drive", async () => {
      const [[{ driveFolderId }]] = await ctx.sql.query(
        `SELECT driveFolderId FROM courts WHERE courtId = ?`,
        [home.courtId]
      );
      google.state.files.delete(driveFolderId);
      const game = await sentGame();
      const file = google.state.files.get((await videoRow(game.sessionVideoId)).driveFileId);
      const gameFolder = google.state.files.get(file.parents[0]);
      assert.notEqual(gameFolder.parents[0], driveFolderId);
      assert.ok(google.state.files.get(gameFolder.parents[0]));
    });

    it("hides the Drive link while a game is unpaid", async () => {
      const game = await sentGame();
      await ctx.sql.query(
        `UPDATE recording_sessions SET paymentStatus = 'Unpaid' WHERE sessionId = ?`,
        [game.sessionId]
      );
      let page = await sessionPage(game.shareToken);
      assert.equal(page.locked, true);
      assert.equal(page.driveUrl, null);
      assert.equal(page.videos[0].driveUrl, null);
      await ctx.sql.query(
        `UPDATE recording_sessions SET paymentStatus = 'Paid' WHERE sessionId = ?`,
        [game.sessionId]
      );
      page = await sessionPage(game.shareToken);
      assert.ok(page.videos[0].driveUrl);
    });

    it("a replay saved before CR-027: its Drive link only while kept and paid, never a file link", async () => {
      const clip = await replayOnDrive();
      let page = (await ctx.api("GET", `/public/clips/${clip.shareToken}`)).data.clip;
      assert.match(page.driveUrl, /^https:\/\/drive\.test\/file\//);
      for (const key of ["videoUrl", "downloadUrl", "thumbnailUrl"]) {
        assert.equal(key in page, false, key);
      }
      await ctx.sql.query(
        `UPDATE clips SET paymentStatus = 'Unpaid', price = 50 WHERE clipId = ?`,
        [clip.clipId]
      );
      page = (await ctx.api("GET", `/public/clips/${clip.shareToken}`)).data.clip;
      assert.equal(page.locked, true);
      assert.equal(page.driveUrl, null);
      await ctx.sql.query(
        `UPDATE clips SET paymentStatus = 'Paid', status = 'Expired' WHERE clipId = ?`,
        [clip.clipId]
      );
      page = (await ctx.api("GET", `/public/clips/${clip.shareToken}`)).data.clip;
      assert.equal(page.status, "Expired");
      assert.equal(page.driveUrl, null, "its Drive copy is on its way to the trash");
      // Leave nothing for the deletes below
      await runDriveCleanup(db);
    });
  });

  // CR-017: a video goes after the venue's days — in the court's Google Drive
  // by moving it to the trash
  describe("deleting after the venue's days (CR-017)", () => {
    const clipFull = async (clipId) =>
      (
        await ctx.sql.query(
          `SELECT status, expiresAt, driveStatus, driveUrl, driveFileId, driveDeleteAttempts,
                  driveDeletedAt, driveError, driveNextAttemptAt
           FROM clips WHERE clipId = ?`,
          [clipId]
        )
      )[0][0];
    const expireNow = (table, key, id) =>
      ctx.sql.query(
        `UPDATE ${table} SET expiresAt = DATE_SUB(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'),
                                                  INTERVAL 1 MINUTE)
         WHERE ${key} = ?`,
        [id]
      );

    it("keeps videos 7 days by default (CR-026), on the box and in Drive", async () => {
      const venue = await call("POST", "/admin/venues", { name: "Default Days" });
      assert.equal(venue.status, 201, JSON.stringify(venue.body));
      const [[{ clipRetentionDays }]] = await ctx.sql.query(
        `SELECT clipRetentionDays FROM venues WHERE venueId = ?`,
        [venue.data.venueId]
      );
      assert.equal(clipRetentionDays, 7);

      const game = await sentGame();
      const [[{ hours }]] = await ctx.sql.query(
        `SELECT TIMESTAMPDIFF(MINUTE, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'), expiresAt)
                  / 60 AS hours
         FROM session_videos WHERE sessionVideoId = ?`,
        [game.sessionVideoId]
      );
      // Drive Courts keeps the default 7 days too
      assert.ok(Math.abs(Number(hours) - 7 * 24) < 0.1, `expires in ${hours} h`);
    });

    it("moves the Drive copy to the trash when the video expires", async () => {
      const clip = await replayOnDrive();
      const { driveFileId } = await clipFull(clip.clipId);

      assert.deepEqual(await runDriveCleanup(db), {}, "nothing before it expires");
      assert.equal(google.state.files.get(driveFileId).trashed, undefined);

      await expireNow("clips", "clipId", clip.clipId);
      await runClipMaintenance(db);
      let row = await clipFull(clip.clipId);
      assert.equal(row.status, "Expired");
      assert.equal(row.driveStatus, "Uploaded", "expired first, then its Drive copy");
      const page = await ctx.api("GET", `/public/clips/${clip.shareToken}`);
      assert.equal(page.data.clip.driveUrl, null);

      assert.deepEqual(await runDriveCleanup(db), { trashed: 1 });
      row = await clipFull(clip.clipId);
      assert.equal(row.driveStatus, "Deleted");
      assert.equal(row.driveUrl, null);
      assert.ok(row.driveDeletedAt);
      assert.equal(google.state.files.get(driveFileId).trashed, true, "in the Drive's trash");
      assert.deepEqual(await runDriveCleanup(db), {}, "done once");
    });

    it("counts a copy already gone from Drive as deleted", async () => {
      const clip = await replayOnDrive();
      google.state.files.delete((await clipFull(clip.clipId)).driveFileId);
      await expireNow("clips", "clipId", clip.clipId);
      await runClipMaintenance(db);
      assert.deepEqual(await runDriveCleanup(db), { trashed: 1 });
      assert.equal((await clipFull(clip.clipId)).driveStatus, "Deleted");
    });

    it("retries a failed delete later", async () => {
      const clip = await replayOnDrive();
      await expireNow("clips", "clipId", clip.clipId);
      await runClipMaintenance(db);

      google.state.trashFail = { status: 503, body: { error: { message: "Backend Error" } } };
      assert.deepEqual(await runDriveCleanup(db), { retry: 1 });
      let row = await clipFull(clip.clipId);
      assert.equal(row.driveStatus, "Uploaded");
      assert.equal(row.driveDeleteAttempts, 1);
      assert.match(row.driveError, /Not deleted from Drive: .*Backend Error/);
      assert.deepEqual(await runDriveCleanup(db), {}, "not before its retry time");

      await ctx.sql.query(`UPDATE clips SET driveNextAttemptAt = NULL WHERE clipId = ?`, [
        clip.clipId,
      ]);
      assert.deepEqual(await runDriveCleanup(db), { trashed: 1 });
      row = await clipFull(clip.clipId);
      assert.equal(row.driveStatus, "Deleted");
      assert.equal(row.driveError, null);
    });

    it("waits while the court needs reconnecting, then deletes", async () => {
      const clip = await replayOnDrive();
      await expireNow("clips", "clipId", clip.clipId);
      await runClipMaintenance(db);

      await ctx.sql.query(`UPDATE courts SET driveStatus = 'NeedsReconnect' WHERE courtId = ?`, [
        home.courtId,
      ]);
      assert.deepEqual(await runDriveCleanup(db), {});
      assert.equal((await clipFull(clip.clipId)).driveStatus, "Uploaded");

      await ctx.sql.query(`UPDATE courts SET driveStatus = 'Connected' WHERE courtId = ?`, [
        home.courtId,
      ]);
      assert.deepEqual(await runDriveCleanup(db), { trashed: 1 });
    });

    it("trashes a game's video, then the game's folder once it's empty", async () => {
      const [[game]] = await ctx.sql.query(
        `SELECT sessionId, driveFolderId, shareToken FROM recording_sessions
         WHERE playerName = 'Drive Player'`
      );
      assert.ok(game.driveFolderId);
      const [[video]] = await ctx.sql.query(
        `SELECT sessionVideoId, driveFileId FROM session_videos
         WHERE sessionId = ? AND driveStatus = 'Uploaded'`,
        [game.sessionId]
      );

      await expireNow("session_videos", "sessionVideoId", video.sessionVideoId);
      await runClipMaintenance(db);
      const page = await sessionPage(game.shareToken);
      assert.equal(page.videos[0].status, "Expired");
      assert.equal(page.videos[0].driveUrl, null);
      assert.equal(page.driveUrl, null, "no folder link once nothing is kept");
      const staff = await call("GET", `/admin/sessions/${game.sessionId}`);
      assert.equal(staff.data.session.driveUrl, null, "nor in Sessions");

      assert.deepEqual(await runDriveCleanup(db), { trashed: 1, folder: 1 });
      assert.equal(google.state.files.get(video.driveFileId).trashed, true);
      assert.equal(google.state.files.get(game.driveFolderId).trashed, true);
      const [[after]] = await ctx.sql.query(
        `SELECT driveFolderId, driveUrl FROM recording_sessions WHERE sessionId = ?`,
        [game.sessionId]
      );
      assert.deepEqual(after, { driveFolderId: null, driveUrl: null });
      const [[{ driveStatus }]] = await ctx.sql.query(
        `SELECT driveStatus FROM session_videos WHERE sessionVideoId = ?`,
        [video.sessionVideoId]
      );
      assert.equal(driveStatus, "Deleted");
    });

    it("trashes an older replay's Drive copy 2 days after saving (CR-026)", async () => {
      const clip = await replayOnDrive();
      const { driveFileId } = await clipFull(clip.clipId);
      const savedDaysAgo = (days) =>
        ctx.sql.query(
          `UPDATE clips
           SET dateCreated = DATE_SUB(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'),
                                      INTERVAL ${days} * 24 * 60 + 1 MINUTE)
           WHERE clipId = ?`,
          [clip.clipId]
        );

      await savedDaysAgo(1);
      assert.equal((await runDriveCleanup(db)).trashed ?? 0, 0, "kept in Drive for 2 days");
      assert.equal(google.state.files.get(driveFileId).trashed, undefined);

      await savedDaysAgo(2);
      assert.deepEqual(await runDriveCleanup(db), { trashed: 1 });
      const row = await clipFull(clip.clipId);
      assert.equal(row.status, "Ready");
      assert.equal(row.driveStatus, "Deleted");
      assert.equal(google.state.files.get(driveFileId).trashed, true);
      const page = await ctx.api("GET", `/public/clips/${clip.shareToken}`);
      assert.equal(page.data.clip.driveUrl, null, "no Drive link once its copy is gone");
    });

    it("never touches the court's own folder", async () => {
      const [[{ driveFolderId }]] = await ctx.sql.query(
        `SELECT driveFolderId FROM courts WHERE courtId = ?`,
        [home.courtId]
      );
      assert.ok(!google.state.files.get(driveFolderId).trashed);
    });
  });

  // CR-018 (2026-11-20) / CR-040: Re-upload to Google Drive from Sessions sends
  // what the venue box kept
  describe("re-sending a game from Sessions (CR-018)", () => {
    const upload = async (sessionId) =>
      (await call("GET", `/admin/sessions/${sessionId}`)).data.session.driveUpload;

    it("shows a video the box kept, sends it again from the box, and it reaches Drive", async () => {
      const game = await endedGame();
      // Google dropped the sign-in while the box asked: kept on the box
      await ctx.sql.query(`UPDATE courts SET driveStatus = 'NeedsReconnect' WHERE courtId = ?`, [
        home.courtId,
      ]);
      const kept = await keepGame(ctx, home.token, game.sessionVideoId);
      assert.equal(kept.data.reason, "DRIVE_RECONNECT");
      await ctx.sql.query(`UPDATE courts SET driveStatus = 'Connected' WHERE courtId = ?`, [
        home.courtId,
      ]);

      let state = await upload(game.sessionId);
      assert.equal(state.status, "NotUploaded");
      assert.match(state.error, /reconnecting/);
      assert.equal(state.canReupload, true);

      const viewerTry = await call(
        "POST",
        `/admin/sessions/${game.sessionId}/drive-upload`,
        undefined,
        viewer
      );
      assert.equal(viewerTry.status, 403);

      const again = await call("POST", `/admin/sessions/${game.sessionId}/drive-upload`);
      assert.equal(again.status, 200, JSON.stringify(again.body));
      assert.match(again.body.message, /Sending 1 video to Google Drive from the venue box/);
      assert.equal(
        (await call("POST", `/admin/sessions/${game.sessionId}/drive-upload`)).status,
        409,
        "nothing more to send"
      );

      const jobs = await gameJobs(ctx, home.token, game.sessionId);
      assert.equal(jobs[0]?.sessionVideoId, game.sessionVideoId, "back to the same box");
      const sent = await sendGameToDrive(ctx, home.token, game.sessionVideoId);
      assert.equal(sent.status, 200, JSON.stringify(sent.body));
      state = await upload(game.sessionId);
      assert.equal(state.status, "Uploaded");
      assert.equal(state.canReupload, false);
      assert.ok((await call("GET", `/admin/sessions/${game.sessionId}`)).data.session.driveUrl);
    });

    it("refuses on a court without Google Drive, and for a missing game", async () => {
      const game = await endedGame(home.court2Id);
      const kept = await keepGame(ctx, home.token, game.sessionVideoId);
      assert.equal(kept.data.reason, "NO_DRIVE");
      const state = await upload(game.sessionId);
      assert.equal(state.status, "NoDrive");
      assert.equal(state.canReupload, false);
      assert.match(state.problem, /no Google Drive/);

      const res = await call("POST", `/admin/sessions/${game.sessionId}/drive-upload`);
      assert.equal(res.status, 409);
      assert.match(res.body.message, /no Google Drive connected/);
      assert.equal((await call("POST", "/admin/sessions/no-such-game/drive-upload")).status, 404);
    });
  });

  describe("changing and losing the account", () => {
    it("keeps games on the box while Google drops the sign-in, then sends them on reconnect", async () => {
      // Alice removes DGSports' access in her Google account
      for (const refresh of google.state.refresh.keys()) google.state.revoked.add(refresh);
      const game = await endedGame();
      const kept = await keepGame(ctx, home.token, game.sessionVideoId);
      assert.equal(kept.status, 200, JSON.stringify(kept.body));
      assert.equal(kept.data.drive, false);
      assert.equal(kept.data.reason, "DRIVE_RECONNECT");

      const shown = await court();
      assert.equal(shown.googleDrive.status, "NeedsReconnect");
      assert.match(shown.googleDrive.problem, /Reconnect/);
      assert.equal((await videoRow(game.sessionVideoId)).driveStatus, "Skipped");

      await connect("alice@club.test");
      assert.equal((await court()).googleDrive.status, "Connected");
      assert.equal((await videoRow(game.sessionVideoId)).status, "Pending", "the box sends it now");
      const sent = await sendGameToDrive(ctx, home.token, game.sessionVideoId);
      assert.equal(sent.status, 200, JSON.stringify(sent.body));
      assert.equal(
        google.state.files.get((await videoRow(game.sessionVideoId)).driveFileId).owner,
        "alice@club.test"
      );
    });

    it("switches to another account: new games go there, old links stay", async () => {
      const [[earlier]] = await ctx.sql.query(
        `SELECT sv.driveUrl FROM session_videos sv
         JOIN recording_sessions s ON s.sessionId = sv.sessionId
         WHERE s.courtId = ? AND sv.driveStatus = 'Uploaded' LIMIT 1`,
        [home.courtId]
      );
      // Court 2 also uses Alice's account — switching court 1 must not cut it off
      await connect("alice@club.test", home.court2Id);
      await connect("bob@club.test");
      assert.equal((await court()).googleDrive.email, "bob@club.test");

      const game = await sentGame();
      const file = google.state.files.get((await videoRow(game.sessionVideoId)).driveFileId);
      assert.equal(file.owner, "bob@club.test");
      assert.equal(google.state.files.get(file.parents[0]).owner, "bob@club.test");

      const [[still]] = await ctx.sql.query(
        `SELECT driveUrl FROM session_videos WHERE driveUrl = ?`,
        [earlier.driveUrl]
      );
      assert.ok(still, "the old link is kept");
      const aliceLive = [...google.state.refresh].some(
        ([refresh, email]) => email === "alice@club.test" && !google.state.revoked.has(refresh)
      );
      assert.ok(aliceLive, "Alice's grant stays: court 2 still uses it");
    });

    it("disconnects: the token is revoked, later games stay on the box", async () => {
      const viewerTry = await call(
        "DELETE",
        `/admin/courts/${home.courtId}/google-drive`,
        undefined,
        viewer
      );
      assert.equal(viewerTry.status, 403);

      const res = await call("DELETE", `/admin/courts/${home.courtId}/google-drive`);
      assert.equal(res.status, 200);
      const shown = await court();
      assert.equal(shown.googleDrive.connected, false);
      assert.equal(shown.googleDrive.email, null);
      const bobLive = [...google.state.refresh].some(
        ([refresh, email]) => email === "bob@club.test" && !google.state.revoked.has(refresh)
      );
      assert.equal(bobLive, false, "Bob's grant was given back");

      const game = await endedGame();
      const kept = await keepGame(ctx, home.token, game.sessionVideoId);
      assert.equal(kept.data.drive, false);
      assert.equal(kept.data.reason, "NO_DRIVE");
    });
  });
});
