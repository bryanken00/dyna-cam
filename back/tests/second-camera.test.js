// PLAN-002 Phase H — a court can have a second camera. Its address is
// write-only and encrypted like camera 1's; the venue's court stream and a
// player's own stream can show Cam 1, Cam 2 or both stacked; the recorder box
// gets camera 2 and the layouts in its config, and reports each camera.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { JPEG, startTestApp } from "./helpers/testApp.js";

const CAM1 = "rtsp://cam-one:Pass%40One1@192.168.1.50:554/stream1";
const CAM2 = "rtsp://cam-two:Pass%40Two2@192.168.1.51:554/stream1";
const RTMP = "rtmps://live-api-s.facebook.com:443/rtmp/FB-111-0-VenueStreamKey42";

describe("two cameras on one court", () => {
  let ctx;
  let admin;
  let venueId;
  let box;

  const call = (method, url, body) => ctx.api(method, url, { token: admin.token, body });
  const asBox = (token) => (method, url, options = {}) =>
    ctx.api(method, url, { ...options, headers: { Authorization: `Device ${token}` } });
  const court = async (courtId) => (await call("GET", `/admin/courts/${courtId}`)).data.court;
  const configCourt = async (courtId) =>
    (await box("GET", "/device/config")).data.courts.find((c) => c.courtId === courtId);

  let courtCount = 0;
  const newCourt = async (body = {}) => {
    courtCount += 1;
    const res = await call("POST", "/admin/courts", {
      venueId,
      name: `Court ${courtCount}`,
      cameraRtspUrl: CAM1,
      ...body,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.data.courtId;
  };

  before(async () => {
    ctx = await startTestApp({
      env: { RATE_LIMIT_PAIR_POINTS: "1000", RATE_LIMIT_PAIR_HOURLY_POINTS: "1000" },
    });
    admin = await ctx.createStaff("Admin", { access: "write" });
    venueId = (await call("POST", "/admin/venues", { name: "Two Cam Courts" })).data.venueId;
    box = asBox((await ctx.pairBox(admin.token, venueId, "Box")).data.token);
  });
  after(() => ctx?.stop());

  describe("court setup", () => {
    let courtId;

    it("saves camera 2 encrypted and only ever shows it masked", async () => {
      courtId = await newCourt({ camera2RtspUrl: CAM2, streamLayout: "STACKED" });
      const shown = await court(courtId);
      assert.equal(shown.camera2.configured, true);
      assert.equal(shown.camera2.display, "rtsp://192.168.1.51:554/stream1");
      assert.ok(shown.camera2.version);
      assert.equal(shown.streamLayout, "STACKED");
      assert.ok(!JSON.stringify(shown).includes("Pass%40Two2"));

      const [[row]] = await ctx.sql.query(`SELECT camera2RtspUrl FROM courts WHERE courtId = ?`, [
        courtId,
      ]);
      assert.ok(row.camera2RtspUrl && !row.camera2RtspUrl.includes("Pass%40Two2"));

      const [audit] = await ctx.sql.query(
        `SELECT metadata FROM audit_trail WHERE module = 'courts'`
      );
      assert.doesNotMatch(JSON.stringify(audit), /Pass%40Two2|cam-two/, "BUG-001 holds");
    });

    it("hands the box camera 2 and the stream layout", async () => {
      await call("PUT", `/admin/courts/${courtId}`, {
        name: (await court(courtId)).name,
        streamEnabled: true,
        streamRtmpUrl: RTMP,
      });
      const cfg = await configCourt(courtId);
      assert.equal(cfg.cameraRtspUrl, CAM1);
      assert.equal(cfg.camera2RtspUrl, CAM2);
      assert.ok(cfg.camera2Version);
      assert.deepEqual(cfg.stream, { rtmpUrl: RTMP, layout: "STACKED" });
    });

    it("shows each camera's live check and preview picture", async () => {
      const beat = await box("POST", "/device/heartbeat", {
        body: {
          cameras: [
            { courtId, status: "ok", video: { codec: "h264", width: 1280, height: 720, fps: 15 } },
            { courtId, camera: 2, status: "error", message: "Camera not reachable" },
          ],
        },
      });
      assert.equal(beat.status, 200, JSON.stringify(beat.body));
      const snap = await box("POST", `/device/courts/${courtId}/snapshot?camera=2`, {
        form: [["snapshot", JPEG, "image/jpeg", "cam2.jpg"]],
      });
      assert.equal(snap.status, 200, JSON.stringify(snap.body));

      const shown = await court(courtId);
      assert.equal(shown.camera.live.status, "ok");
      assert.equal(shown.camera.live.video.width, 1280);
      assert.equal(shown.camera2.live.status, "error");
      assert.equal(shown.camera2.live.message, "Camera not reachable");
      assert.ok(shown.camera2.snapshotUrl);
      assert.equal(shown.camera.snapshotUrl, null, "camera 1's picture is separate");
    });

    it("keeps camera 2 when the address is left out, and removes it on request", async () => {
      const name = (await court(courtId)).name;
      await call("PUT", `/admin/courts/${courtId}`, { name, streamEnabled: true });
      assert.equal((await court(courtId)).camera2.configured, true);
      assert.equal((await court(courtId)).streamLayout, "STACKED", "the layout is kept too");

      await call("PUT", `/admin/courts/${courtId}`, { name, streamEnabled: true, removeCamera2: true });
      const shown = await court(courtId);
      assert.equal(shown.camera2.configured, false);
      assert.equal(shown.streamLayout, "CAM1", "a layout needing camera 2 falls back");
      const cfg = await configCourt(courtId);
      assert.equal(cfg.camera2RtspUrl, null);
      assert.equal(cfg.stream.layout, "CAM1");
    });

    it("refuses a layout without camera 2, and camera 2 without camera 1", async () => {
      const single = await newCourt();
      const name = (await court(single)).name;
      for (const layout of ["CAM2", "STACKED"]) {
        const res = await call("PUT", `/admin/courts/${single}`, { name, streamLayout: layout });
        assert.equal(res.status, 400, layout);
      }
      assert.equal(
        (await call("PUT", `/admin/courts/${single}`, { name, streamLayout: "CAM1" })).status,
        200
      );
      const noCam1 = await call("POST", "/admin/courts", {
        venueId,
        name: "Camera 2 only",
        camera2RtspUrl: CAM2,
      });
      assert.equal(noCam1.status, 400);
      assert.equal(
        (await call("PUT", `/admin/courts/${single}`, { name: "x", streamLayout: "SIDEBYSIDE" }))
          .status,
        400
      );
    });
  });

  describe("a player's own stream on a 2-camera court", () => {
    let courtId;
    let sessionId;
    let code;
    const setup = (method, body) => ctx.api(method, `/public/stream-setup/${code}`, { body });

    before(async () => {
      courtId = await newCourt({ camera2RtspUrl: CAM2 });
      const booked = await call("POST", "/admin/sessions", {
        courtId,
        startNow: true,
        durationMinutes: 60,
      });
      sessionId = booked.data.sessionId;
      const key = await call("POST", `/admin/sessions/${sessionId}/pairing-codes`, {
        name: "Tablet",
      });
      const paired = await ctx.api("POST", "/pair/app", { body: { code: key.data.code } });
      const link = await ctx.api("POST", "/app/session/stream-link", {
        headers: { Authorization: `App ${paired.data.token}` },
      });
      code = link.data.url.split("/stream/")[1];
    });

    it("tells the page there are 2 cameras, and refuses a layout change before a key", async () => {
      const page = await setup("GET");
      assert.equal(page.data.setup.cameras, 2);
      const early = await setup("PUT", { layout: "CAM2" });
      assert.equal(early.status, 409);
    });

    it("defaults to both stacked, and switches cameras without the key", async () => {
      const saved = await setup("PUT", { platform: "FACEBOOK", streamKey: "FB-222-0-PlayerKey77" });
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      assert.equal(saved.data.stream.layout, "STACKED");
      let entry = (await box("GET", "/device/config")).data.sessions.find(
        (s) => s.sessionId === sessionId
      );
      assert.equal(entry.stream.layout, "STACKED");
      assert.match(entry.stream.url, /PlayerKey77$/);

      const switched = await setup("PUT", { layout: "CAM2" });
      assert.equal(switched.status, 200, JSON.stringify(switched.body));
      assert.equal(switched.data.stream.layout, "CAM2");
      entry = (await box("GET", "/device/config")).data.sessions.find(
        (s) => s.sessionId === sessionId
      );
      assert.equal(entry.stream.layout, "CAM2");
      assert.match(entry.stream.url, /PlayerKey77$/, "the key is kept");
      assert.equal((await setup("PUT", { layout: "BOTH" })).status, 400);
    });

    it("on a 1-camera court the layout is always Cam 1", async () => {
      const single = await newCourt();
      const booked = await call("POST", "/admin/sessions", {
        courtId: single,
        startNow: true,
        durationMinutes: 60,
      });
      const key = await call("POST", `/admin/sessions/${booked.data.sessionId}/pairing-codes`, {
        name: "Tablet",
      });
      const paired = await ctx.api("POST", "/pair/app", { body: { code: key.data.code } });
      const link = await ctx.api("POST", "/app/session/stream-link", {
        headers: { Authorization: `App ${paired.data.token}` },
      });
      const singleCode = link.data.url.split("/stream/")[1];
      const page = await ctx.api("GET", `/public/stream-setup/${singleCode}`);
      assert.equal(page.data.setup.cameras, 1);
      const saved = await ctx.api("PUT", `/public/stream-setup/${singleCode}`, {
        body: { platform: "YOUTUBE", streamKey: "abcd-efgh-ijkl-mnop", layout: "STACKED" },
      });
      assert.equal(saved.data.stream.layout, null, "no camera choice on a 1-camera court");
    });
  });
});
