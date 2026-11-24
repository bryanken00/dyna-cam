// CR-001 — Google Drive per court: staff connect a Google account on a court,
// every clip on it (replays and whole-game parts) is copied to that Drive and
// shared by link, and the player's page offers "Open in Google Drive".
// Google is a fake server here (OAuth token/revoke + Drive v3 files, resumable
// uploads, permissions), so nothing leaves the machine.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { gameJobs, sendGame } from "./helpers/gameUpload.js";
import { JPEG, startTestApp } from "./helpers/testApp.js";
import { insertLegacyClip } from "./helpers/legacyClip.js";

const MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from("ftypisom"),
  Buffer.alloc(64, 1),
]);
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/**
 * A fake Google. An authorization code is "<email>" (Drive ticked) or
 * "nodrive:<email>" (Drive left unticked). Files a sign-in made are visible
 * only to that same account (Drive's `drive.file` scope).
 */
const fakeGoogle = () => {
  const state = {
    refresh: new Map(), // refresh token → email
    revoked: new Set(),
    files: new Map(), // id → { name, parents, owner, mimeType, size, shared }
    sessions: new Map(), // upload session → { meta, owner, received }
    fail: null, // { status, body } to answer the next upload start with
    trashFail: null, // CR-017: { status, body } to answer the next "move to trash" with
    count: 0,
  };
  const next = (prefix) => `${prefix}-${++state.count}`;
  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };
  const ownerOf = (req) => {
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    const refresh = token.replace(/^access:/, "");
    if (!token.startsWith("access:") || state.revoked.has(refresh)) return null;
    return state.refresh.get(refresh) || null;
  };
  const visible = (id, owner) => {
    const file = state.files.get(id);
    return file && file.owner === owner ? file : null;
  };
  const read = (req) =>
    new Promise((resolve) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
    });

  /** Google's OAuth endpoints. @returns {boolean} handled */
  const oauth = (req, res, url, body) => {
    const params = new URLSearchParams(body.toString());
    if (req.method !== "POST") return false;
    if (url.pathname === "/token" && params.get("grant_type") === "authorization_code") {
      const code = params.get("code");
      const email = code.replace(/^nodrive:/, "");
      const refresh = next("refresh");
      state.refresh.set(refresh, email);
      const idToken = ["x", Buffer.from(JSON.stringify({ email })).toString("base64url"), "sig"];
      json(res, 200, {
        access_token: `access:${refresh}`,
        refresh_token: refresh,
        id_token: idToken.join("."),
        scope: code.startsWith("nodrive:") ? "openid email" : `openid email ${DRIVE_SCOPE}`,
      });
      return true;
    }
    if (url.pathname === "/token") {
      const refresh = params.get("refresh_token");
      if (!state.refresh.has(refresh) || state.revoked.has(refresh)) {
        json(res, 400, { error: "invalid_grant" });
      } else {
        json(res, 200, { access_token: `access:${refresh}` });
      }
      return true;
    }
    if (url.pathname === "/revoke") {
      const email = state.refresh.get(params.get("token"));
      // Revoking ends the account's whole grant to the app
      for (const [refresh, owner] of state.refresh) {
        if (owner === email) state.revoked.add(refresh);
      }
      json(res, 200, {});
      return true;
    }
    return false;
  };

  /** Drive v3 files, folders and permissions. @returns {boolean} handled */
  const files = (req, res, url, body, owner) => {
    if (req.method === "POST" && url.pathname === "/drive/files") {
      const meta = JSON.parse(body.toString());
      const parent = meta.parents?.[0];
      if (parent && !visible(parent, owner)) {
        json(res, 404, { error: { message: "nf" } });
        return true;
      }
      const id = next("folder");
      state.files.set(id, { ...meta, owner, shared: false });
      json(res, 200, { id, webViewLink: `https://drive.test/folders/${id}` });
      return true;
    }
    const match = url.pathname.match(/^\/drive\/files\/([^/]+)(\/permissions)?$/);
    if (!match) return false;
    const file = visible(match[1], owner);
    if (!file) {
      json(res, 404, { error: { message: "File not found" } });
    } else if (match[2] && req.method === "POST") {
      const permission = JSON.parse(body.toString());
      file.shared = permission.type === "anyone" && permission.role === "reader";
      json(res, 200, { id: "anyoneWithLink" });
    } else if (req.method === "PATCH") {
      // CR-017: { trashed: true } moves it to the owner's trash
      if (state.trashFail) {
        json(res, state.trashFail.status, state.trashFail.body);
        state.trashFail = null;
      } else {
        file.trashed = Boolean(JSON.parse(body.toString()).trashed);
        json(res, 200, { id: match[1], trashed: file.trashed });
      }
    } else {
      json(res, 200, { id: match[1], trashed: Boolean(file.trashed) });
    }
    return true;
  };

  /** Drive's resumable uploads: start a session, then PUT the bytes. @returns {boolean} handled */
  const uploads = (req, res, url, body, owner) => {
    if (req.method === "POST" && url.pathname === "/upload/files") {
      const meta = JSON.parse(body.toString());
      if (state.fail) {
        json(res, state.fail.status, state.fail.body);
        state.fail = null;
      } else if (!visible(meta.parents?.[0], owner)) {
        json(res, 404, { error: { message: "nf" } });
      } else {
        const session = next("upload");
        const size = Number(req.headers["x-upload-content-length"]);
        state.sessions.set(session, { meta, owner, size, received: 0 });
        res.writeHead(200, { Location: `http://${req.headers.host}/session/${session}` });
        res.end();
      }
      return true;
    }
    const match = url.pathname.match(/^\/session\/(.+)$/);
    if (req.method !== "PUT" || !match) return false;
    const upload = state.sessions.get(match[1]);
    if (!upload) {
      json(res, 404, {});
      return true;
    }
    upload.received += body.length;
    if (upload.received < upload.size) {
      res.writeHead(308, { Range: `bytes=0-${upload.received - 1}` });
      res.end();
      return true;
    }
    const id = next("file");
    state.files.set(id, { ...upload.meta, owner, size: upload.received, shared: false });
    json(res, 200, { id, webViewLink: `https://drive.test/file/${id}` });
    return true;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://fake");
    const body = await read(req);
    if (oauth(req, res, url, body)) return;
    const owner = ownerOf(req);
    if (!owner) {
      json(res, 401, { error: { message: "Invalid Credentials" } });
      return;
    }
    if (files(req, res, url, body, owner) || uploads(req, res, url, body, owner)) return;
    json(res, 404, { error: { message: `fake: ${req.method} ${url.pathname}` } });
  });

  return { server, state };
};

