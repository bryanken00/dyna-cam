// PLAN-001 — the clip pipeline end to end:
// player scans the court QR → clip Pending → recorder box picks it up, cuts it,
// uploads it → player's share link plays it → it expires.
// Also: a box can only ever touch its own venue's clips.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { JPEG, PNG, startTestApp } from "./helpers/testApp.js";

// The smallest buffer that passes the API's mp4 content check (an ISO media "ftyp" box)
const MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from("ftypisom"),
  Buffer.alloc(64, 1),
]);

describe("clips", () => {
  let ctx;
  let admin;
  const home = {}; // venue + court + box the player uses
  const other = {}; // a second venue's box, which must not see home's clips

  const call = (method, url, body) => ctx.api(method, url, { token: admin.token, body });
  const asDevice =
    (token) =>
    (method, url, options = {}) =>
      ctx.api(method, url, { ...options, headers: { Authorization: `Device ${token}` } });

  const setupVenue = async (target, name) => {
    const venue = await call("POST", "/admin/venues", { name, clipRetentionDays: 30 });
    target.venueId = venue.data.venueId;
    const court = await call("POST", "/admin/courts", {
      venueId: target.venueId,
      name: "Court 1",
      cameraRtspUrl: "rtsp://user:pass@10.0.0.5:554/main",
    });
    target.courtId = court.data.courtId;
    target.qrToken = court.data.qrToken;
    const box = await call("POST", "/admin/devices", { venueId: target.venueId, name: "Box" });
    target.device = asDevice(box.data.token);
    target.deviceId = box.data.deviceId;
  };

  const uploadForm = (
    video = MP4,
    thumbnail = JPEG,
    thumbType = "image/jpeg",
    thumbName = "t.jpg"
  ) => [
    ["video", video, "video/mp4", "clip.mp4"],
    ["thumbnail", thumbnail, thumbType, thumbName],
  ];

  /** Make the court's last clip old enough that a new save is not merged into it. */
  const ageClips = (courtId) =>
    ctx.sql.query(
      `UPDATE clips SET requestedAt = DATE_SUB(requestedAt, INTERVAL 1 MINUTE) WHERE courtId = ?`,
      [courtId]
    );

  before(async () => {
    ctx = await startTestApp();
    admin = await ctx.createStaff("Admin", { access: "write" });
    await setupVenue(home, "Home Courts");
    await setupVenue(other, "Other Courts");
  });
  after(() => ctx?.stop());

  it("won't save a clip while the court's recorder box is offline", async () => {
    const court = await ctx.api("GET", `/public/courts/${home.qrToken}`);
    assert.equal(court.status, 200);
    assert.equal(court.data.court.cameraReady, false);
    assert.equal(court.data.court.venueName, "Home Courts");
    assert.equal(court.data.court.courtId, undefined, "no IDs on the public page");

    const save = await ctx.api("POST", `/public/courts/${home.qrToken}/clips`);
    assert.equal(save.status, 503);
    assert.equal(save.body.code, "CAMERA_OFFLINE");
  });

  it("gives the box its own courts, with the camera URL decrypted", async () => {
    const heartbeat = await home.device("POST", "/device/heartbeat", {
      body: {
        agentVersion: "0.1.0",
        cameras: [
          { courtId: home.courtId, status: "ok" },
          { courtId: other.courtId, status: "ok" }, // not this box's court — dropped
        ],
      },
    });
    assert.equal(heartbeat.status, 200);

    const config = await home.device("GET", "/device/config");
    assert.equal(config.status, 200);
    assert.deepEqual(
      config.data.courts.map((c) => [c.courtId, c.cameraRtspUrl]),
      [[home.courtId, "rtsp://user:pass@10.0.0.5:554/main"]]
    );
    assert.equal(config.data.clip.preSeconds, 60);

    const box = await call("GET", `/admin/devices/${home.deviceId}`);
    assert.equal(box.data.device.agentVersion, "0.1.0");
    assert.ok(box.data.device.lastSeenSecondsAgo >= 0 && box.data.device.lastSeenSecondsAgo < 60);
    assert.deepEqual(
      box.data.device.cameras.map((c) => c.courtId),
      [home.courtId]
    );
  });

  let shareToken;
  let clipId;

  it("saves a clip from the court QR, and merges a second tap into it", async () => {
    const court = await ctx.api("GET", `/public/courts/${home.qrToken}`);
    assert.equal(court.data.court.cameraReady, true);

    const first = await ctx.api("POST", `/public/courts/${home.qrToken}/clips`);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.data.merged, false);
    shareToken = first.data.shareToken;
    assert.ok(first.data.shareUrl.endsWith(`/clip/${shareToken}`));

    const second = await ctx.api("POST", `/public/courts/${home.qrToken}/clips`);
    assert.equal(second.status, 200);
    assert.equal(second.data.merged, true);
    assert.equal(second.data.shareToken, shareToken);

    const [rows] = await ctx.sql.query(`SELECT clipId FROM clips WHERE courtId = ?`, [
      home.courtId,
    ]);
    assert.equal(rows.length, 1);
    clipId = rows[0].clipId;

    const page = await ctx.api("GET", `/public/clips/${shareToken}`);
    assert.equal(page.status, 200);
    assert.equal(page.data.clip.status, "Pending");
    assert.equal(page.data.clip.videoUrl, null);
  });

  it("hands the job to the home box only", async () => {
    const jobs = await home.device("GET", "/device/jobs?wait=0");
    assert.equal(jobs.status, 200);
    const job = jobs.data.jobs.find((j) => j.clipId === clipId);
    assert.ok(job, "home box sees the clip");
    assert.equal(job.courtId, home.courtId);
    assert.equal(typeof job.requestedAtMs, "number");
    assert.ok(Math.abs(Date.now() - job.requestedAtMs) < 60_000);

    const otherJobs = await other.device("GET", "/device/jobs?wait=0");
    assert.equal(otherJobs.data.jobs.length, 0);
  });

  it("refuses another venue's box on every clip action, and writes nothing", async () => {
    assert.equal((await other.device("POST", `/device/clips/${clipId}/processing`)).status, 404);
    assert.equal(
      (await other.device("POST", `/device/clips/${clipId}/fail`, { body: { reason: "x" } }))
        .status,
      404
    );
    const upload = await other.device("POST", `/device/clips/${clipId}/upload`, {
      form: uploadForm(),
    });
    assert.equal(upload.status, 404);

    const [[row]] = await ctx.sql.query(`SELECT status, videoPath FROM clips WHERE clipId = ?`, [
      clipId,
    ]);
    assert.equal(row.status, "Pending");
    assert.equal(row.videoPath, null);
    const clipsFolder = path.join(
      ctx.workDir,
      "public",
      "uploads",
      "admin",
      "clips",
      other.venueId
    );
    assert.equal(fs.existsSync(clipsFolder), false);
  });

  it("rejects an upload whose files are the wrong type", async () => {
    const res = await home.device("POST", `/device/clips/${clipId}/upload`, {
      form: uploadForm(MP4, PNG, "image/png", "t.png"),
    });
    assert.equal(res.status, 400);
    const [[row]] = await ctx.sql.query(`SELECT status FROM clips WHERE clipId = ?`, [clipId]);
    assert.equal(row.status, "Pending");
  });

  it("processes and uploads the clip, which then plays from the share link", async () => {
    assert.equal((await home.device("POST", `/device/clips/${clipId}/processing`)).status, 200);
    const processing = await ctx.api("GET", `/public/clips/${shareToken}`);
    assert.equal(processing.data.clip.status, "Pending", "players see 'saving' until it is ready");

    const upload = await home.device("POST", `/device/clips/${clipId}/upload`, {
      form: uploadForm(),
    });
    assert.equal(upload.status, 200, JSON.stringify(upload.body));

    const page = await ctx.api("GET", `/public/clips/${shareToken}`);
    assert.equal(page.data.clip.status, "Ready");
    assert.match(page.data.clip.videoUrl, /^\/public\/uploads\/admin\/clips\/.+\.mp4\?expires=/);
    assert.ok(page.data.clip.thumbnailUrl);
    assert.ok(page.data.clip.expiresAt);

    // The signed link serves the video, including byte ranges (seeking on phones)
    const full = await ctx.get(page.data.clip.videoUrl);
    assert.equal(full.status, 200);
    assert.equal(Buffer.from(await full.arrayBuffer()).length, MP4.length);
    const ranged = await fetch(new URL(page.data.clip.videoUrl, full.url), {
      headers: { Range: "bytes=0-9" },
    });
    assert.equal(ranged.status, 206);
    assert.equal(Buffer.from(await ranged.arrayBuffer()).length, 10);

    // The download link makes the browser save the file instead of opening it
    const download = await ctx.get(page.data.clip.downloadUrl);
    assert.equal(download.status, 200);
    assert.equal(
      download.headers.get("content-disposition"),
      "attachment; filename=dyna-cam-replay.mp4"
    );

    // The bare path is refused
    const bare = await ctx.get(page.data.clip.videoUrl.split("?")[0]);
    assert.equal(bare.status, 403);

    const adminView = await call("GET", `/admin/clips/${clipId}`);
    assert.equal(adminView.status, 200);
    assert.equal(adminView.data.clip.courtName, "Court 1");
    assert.ok(adminView.data.clip.videoUrl);
    assert.equal(adminView.data.clip.shareToken, undefined);
  });

  it("won't take a second upload for a finished clip", async () => {
    const again = await home.device("POST", `/device/clips/${clipId}/upload`, {
      form: uploadForm(),
    });
    assert.equal(again.status, 409);
  });

  it("lets only one box at a venue make a clip", async () => {
    const second = await call("POST", "/admin/devices", { venueId: home.venueId, name: "Box 2" });
    const box2 = asDevice(second.data.token);
    await ageClips(home.courtId);
    const save = await ctx.api("POST", `/public/courts/${home.qrToken}/clips`);
    const [[row]] = await ctx.sql.query(`SELECT clipId FROM clips WHERE shareToken = ?`, [
      save.data.shareToken,
    ]);

    assert.equal((await home.device("POST", `/device/clips/${row.clipId}/processing`)).status, 200);
    assert.equal(
      (await home.device("POST", `/device/clips/${row.clipId}/processing`)).status,
      200,
      "the claiming box may retry its claim"
    );
    assert.equal((await box2("POST", `/device/clips/${row.clipId}/processing`)).status, 409);
    assert.equal(
      (await box2("POST", `/device/clips/${row.clipId}/upload`, { form: uploadForm() })).status,
      409
    );
    assert.equal(
      (await box2("POST", `/device/clips/${row.clipId}/fail`, { body: { reason: "x" } })).status,
      409
    );
    assert.equal(
      (await home.device("POST", `/device/clips/${row.clipId}/upload`, { form: uploadForm() }))
        .status,
      200
    );
  });

  it("records a clip the box could not make as failed", async () => {
    await ageClips(home.courtId);
    const save = await ctx.api("POST", `/public/courts/${home.qrToken}/clips`);
    assert.equal(save.status, 201);
    const [[row]] = await ctx.sql.query(`SELECT clipId FROM clips WHERE shareToken = ?`, [
      save.data.shareToken,
    ]);

    const failed = await home.device("POST", `/device/clips/${row.clipId}/fail`, {
      body: { reason: "Camera stream dropped" },
    });
    assert.equal(failed.status, 200);
    const page = await ctx.api("GET", `/public/clips/${save.data.shareToken}`);
    assert.equal(page.data.clip.status, "Failed");
  });

  it("expires old clips (deleting their files) and fails clips no box picked up", async () => {
    const { runClipMaintenance } = await import("../server/src/jobs/clipMaintenance.js");

    const [[ready]] = await ctx.sql.query(`SELECT videoPath FROM clips WHERE clipId = ?`, [clipId]);
    const videoFile = path.join(ctx.workDir, ready.videoPath.replace(/^\//, ""));
    assert.ok(fs.existsSync(videoFile));

    await ctx.sql.query(
      `UPDATE clips SET expiresAt = DATE_SUB(expiresAt, INTERVAL 60 DAY) WHERE clipId = ?`,
      [clipId]
    );

    await ageClips(home.courtId);
    const stale = await ctx.api("POST", `/public/courts/${home.qrToken}/clips`);
    await ctx.sql.query(
      `UPDATE clips SET requestedAt = DATE_SUB(requestedAt, INTERVAL 2 HOUR) WHERE shareToken = ?`,
      [stale.data.shareToken]
    );

    const result = await runClipMaintenance(ctx.db);
    assert.ok(result.expired >= 1);
    assert.ok(result.failed >= 1);

    assert.equal(fs.existsSync(videoFile), false, "expired clip's video is deleted");
    const page = await ctx.api("GET", `/public/clips/${shareToken}`);
    assert.equal(page.data.clip.status, "Expired");
    assert.equal(page.data.clip.videoUrl, null);

    const stalePage = await ctx.api("GET", `/public/clips/${stale.data.shareToken}`);
    assert.equal(stalePage.data.clip.status, "Failed");
  });

  it("treats a deleted clip as missing everywhere", async () => {
    await ageClips(home.courtId);
    const save = await ctx.api("POST", `/public/courts/${home.qrToken}/clips`);
    const [[row]] = await ctx.sql.query(`SELECT clipId FROM clips WHERE shareToken = ?`, [
      save.data.shareToken,
    ]);
    const upload = await home.device("POST", `/device/clips/${row.clipId}/upload`, {
      form: uploadForm(),
    });
    assert.equal(upload.status, 200);
    const [[ready]] = await ctx.sql.query(`SELECT videoPath FROM clips WHERE clipId = ?`, [
      row.clipId,
    ]);
    assert.ok(ready.videoPath);

    // The Admin portal can't delete clips (view only since PLAN-002 Phase E);
    // a clip is soft-deleted by maintenance, so set it the way the database would
    assert.equal((await call("DELETE", `/admin/clips/${row.clipId}`)).status, 404);
    await ctx.sql.query(
      `UPDATE clips SET status = 'Deleted', videoPath = NULL, thumbnailPath = NULL
       WHERE clipId = ?`,
      [row.clipId]
    );

    assert.equal((await call("GET", `/admin/clips/${row.clipId}`)).status, 404);
    assert.equal((await ctx.api("GET", `/public/clips/${save.data.shareToken}`)).status, 404);
    assert.equal(
      (await home.device("POST", `/device/clips/${row.clipId}/upload`, { form: uploadForm() }))
        .status,
      404
    );

    const [[after]] = await ctx.sql.query(`SELECT status, courtId FROM clips WHERE clipId = ?`, [
      row.clipId,
    ]);
    assert.equal(after.status, "Deleted");
    assert.equal(after.courtId, home.courtId);
  });

  it("gives each page its picker options under its own permission", async () => {
    const courtsOnly = await ctx.createStaff("Courts only");
    // grant just venues/courts read via a role built through the API
    const perms = (await call("GET", "/admin/permissions")).data.permissions;
    const pick = (module, submodule) =>
      perms.find((p) => p.module === module && (p.submodule ?? null) === submodule).permissionId;
    const assign = await call("POST", `/admin/roles/${courtsOnly.roleId}/permissions`, {
      permissions: [{ permissionId: pick("venues", "courts"), accessLevel: "read" }],
    });
    assert.equal(assign.status, 200, JSON.stringify(assign.body));

    const asCourts = (url) => ctx.api("GET", url, { token: courtsOnly.token });
    assert.equal((await asCourts("/admin/venues")).status, 403);
    const options = await asCourts("/admin/courts/options");
    assert.equal(options.status, 200);
    assert.ok(options.data.venues.some((v) => v.venueId === home.venueId));
    assert.equal((await asCourts("/admin/devices/options")).status, 403);

    const court = await asCourts(`/admin/courts/${home.courtId}`);
    assert.equal(court.data.court.venueLogoUrl, null);

    const clipOptions = await call("GET", "/admin/clips/options");
    assert.equal(clipOptions.status, 200);
    assert.ok(clipOptions.data.courts.some((c) => c.courtId === home.courtId));
  });

  it("rejects malformed links", async () => {
    assert.equal((await ctx.api("GET", "/public/courts/short")).status, 400);
    assert.equal((await ctx.api("GET", "/public/clips/../../etc")).status, 404);
  });
});
