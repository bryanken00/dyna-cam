// PLAN-002 Phase A — guided camera setup: the venue's recorder box reports
// what it receives from each camera (heartbeat) and, while the setup page is
// open, uploads a preview snapshot from its own recording.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { JPEG, PNG, startTestApp } from "./helpers/testApp.js";

describe("camera setup preview", () => {
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
  const snapshot = (device, courtId, buffer = JPEG, type = "image/jpeg", name = "s.jpg") =>
    device("POST", `/device/courts/${courtId}/snapshot`, {
      form: [["snapshot", buffer, type, name]],
    });

  before(async () => {
    ctx = await startTestApp();
    admin = await ctx.createStaff("Admin", { access: "write" });
    viewer = await ctx.createStaff("Viewer", { access: "read" });
    for (const [target, name] of [
      [home, "Preview Courts"],
      [other, "Other Courts"],
    ]) {
      target.venueId = (await call("POST", "/admin/venues", { name })).data.venueId;
      const court = await call("POST", "/admin/courts", {
        venueId: target.venueId,
        name: "Court 1",
        cameraRtspUrl: "rtsp://u:p@10.0.0.9:554/stream1",
      });
      target.courtId = court.data.courtId;
      const box = await ctx.pairBox(admin.token, target.venueId, "Box");
      target.device = asDevice(box.data.token);
    }
  });
  after(() => ctx?.stop());

  it("shows what the box receives from the camera", async () => {
    const hb = await home.device("POST", "/device/heartbeat", {
      body: {
        agentVersion: "1.1.0",
        cameras: [
          {
            courtId: home.courtId,
            status: "ok",
            message: "Recording",
            video: { codec: "h264", width: 1280, height: 720, fps: 15 },
            audio: { codec: "aac", sampleRate: 8000 },
          },
        ],
      },
    });
    assert.equal(hb.status, 200, JSON.stringify(hb.body));

    const one = await call("GET", `/admin/courts/${home.courtId}`);
    const live = one.data.court.camera.live;
    assert.equal(live.status, "ok");
    assert.deepEqual(live.video, { codec: "h264", width: 1280, height: 720, fps: 15 });
    assert.deepEqual(live.audio, { codec: "aac", sampleRate: 8000 });
    assert.equal(live.boxOnline, true);
    assert.equal(live.boxName, "Box");

    const list = await call("GET", `/admin/courts?venueId=${home.venueId}`);
    assert.equal(list.data.courts[0].camera.live.video.width, 1280);

    const otherCourt = await call("GET", `/admin/courts/${other.courtId}`);
    assert.equal(otherCourt.data.court.camera.live, null, "no report from its own box yet");
  });

  it("asks the venue's box for a preview while the setup page is open", async () => {
    let config = await home.device("GET", "/device/config");
    assert.equal(config.data.courts[0].previewWanted, false);

    assert.equal(
      (await call("POST", `/admin/courts/${home.courtId}/preview`, {}, viewer)).status,
      200
    );
    config = await home.device("GET", "/device/config");
    assert.equal(config.data.courts.find((c) => c.courtId === home.courtId).previewWanted, true);
    const otherConfig = await other.device("GET", "/device/config");
    assert.equal(otherConfig.data.courts[0].previewWanted, false);

    // The request lapses on its own
    await ctx.sql.query(
      `UPDATE courts SET previewWantedUntil = DATE_SUB(previewWantedUntil, INTERVAL 10 MINUTE)
       WHERE courtId = ?`,
      [home.courtId]
    );
    config = await home.device("GET", "/device/config");
    assert.equal(config.data.courts.find((c) => c.courtId === home.courtId).previewWanted, false);
  });

  it("keeps only the newest snapshot, signed", async () => {
    const first = await snapshot(home.device, home.courtId);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    let one = await call("GET", `/admin/courts/${home.courtId}`);
    const firstUrl = one.data.court.camera.snapshotUrl;
    assert.match(firstUrl, /^\/public\/uploads\/admin\/snapshots\/.+\.jpg\?expires=/);
    assert.ok(one.data.court.camera.snapshotAt);
    assert.equal((await ctx.get(firstUrl)).status, 200);
    const firstFile = path.join(ctx.workDir, firstUrl.split("?")[0].replace(/^\//, ""));
    assert.ok(fs.existsSync(firstFile));

    assert.equal((await snapshot(home.device, home.courtId)).status, 200);
    one = await call("GET", `/admin/courts/${home.courtId}`);
    assert.notEqual(one.data.court.camera.snapshotUrl, firstUrl);
    assert.equal(fs.existsSync(firstFile), false, "the previous snapshot is deleted");
  });

  it("tells a report about the new camera address from one about the old", async () => {
    const config = await home.device("GET", "/device/config");
    const version = config.data.courts.find((c) => c.courtId === home.courtId).cameraVersion;
    assert.match(version, /^[0-9a-f]{12}$/);
    let one = await call("GET", `/admin/courts/${home.courtId}`);
    assert.equal(one.data.court.camera.version, version);

    await home.device("POST", "/device/heartbeat", {
      body: { cameras: [{ courtId: home.courtId, status: "ok", cameraVersion: version }] },
    });
    one = await call("GET", `/admin/courts/${home.courtId}`);
    assert.equal(one.data.court.camera.live.cameraVersion, version);
    assert.ok(one.data.court.camera.live.reportedSecondsAgo >= 0);

    // Saving a (new) address changes the version; the old report no longer matches
    await call("PUT", `/admin/courts/${home.courtId}`, {
      name: "Court 1",
      cameraRtspUrl: "rtsp://u:p@10.0.0.10:554/stream1",
    });
    one = await call("GET", `/admin/courts/${home.courtId}`);
    assert.notEqual(one.data.court.camera.version, version);
    assert.equal(one.data.court.camera.live.cameraVersion, version);
  });

  it("asks for a preview without touching the court's history", async () => {
    const [[before]] = await ctx.sql.query(`SELECT dateUpdated FROM courts WHERE courtId = ?`, [
      home.courtId,
    ]);
    const [[auditsBefore]] = await ctx.sql.query(`SELECT COUNT(*) AS n FROM audit_trail`);
    assert.equal((await call("POST", `/admin/courts/${home.courtId}/preview`)).status, 200);
    const [[after]] = await ctx.sql.query(`SELECT dateUpdated FROM courts WHERE courtId = ?`, [
      home.courtId,
    ]);
    const [[auditsAfter]] = await ctx.sql.query(`SELECT COUNT(*) AS n FROM audit_trail`);
    assert.equal(after.dateUpdated.toString(), before.dateUpdated.toString());
    assert.equal(auditsAfter.n, auditsBefore.n);

    const one = await call("GET", `/admin/courts/${home.courtId}`);
    assert.ok(one.data.court.camera.snapshotSecondsAgo >= 0);
  });

  it("refuses another venue's box, a non-JPEG, and a deleted court", async () => {
    assert.equal((await snapshot(other.device, home.courtId)).status, 404);
    assert.equal(
      (await snapshot(home.device, home.courtId, PNG, "image/png", "s.png")).status,
      400
    );

    const temp = await call("POST", "/admin/courts", { venueId: home.venueId, name: "Gone" });
    await call("DELETE", `/admin/courts/${temp.data.courtId}`);
    assert.equal((await snapshot(home.device, temp.data.courtId)).status, 404);
    assert.equal((await call("POST", `/admin/courts/${temp.data.courtId}/preview`)).status, 404);
  });
});
