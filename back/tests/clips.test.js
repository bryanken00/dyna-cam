// PLAN-001 — 60-second clips saved before CR-027 (the court QR now starts a
// game; nothing saves a new clip). CR-040 Phase 4: no box makes or uploads a
// clip any more (no clip jobs, no clip routes) and no clip file is served —
// an old clip's page shows its state and its Google Drive copy, then expires.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { JPEG, startTestApp } from "./helpers/testApp.js";
import { insertLegacyClip, readyLegacyClip } from "./helpers/legacyClip.js";

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
    const box = await ctx.pairBox(admin.token, target.venueId, "Box");
    target.device = asDevice(box.data.token);
    target.deviceId = box.data.deviceId;
  };

  /**
   * A legacy clip made Ready with files on disk, as the old box upload left it.
   * @returns {{ videoFile: string }} the video's absolute path
   */
  const readyWithFiles = async (target, clipId) => {
    const folder = `public/uploads/admin/clips/${target.venueId}/${clipId}`;
    fs.mkdirSync(path.join(ctx.workDir, folder), { recursive: true });
    fs.writeFileSync(path.join(ctx.workDir, folder, "clip.mp4"), MP4);
    fs.writeFileSync(path.join(ctx.workDir, folder, "clip.jpg"), JPEG);
    await readyLegacyClip(ctx.sql, clipId, {
      videoPath: `/${folder}/clip.mp4`,
      thumbnailPath: `/${folder}/clip.jpg`,
    });
    return { videoFile: path.join(ctx.workDir, folder, "clip.mp4") };
  };

  before(async () => {
    ctx = await startTestApp();
    admin = await ctx.createStaff("Admin", { access: "write" });
    await setupVenue(home, "Home Courts");
    await setupVenue(other, "Other Courts");
  });
  after(() => ctx?.stop());

  it("shows the court page as not ready while the recorder box is offline; no clip saves", async () => {
    // A box is online from the moment it pairs; this one hasn't been heard from since
    await ctx.sql.query(`UPDATE devices SET lastSeenAt = NULL WHERE venueId = ?`, [home.venueId]);
    const court = await ctx.api("GET", `/public/courts/${home.qrToken}`);
    assert.equal(court.status, 200);
    assert.equal(court.data.court.cameraReady, false);
    assert.equal(court.data.court.venueName, "Home Courts");
    assert.equal(court.data.court.courtId, undefined, "no IDs on the public page");

    // CR-027: the court QR no longer saves the last 60 seconds
    const save = await ctx.api("POST", `/public/courts/${home.qrToken}/clips`);
    assert.equal(save.status, 404);
    const [[{ n }]] = await ctx.sql.query(`SELECT COUNT(*) AS n FROM clips`);
    assert.equal(Number(n), 0);
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

    // No Recorder Boxes page since PLAN-002 Phase I — the row and the court show it
    const [[box]] = await ctx.sql.query(
      `SELECT agentVersion, lastSeenAt IS NOT NULL AS seen, lastStatus FROM devices
       WHERE deviceId = ?`,
      [home.deviceId]
    );
    assert.equal(box.agentVersion, "0.1.0");
    assert.equal(box.seen, 1);
    assert.deepEqual(
      box.lastStatus.cameras.map((c) => c.courtId),
      [home.courtId]
    );
  });

  let shareToken;
  let clipId;

  it("shows a clip saved before CR-027 as saving on its page", async () => {
    const saved = await insertLegacyClip(ctx.sql, { courtId: home.courtId });
    shareToken = saved.shareToken;
    clipId = saved.clipId;

    const page = await ctx.api("GET", `/public/clips/${shareToken}`);
    assert.equal(page.status, 200);
    assert.equal(page.data.clip.status, "Pending");
    assert.equal("videoUrl" in page.data.clip, false);
  });

  it("hands no box a clip job (CR-040 Phase 4)", async () => {
    for (const target of [home, other]) {
      const jobs = await target.device("GET", "/device/jobs?wait=0");
      assert.equal(jobs.status, 200);
      assert.equal(jobs.data.jobs.filter((job) => job.type === "clip").length, 0, "no clip jobs");
    }
  });

  it("has no clip routes for any box, and writes nothing", async () => {
    for (const target of [home, other]) {
      for (const action of ["processing", "upload", "fail"]) {
        const res = await target.device("POST", `/device/clips/${clipId}/${action}`, {
          body: { reason: "x" },
        });
        assert.equal(res.status, 404, action);
      }
    }
    const [[row]] = await ctx.sql.query(`SELECT status, videoPath FROM clips WHERE clipId = ?`, [
      clipId,
    ]);
    assert.equal(row.status, "Pending");
    assert.equal(row.videoPath, null);
  });

  it("shows a ready clip with no file link, on its page and in Admin", async () => {
    const { videoFile } = await readyWithFiles(home, clipId);
    assert.ok(fs.existsSync(videoFile));

    const page = await ctx.api("GET", `/public/clips/${shareToken}`);
    assert.equal(page.data.clip.status, "Ready");
    assert.ok(page.data.clip.expiresAt);
    for (const key of ["videoUrl", "downloadUrl", "thumbnailUrl"]) {
      assert.equal(key in page.data.clip, false, key);
    }

    // The file itself is never served without a signed link, which nothing gives out
    const [[row]] = await ctx.sql.query(`SELECT videoPath FROM clips WHERE clipId = ?`, [clipId]);
    assert.equal((await ctx.get(row.videoPath)).status, 403);

    const adminView = await call("GET", `/admin/clips/${clipId}`);
    assert.equal(adminView.status, 200);
    assert.equal(adminView.data.clip.courtName, "Court 1");
    for (const key of ["videoUrl", "downloadUrl", "thumbnailUrl", "videoPath", "shareToken"]) {
      assert.equal(key in adminView.data.clip, false, key);
    }
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

    const stale = await insertLegacyClip(ctx.sql, { courtId: home.courtId });
    await ctx.sql.query(
      `UPDATE clips SET requestedAt = DATE_SUB(requestedAt, INTERVAL 2 HOUR) WHERE shareToken = ?`,
      [stale.shareToken]
    );

    const result = await runClipMaintenance(ctx.db);
    assert.ok(result.expired >= 1);
    assert.ok(result.failed >= 1);

    assert.equal(fs.existsSync(videoFile), false, "expired clip's video is deleted");
    const page = await ctx.api("GET", `/public/clips/${shareToken}`);
    assert.equal(page.data.clip.status, "Expired");

    const stalePage = await ctx.api("GET", `/public/clips/${stale.shareToken}`);
    assert.equal(stalePage.data.clip.status, "Failed");
  });

  it("treats a deleted clip as missing everywhere", async () => {
    const save = await insertLegacyClip(ctx.sql, { courtId: home.courtId });
    await readyWithFiles(home, save.clipId);

    // The Admin portal can't delete clips (view only since PLAN-002 Phase E);
    // a clip is soft-deleted by maintenance, so set it the way the database would
    assert.equal((await call("DELETE", `/admin/clips/${save.clipId}`)).status, 404);
    await ctx.sql.query(
      `UPDATE clips SET status = 'Deleted', videoPath = NULL, thumbnailPath = NULL
       WHERE clipId = ?`,
      [save.clipId]
    );

    assert.equal((await call("GET", `/admin/clips/${save.clipId}`)).status, 404);
    assert.equal((await ctx.api("GET", `/public/clips/${save.shareToken}`)).status, 404);

    const [[after]] = await ctx.sql.query(`SELECT status, courtId FROM clips WHERE clipId = ?`, [
      save.clipId,
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
    assert.equal((await asCourts("/admin/devices/options")).status, 404, "no boxes page (Phase I)");

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