describe("Google Drive per court", () => {
  let ctx;
  let admin;
  let viewer;
  let google;
  let runDriveUploads;
  let runDriveCleanup;
  let runClipMaintenance;
  let db;
  const home = {};

  const call = (method, url, body, who = admin) => ctx.api(method, url, { token: who.token, body });
  const asDevice =
    (token) =>
    (method, url, options = {}) =>
      ctx.api(method, url, { ...options, headers: { Authorization: `Device ${token}` } });
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

  /** A replay saved before CR-027, cut and uploaded by the box. @returns {{ clipId, shareToken }} */
  const replay = async (courtId = home.courtId) => {
    const row = await insertLegacyClip(ctx.sql, { courtId });
    const uploaded = await home.device("POST", `/device/clips/${row.clipId}/upload`, {
      form: [
        ["video", MP4, "video/mp4", "clip.mp4"],
        ["thumbnail", JPEG, "image/jpeg", "t.jpg"],
      ],
    });
    assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
    return { clipId: row.clipId, shareToken: row.shareToken };
  };
  const clipRow = async (clipId) =>
    (
      await ctx.sql.query(
        `SELECT driveStatus, driveFileId, driveUrl, driveAttempts, driveError FROM clips
         WHERE clipId = ?`,
        [clipId]
      )
    )[0][0];

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
        // Many replays from one court QR in this file
        RATE_LIMIT_PUBLIC_CLIP_POINTS: "1000",
      },
    });
    ({ runDriveUploads } = await ctx.importFromBack("server/src/jobs/driveUploads.js"));
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
    home.qrToken = created.data.qrToken;
    const second = await call("POST", "/admin/courts", {
      venueId: home.venueId,
      name: "Court 2",
      cameraRtspUrl: "rtsp://u:p@10.0.0.8:554/stream1",
    });
    home.court2Id = second.data.courtId;
    home.token = (await ctx.pairBox(admin.token, home.venueId, "Box")).data.token;
    home.device = asDevice(home.token);
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

  describe("uploading", () => {
    let first;

    it("copies a replay into the court's folder and shares it by link", async () => {
      first = await replay();
      assert.equal((await clipRow(first.clipId)).driveStatus, "Pending");
      assert.equal((await court()).googleDrive.queue.waiting, 1);

      const tally = await runDriveUploads(db);
      assert.deepEqual(tally, { uploaded: 1 });

      const row = await clipRow(first.clipId);
      assert.equal(row.driveStatus, "Uploaded");
      const file = google.state.files.get(row.driveFileId);
      assert.equal(file.owner, "alice@club.test");
      assert.equal(file.shared, true, "anyone with the link");
      assert.equal(file.size, MP4.length);
      assert.match(file.name, /Court 1 replay\.mp4$/);
      const folder = google.state.files.get(file.parents[0]);
      assert.equal(folder.name, "DGSports · Drive Courts · Court 1");
      assert.equal(folder.shared, false, "the court's folder itself stays private");

      const page = await ctx.api("GET", `/public/clips/${first.shareToken}`);
      assert.equal(page.data.clip.driveUrl, `https://drive.test/file/${row.driveFileId}`);

      const listed = await call("GET", `/admin/clips?courtId=${home.courtId}`);
      const found = listed.data.clips.find((c) => c.clipId === first.clipId);
      assert.equal(found.driveStatus, "Uploaded");
      assert.equal(found.driveUrl, row.driveUrl);
    });

    it("hides the Drive link while a clip is unpaid", async () => {
      await ctx.sql.query(
        `UPDATE clips SET paymentStatus = 'Unpaid', price = 50 WHERE clipId = ?`,
        [first.clipId]
      );
      let page = await ctx.api("GET", `/public/clips/${first.shareToken}`);
      assert.equal(page.data.clip.locked, true);
      assert.equal(page.data.clip.driveUrl, null);
      await ctx.sql.query(`UPDATE clips SET paymentStatus = 'Paid' WHERE clipId = ?`, [
        first.clipId,
      ]);
      page = await ctx.api("GET", `/public/clips/${first.shareToken}`);
      assert.ok(page.data.clip.driveUrl);
    });

    it("hides the Drive link once the server's copy expires (CR-017)", async () => {
      await ctx.sql.query(
        `UPDATE clips SET status = 'Expired', videoPath = NULL, thumbnailPath = NULL
         WHERE clipId = ?`,
        [first.clipId]
      );
      const page = await ctx.api("GET", `/public/clips/${first.shareToken}`);
      assert.equal(page.data.clip.status, "Expired");
      assert.equal(page.data.clip.videoUrl, null);
      assert.equal(page.data.clip.driveUrl, null, "its Drive copy is on its way to the trash");
    });

    it("re-creates the court's folder when it was deleted in Drive", async () => {
      const [[{ driveFolderId }]] = await ctx.sql.query(
        `SELECT driveFolderId FROM courts WHERE courtId = ?`,
        [home.courtId]
      );
      google.state.files.delete(driveFolderId);
      const clip = await replay();
      assert.deepEqual(await runDriveUploads(db), { uploaded: 1 });
      const file = google.state.files.get((await clipRow(clip.clipId)).driveFileId);
      assert.notEqual(file.parents[0], driveFolderId);
      assert.ok(google.state.files.get(file.parents[0]));
    });

    it("retries a temporary Google failure later, then uploads", async () => {
      const clip = await replay();
      google.state.fail = { status: 503, body: { error: { message: "Backend Error" } } };
      assert.deepEqual(await runDriveUploads(db), { retry: 1 });
      let row = await clipRow(clip.clipId);
      assert.equal(row.driveStatus, "Pending");
      assert.equal(row.driveAttempts, 1);
      assert.match(row.driveError, /Backend Error/);
      assert.match((await court()).googleDrive.queue.lastError, /Backend Error/);

      assert.deepEqual(await runDriveUploads(db), {}, "not before its retry time");
      await ctx.sql.query(`UPDATE clips SET driveNextAttemptAt = NULL WHERE clipId = ?`, [
        clip.clipId,
      ]);
      assert.deepEqual(await runDriveUploads(db), { uploaded: 1 });
      row = await clipRow(clip.clipId);
      assert.equal(row.driveStatus, "Uploaded");
      assert.equal(row.driveError, null);
    });

    it("puts a whole game in its own shared folder, as one video (CR-006)", async () => {
      const created = await call("POST", "/admin/sessions", {
        courtId: home.courtId,
        startAt: (
          await ctx.sql.query(
            `SELECT DATE_FORMAT(DATE_ADD(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'),
                 INTERVAL 1 MINUTE), '%Y-%m-%d %H:%i:%s') AS t`
          )
        )[0][0].t,
        durationMinutes: 5,
        playerName: "Drive Player",
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const { sessionId, shareUrl } = created.data;
      // CR-015: the Drive link shows on the player's page once the game is paid
      assert.equal(
        (await call("POST", "/admin/payments", { sessionId, amount: 250 })).status,
        201
      );
      await ctx.sql.query(
        `UPDATE recording_sessions
           SET startAt = DATE_SUB(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'), INTERVAL 12 MINUTE),
               endAt = DATE_SUB(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'), INTERVAL 2 MINUTE)
           WHERE sessionId = ?`,
        [sessionId]
      );
      const jobs = await gameJobs(ctx, home.token, sessionId);
      assert.equal(jobs.length, 1, "one file for the whole game");
      assert.deepEqual(await runDriveUploads(db), {}, "nothing in until the box sends it");
      const sent = await sendGame(ctx, home.token, jobs[0].sessionVideoId);
      assert.equal(sent.status, 200, JSON.stringify(sent.body));
      assert.deepEqual(await runDriveUploads(db), { uploaded: 1 });

      const [[session]] = await ctx.sql.query(
        `SELECT driveFolderId, driveUrl FROM recording_sessions WHERE sessionId = ?`,
        [sessionId]
      );
      const folder = google.state.files.get(session.driveFolderId);
      assert.match(folder.name, / game$/);
      assert.equal(folder.shared, true, "players open the game's folder");
      const files = [...google.state.files.values()].filter(
        (f) => f.parents?.[0] === session.driveFolderId
      );
      assert.deepEqual(
        files.map((f) => [f.name, f.shared]),
        [["Whole game.mp4", true]]
      );

      const page = await ctx.api("GET", `/public/sessions/${shareUrl.split("/").pop()}`);
      assert.equal(page.data.session.driveUrl, session.driveUrl);
      assert.ok(page.data.session.videos[0].driveUrl);
      assert.equal((await court()).googleDrive.queue.waiting, 0);

      // Staff get the game's Drive folder link in Sessions, for the QR dialog
      const listed = await call("GET", `/admin/sessions?courtId=${home.courtId}`);
      assert.equal(
        listed.data.sessions.find((g) => g.sessionId === sessionId).driveUrl,
        session.driveUrl
      );
      const one = await call("GET", `/admin/sessions/${sessionId}`);
      assert.equal(one.data.session.driveUrl, session.driveUrl);
    });
  });

  // CR-017: a video goes after the venue's days (1 by default) — on the server
  // and, by moving it to the trash, in the court's Google Drive
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
    /** A replay copied to Drive. */
    const uploadedReplay = async () => {
      const clip = await replay();
      await runDriveUploads(db);
      assert.equal((await clipFull(clip.clipId)).driveStatus, "Uploaded");
      return clip;
    };

    it("keeps videos 7 days by default (CR-026)", async () => {
      const venue = await call("POST", "/admin/venues", { name: "Default Days" });
      assert.equal(venue.status, 201, JSON.stringify(venue.body));
      const [[{ clipRetentionDays }]] = await ctx.sql.query(
        `SELECT clipRetentionDays FROM venues WHERE venueId = ?`,
        [venue.data.venueId]
      );
      assert.equal(clipRetentionDays, 7);

      const clip = await replay();
      const [[{ hours }]] = await ctx.sql.query(
        `SELECT TIMESTAMPDIFF(MINUTE, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'), expiresAt)
                  / 60 AS hours
         FROM clips WHERE clipId = ?`,
        [clip.clipId]
      );
      assert.ok(Math.abs(Number(hours) - 7 * 24) < 0.1, `expires in ${hours} h`);
      await runDriveUploads(db); // leave nothing pending for the next tests
    });

    it("moves the Drive copy to the trash when the server's copy expires", async () => {
      const clip = await uploadedReplay();
      const { driveFileId } = await clipFull(clip.clipId);

      assert.equal((await runDriveCleanup(db)).trashed ?? 0, 1, "only the clip expired earlier");
      assert.equal(google.state.files.get(driveFileId).trashed, undefined, "not before it expires");

      await expireNow("clips", "clipId", clip.clipId);
      await runClipMaintenance(db);
      let row = await clipFull(clip.clipId);
      assert.equal(row.status, "Expired");
      assert.equal(row.driveStatus, "Uploaded", "the server's copy goes first");
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
      const clip = await uploadedReplay();
      google.state.files.delete((await clipFull(clip.clipId)).driveFileId);
      await expireNow("clips", "clipId", clip.clipId);
      await runClipMaintenance(db);
      assert.deepEqual(await runDriveCleanup(db), { trashed: 1 });
      assert.equal((await clipFull(clip.clipId)).driveStatus, "Deleted");
    });

    it("retries a failed delete later", async () => {
      const clip = await uploadedReplay();
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
      const clip = await uploadedReplay();
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
        `SELECT sessionId, driveFolderId FROM recording_sessions WHERE playerName = 'Drive Player'`
      );
      assert.ok(game.driveFolderId);
      const [[video]] = await ctx.sql.query(
        `SELECT sessionVideoId, driveFileId FROM session_videos
         WHERE sessionId = ? AND driveStatus = 'Uploaded'`,
        [game.sessionId]
      );

      await expireNow("session_videos", "sessionVideoId", video.sessionVideoId);
      await runClipMaintenance(db);
      const page = await ctx.api(
        "GET",
        `/public/sessions/${(
          await ctx.sql.query(`SELECT shareToken FROM recording_sessions WHERE sessionId = ?`, [
            game.sessionId,
          ])
        )[0][0].shareToken}`
      );
      assert.equal(page.data.session.videos[0].status, "Expired");
      assert.equal(page.data.session.videos[0].driveUrl, null);
      assert.equal(page.data.session.driveUrl, null, "no folder link once nothing is kept");
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

    /** Pretend the video was saved `days` ago (the Drive clock, CR-026). */
    const savedDaysAgo = (table, key, id, days) =>
      ctx.sql.query(
        `UPDATE ${table}
         SET dateCreated = DATE_SUB(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'),
                                    INTERVAL ${days} * 24 * 60 + 1 MINUTE)
         WHERE ${key} = ?`,
        [id]
      );

    it("trashes the Drive copy 2 days after saving while the server keeps the video (CR-026)", async () => {
      const clip = await uploadedReplay();
      const { driveFileId } = await clipFull(clip.clipId);

      await savedDaysAgo("clips", "clipId", clip.clipId, 1);
      assert.equal((await runDriveCleanup(db)).trashed ?? 0, 0, "kept in Drive for 2 days");
      assert.equal(google.state.files.get(driveFileId).trashed, undefined);

      await savedDaysAgo("clips", "clipId", clip.clipId, 2);
      assert.deepEqual(await runDriveCleanup(db), { trashed: 1 });
      const row = await clipFull(clip.clipId);
      assert.equal(row.status, "Ready", "the server still keeps it");
      assert.equal(row.driveStatus, "Deleted");
      assert.equal(google.state.files.get(driveFileId).trashed, true);

      const page = await ctx.api("GET", `/public/clips/${clip.shareToken}`);
      assert.ok(page.data.clip.videoUrl, "still plays from the server");
      assert.equal(page.data.clip.driveUrl, null, "no Drive link once its copy is gone");
    });

    it("skips copying a video to Drive once it's past the 2 days (CR-026)", async () => {
      const clip = await replay();
      await savedDaysAgo("clips", "clipId", clip.clipId, 2);
      assert.deepEqual(await runDriveUploads(db), {});
      const row = await clipFull(clip.clipId);
      assert.equal(row.driveStatus, "Skipped");
      assert.match(row.driveError, /keeps videos only 2 days/);
    });

    it("never touches the court's own folder", async () => {
      const [[{ driveFolderId }]] = await ctx.sql.query(
        `SELECT driveFolderId FROM courts WHERE courtId = ?`,
        [home.courtId]
      );
      assert.ok(!google.state.files.get(driveFolderId).trashed);
    });
  });

  // CR-018 (2026-11-20): Re-upload to Google Drive from Sessions
  describe("re-uploading a game from Sessions (CR-018)", () => {
    /** A finished, paid game on `courtId` whose video the box has sent. */
    const sentGame = async (courtId) => {
      const created = await call("POST", "/admin/sessions", {
        courtId,
        startAt: (
          await ctx.sql.query(
            `SELECT DATE_FORMAT(DATE_ADD(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'),
                 INTERVAL 1 MINUTE), '%Y-%m-%d %H:%i:%s') AS t`
          )
        )[0][0].t,
        durationMinutes: 5,
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const { sessionId } = created.data;
      await call("POST", "/admin/payments", { sessionId, amount: 250 });
      await ctx.sql.query(
        `UPDATE recording_sessions
           SET startAt = DATE_SUB(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'), INTERVAL 12 MINUTE),
               endAt = DATE_SUB(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'), INTERVAL 2 MINUTE)
           WHERE sessionId = ?`,
        [sessionId]
      );
      const jobs = await gameJobs(ctx, home.token, sessionId);
      const sent = await sendGame(ctx, home.token, jobs[0].sessionVideoId);
      assert.equal(sent.status, 200, JSON.stringify(sent.body));
      return sessionId;
    };
    const upload = async (sessionId) =>
      (await call("GET", `/admin/sessions/${sessionId}`)).data.session.driveUpload;

    it("shows a failed upload, re-queues it, and it uploads", async () => {
      const sessionId = await sentGame(home.courtId);
      google.state.fail = { status: 400, body: { error: { message: "Invalid metadata" } } };
      assert.deepEqual(await runDriveUploads(db), { failed: 1 });

      let state = await upload(sessionId);
      assert.equal(state.status, "Failed");
      assert.match(state.error, /Invalid metadata/);
      assert.equal(state.canReupload, true);
      const listed = await call("GET", `/admin/sessions?courtId=${home.courtId}`);
      assert.equal(
        listed.data.sessions.find((g) => g.sessionId === sessionId).driveUpload.status,
        "Failed"
      );

      const viewerTry = await call(
        "POST",
        `/admin/sessions/${sessionId}/drive-upload`,
        undefined,
        viewer
      );
      assert.equal(viewerTry.status, 403);

      const again = await call("POST", `/admin/sessions/${sessionId}/drive-upload`);
      assert.equal(again.status, 200, JSON.stringify(again.body));
      assert.match(again.body.message, /Uploading 1 video/);
      assert.equal(again.data.session.driveUpload.status, "Uploading");
      assert.equal(
        (await call("POST", `/admin/sessions/${sessionId}/drive-upload`)).status,
        409,
        "nothing more to queue"
      );

      assert.deepEqual(await runDriveUploads(db), { uploaded: 1 });
      state = await upload(sessionId);
      assert.equal(state.status, "Uploaded");
      assert.equal(state.canReupload, false);
      assert.ok((await call("GET", `/admin/sessions/${sessionId}`)).data.session.driveUrl);
    });

    it("refuses on a court without Google Drive, and for a missing game", async () => {
      const sessionId = await sentGame(home.court2Id);
      const state = await upload(sessionId);
      assert.equal(state.status, "NoDrive");
      assert.equal(state.canReupload, false);
      assert.match(state.problem, /no Google Drive/);

      const res = await call("POST", `/admin/sessions/${sessionId}/drive-upload`);
      assert.equal(res.status, 409);
      assert.match(res.body.message, /no Google Drive connected/);
      assert.equal(
        (await call("POST", "/admin/sessions/no-such-game/drive-upload")).status,
        404
      );
    });
  });

  describe("large files", () => {
    it("uploads in 8 MB chunks, resuming where Google says it stopped", async () => {
      const { uploadFile } = await ctx.importFromBack("server/src/utils/googleDrive.js");
      const [refresh] = [...google.state.refresh].find(
        ([token, email]) => email === "alice@club.test" && !google.state.revoked.has(token)
      );
      const [[{ driveFolderId }]] = await ctx.sql.query(
        `SELECT driveFolderId FROM courts WHERE courtId = ?`,
        [home.courtId]
      );
      const big = path.join(ctx.workDir, "big.mp4");
      fs.writeFileSync(big, Buffer.alloc(9 * 1024 * 1024 + 123, 7));
      const file = await uploadFile(`access:${refresh}`, {
        filePath: big,
        name: "big.mp4",
        parentId: driveFolderId,
      });
      assert.equal(google.state.files.get(file.id).size, 9 * 1024 * 1024 + 123);
    });
  });

  describe("changing and losing the account", () => {
    it("waits for a reconnect when Google drops the sign-in, then uploads", async () => {
      // Alice removes DGSports' access in her Google account
      for (const refresh of google.state.refresh.keys()) google.state.revoked.add(refresh);
      const clip = await replay();
      assert.deepEqual(await runDriveUploads(db), { waiting: 1 });

      const shown = await court();
      assert.equal(shown.googleDrive.status, "NeedsReconnect");
      assert.match(shown.googleDrive.problem, /Reconnect/);
      assert.equal((await clipRow(clip.clipId)).driveStatus, "Pending");
      assert.deepEqual(await runDriveUploads(db), {}, "held while the court needs reconnecting");

      await connect("alice@club.test");
      assert.equal((await court()).googleDrive.status, "Connected");
      assert.deepEqual(await runDriveUploads(db), { uploaded: 1 });
      assert.equal(
        google.state.files.get((await clipRow(clip.clipId)).driveFileId).owner,
        "alice@club.test"
      );
    });

    it("switches to another account: new clips go there, old links stay", async () => {
      const [[earlier]] = await ctx.sql.query(
        `SELECT driveUrl FROM clips WHERE courtId = ? AND driveStatus = 'Uploaded' LIMIT 1`,
        [home.courtId]
      );
      // Court 2 also uses Alice's account — switching court 1 must not cut it off
      await connect("alice@club.test", home.court2Id);
      await connect("bob@club.test");
      const shown = await court();
      assert.equal(shown.googleDrive.email, "bob@club.test");

      const clip = await replay();
      assert.deepEqual(await runDriveUploads(db), { uploaded: 1 });
      const file = google.state.files.get((await clipRow(clip.clipId)).driveFileId);
      assert.equal(file.owner, "bob@club.test");
      assert.equal(google.state.files.get(file.parents[0]).owner, "bob@club.test");

      const [[still]] = await ctx.sql.query(`SELECT driveUrl FROM clips WHERE driveUrl = ?`, [
        earlier.driveUrl,
      ]);
      assert.ok(still, "the old link is kept");
      const aliceLive = [...google.state.refresh].some(
        ([refresh, email]) => email === "alice@club.test" && !google.state.revoked.has(refresh)
      );
      assert.ok(aliceLive, "Alice's grant stays: court 2 still uses it");
    });

    it("disconnects: waiting clips are skipped, the token is revoked", async () => {
      const clip = await replay();
      assert.equal((await clipRow(clip.clipId)).driveStatus, "Pending");

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

      const row = await clipRow(clip.clipId);
      assert.equal(row.driveStatus, "Skipped");
      const bobLive = [...google.state.refresh].some(
        ([refresh, email]) => email === "bob@club.test" && !google.state.revoked.has(refresh)
      );
      assert.equal(bobLive, false, "Bob's grant was given back");

      const later = await replay();
      assert.equal((await clipRow(later.clipId)).driveStatus, null, "not queued any more");
    });
  });
});
