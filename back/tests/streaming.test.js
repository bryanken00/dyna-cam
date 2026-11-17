// PLAN-001 Phase 5 — live streaming settings per court: the RTMP ingest URL
// (with its stream key) is write-only and encrypted at rest, handed only to the
// venue's own recorder box; players get the public watch link.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

const INGEST = "rtmp://a.rtmp.youtube.com/live2/abcd-efgh-ijkl-mnop";
const WATCH = "https://www.youtube.com/@pickleclub/live";

describe("live streaming", () => {
  let ctx;
  let admin;
  const home = {};
  const other = {};

  const call = (method, url, body) => ctx.api(method, url, { token: admin.token, body });
  const asDevice = (token) => (method, url, body) =>
    ctx.api(method, url, { body, headers: { Authorization: `Device ${token}` } });
  const courtBody = (overrides = {}) => ({ name: "Court 1", ...overrides });

  before(async () => {
    ctx = await startTestApp();
    admin = await ctx.createStaff("Admin", { access: "write" });
    for (const [target, name] of [
      [home, "Stream Courts"],
      [other, "Other Courts"],
    ]) {
      target.venueId = (await call("POST", "/admin/venues", { name })).data.venueId;
      const box = await ctx.pairBox(admin.token, target.venueId, "Box");
      target.device = asDevice(box.data.token);
    }
  });
  after(() => ctx?.stop());

  it("needs an RTMP address to turn streaming on", async () => {
    const res = await call("POST", "/admin/courts", {
      venueId: home.venueId,
      ...courtBody({ name: "No key" }),
      streamEnabled: true,
    });
    assert.equal(res.status, 400);
    const http = await call("POST", "/admin/courts", {
      venueId: home.venueId,
      ...courtBody({ name: "Bad url" }),
      streamRtmpUrl: "https://youtube.com/live",
    });
    assert.equal(http.status, 400);
  });

  it("stores the stream key encrypted and never returns it", async () => {
    const created = await call("POST", "/admin/courts", {
      venueId: home.venueId,
      ...courtBody(),
      cameraRtspUrl: "rtsp://u:p@10.0.0.9:554/stream1",
      streamEnabled: true,
      streamRtmpUrl: INGEST,
      streamWatchUrl: WATCH,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    home.courtId = created.data.courtId;
    home.qrToken = created.data.qrToken;

    const one = await call("GET", `/admin/courts/${home.courtId}`);
    assert.ok(!JSON.stringify(one.body).includes("abcd-efgh-ijkl-mnop"));
    assert.deepEqual(one.data.court.stream, {
      enabled: true,
      configured: true,
      display: "rtmp://a.rtmp.youtube.com/live2/••••mnop",
      watchUrl: WATCH,
    });
    const [[row]] = await ctx.sql.query(`SELECT streamRtmpUrl FROM courts WHERE courtId = ?`, [
      home.courtId,
    ]);
    assert.ok(row.streamRtmpUrl.startsWith("v1:"));
  });

  it("gives the stream URL to the venue's own box only", async () => {
    const config = await home.device("GET", "/device/config");
    const court = config.data.courts.find((c) => c.courtId === home.courtId);
    assert.deepEqual(court.stream, { rtmpUrl: INGEST, layout: "CAM1" });
    const otherConfig = await other.device("GET", "/device/config");
    assert.ok(!JSON.stringify(otherConfig.body).includes("abcd-efgh"));
  });

  it("shows the stream's health from the heartbeat", async () => {
    const hb = await home.device("POST", "/device/heartbeat", {
      agentVersion: "1.0.0",
      cameras: [
        { courtId: home.courtId, status: "ok", streamStatus: "error", streamMessage: "Bad key" },
      ],
    });
    assert.equal(hb.status, 200, JSON.stringify(hb.body));
    const devices = await call("GET", `/admin/devices?venueId=${home.venueId}`);
    const camera = devices.data.devices[0].cameras[0];
    assert.equal(camera.streamStatus, "error");
    assert.equal(camera.streamMessage, "Bad key");
  });

  it("links players to the live stream while it is on", async () => {
    let page = await ctx.api("GET", `/public/courts/${home.qrToken}`);
    assert.equal(page.data.court.liveWatchUrl, WATCH);

    // Turning streaming off keeps the stored key but hides the link
    assert.equal(
      (
        await call("PUT", `/admin/courts/${home.courtId}`, {
          ...courtBody(),
          streamWatchUrl: WATCH,
        })
      ).status,
      200
    );
    page = await ctx.api("GET", `/public/courts/${home.qrToken}`);
    assert.equal(page.data.court.liveWatchUrl, null);
    let one = await call("GET", `/admin/courts/${home.courtId}`);
    assert.equal(one.data.court.stream.enabled, false);
    assert.equal(one.data.court.stream.configured, true);
    let config = await home.device("GET", "/device/config");
    assert.equal(config.data.courts.find((c) => c.courtId === home.courtId).stream, null);

    // On again without re-entering the key
    assert.equal(
      (
        await call("PUT", `/admin/courts/${home.courtId}`, {
          ...courtBody(),
          streamEnabled: true,
          streamWatchUrl: WATCH,
        })
      ).status,
      200
    );
    config = await home.device("GET", "/device/config");
    assert.deepEqual(config.data.courts.find((c) => c.courtId === home.courtId).stream, {
      rtmpUrl: INGEST,
      layout: "CAM1",
    });

    // Removing the stream clears the key and turns it off
    assert.equal(
      (
        await call("PUT", `/admin/courts/${home.courtId}`, {
          ...courtBody(),
          streamEnabled: true,
          removeStream: true,
        })
      ).status,
      200
    );
    one = await call("GET", `/admin/courts/${home.courtId}`);
    assert.equal(one.data.court.stream.enabled, false);
    assert.equal(one.data.court.stream.configured, false);
    assert.equal(
      (await call("PUT", `/admin/courts/${home.courtId}`, { ...courtBody(), streamEnabled: true }))
        .status,
      400,
      "can't turn it on without a key"
    );
  });
});
