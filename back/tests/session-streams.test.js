// PLAN-002 Phase G — a player streams their session to their own Facebook or
// YouTube: the session device shows a short-lived setup QR, the player pastes
// their stream key on their own phone, the recorder box gets the address only
// while the session records, and the key is never shown again and is
// forgotten when the session ends.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

const FB_KEY = "FB-1234567890123456-0-AbcdEFGHijklMNOPqrst";

describe("player's own live stream", () => {
  let ctx;
  let admin;
  let viewer;
  const venue = {};

  const call = (method, url, body, who = admin) => ctx.api(method, url, { token: who.token, body });
  const asApp = (token) => (method, url, body) =>
    ctx.api(method, url, { body, headers: { Authorization: `App ${token}` } });
  const asBox = (token) => (method, url, body) =>
    ctx.api(method, url, { body, headers: { Authorization: `Device ${token}` } });
  const setup = (method, code, body) => ctx.api(method, `/public/stream-setup/${code}`, { body });

  /** "YYYY-MM-DD HH:mm" in Manila, `minutes` from now. */
  const manila = async (minutes) => {
    const [[row]] = await ctx.sql.query(
      `SELECT DATE_FORMAT(DATE_ADD(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'),
               INTERVAL ? MINUTE), '%Y-%m-%d %H:%i') AS t`,
      [minutes]
    );
    return row.t;
  };

  let courtCount = 0;
  /** Book a session on a fresh court and pair a device to it. */
  const sessionWithDevice = async (body = { startNow: true }) => {
    courtCount += 1;
    const court = await call("POST", "/admin/courts", {
      venueId: venue.venueId,
      name: `Court ${courtCount}`,
      cameraRtspUrl: "rtsp://u:p@10.0.0.9:554/stream1",
    });
    const booked = await call("POST", "/admin/sessions", {
      courtId: court.data.courtId,
      durationMinutes: 60,
      ...body,
    });
    assert.equal(booked.status, 201, JSON.stringify(booked.body));
    const key = await call("POST", `/admin/sessions/${booked.data.sessionId}/pairing-codes`, {
      name: "Tablet",
    });
    const paired = await ctx.api("POST", "/pair/app", { body: { code: key.data.code } });
    assert.equal(paired.status, 201, JSON.stringify(paired.body));
    return { sessionId: booked.data.sessionId, app: asApp(paired.data.token) };
  };

  /** The device's setup link → the code in it. */
  const newCode = async (app) => {
    const res = await app("POST", "/app/session/stream-link");
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.match(res.data.url, /\/stream\/[A-Za-z0-9_-]{16,}$/);
    assert.equal(res.data.expiresInSeconds, 15 * 60);
    return res.data.url.split("/stream/")[1];
  };

  before(async () => {
    ctx = await startTestApp({
      env: { RATE_LIMIT_PAIR_POINTS: "1000", RATE_LIMIT_PAIR_HOURLY_POINTS: "1000" },
    });
    admin = await ctx.createStaff("Admin", { access: "write" });
    viewer = await ctx.createStaff("Viewer", { access: "read" });
    venue.venueId = (await call("POST", "/admin/venues", { name: "Stream Courts" })).data.venueId;
    venue.box = asBox((await ctx.pairBox(admin.token, venue.venueId, "Box")).data.token);
  });
  after(() => ctx?.stop());

  describe("on a recording session", () => {
    let session;
    let code;

    before(async () => {
      session = await sessionWithDevice();
      code = await newCode(session.app);
    });

    it("the player's page shows the session and no stream yet", async () => {
      const res = await setup("GET", code);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.data.setup.venueName, "Stream Courts");
      assert.match(res.data.setup.courtName, /^Court \d+$/);
      assert.equal(res.data.setup.sessionStatus, "Recording");
      assert.ok(res.data.setup.expiresInSeconds > 14 * 60);
      assert.equal(res.data.stream, null);
    });

    it("saves a Facebook key, shows it only masked, and stores it encrypted", async () => {
      const res = await setup("PUT", code, { platform: "FACEBOOK", streamKey: ` ${FB_KEY} ` });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.data.stream.platform, "FACEBOOK");
      assert.equal(res.data.stream.status, "starting");
      assert.equal(res.data.stream.maskedUrl, "rtmps://live-api-s.facebook.com:443/rtmp/••••qrst");
      assert.ok(!JSON.stringify(res.body).includes(FB_KEY));

      const [[row]] = await ctx.sql.query(
        `SELECT streamUrl FROM recording_sessions WHERE sessionId = ?`,
        [session.sessionId]
      );
      assert.ok(row.streamUrl && !row.streamUrl.includes(FB_KEY));

      for (const res2 of [
        await setup("GET", code),
        await session.app("GET", "/app/session"),
        await call("GET", `/admin/sessions/${session.sessionId}`),
        await call("GET", "/admin/sessions"),
      ]) {
        assert.equal(res2.status, 200);
        assert.ok(!JSON.stringify(res2.body).includes(FB_KEY), "the key is never returned");
      }
    });

    it("hands the box the full address, and shows the box's status everywhere", async () => {
      const config = await venue.box("GET", "/device/config");
      const entry = config.data.sessions.find((s) => s.sessionId === session.sessionId);
      assert.equal(entry.stream.url, `rtmps://live-api-s.facebook.com:443/rtmp/${FB_KEY}`);

      const beat = await venue.box("POST", "/device/heartbeat", {
        cameras: [],
        sessionStreams: [{ sessionId: session.sessionId, status: "live" }],
      });
      assert.equal(beat.status, 200, JSON.stringify(beat.body));
      assert.equal((await session.app("GET", "/app/session")).data.stream.status, "live");
      assert.equal((await setup("GET", code)).data.stream.status, "live");
      const detail = await call("GET", `/admin/sessions/${session.sessionId}`);
      assert.equal(detail.data.session.stream.status, "live");

      await venue.box("POST", "/device/heartbeat", {
        cameras: [],
        sessionStreams: [
          { sessionId: session.sessionId, status: "error", message: "Facebook refused the key" },
        ],
      });
      const failing = await setup("GET", code);
      assert.equal(failing.data.stream.status, "error");
      assert.equal(failing.data.stream.message, "Facebook refused the key");
    });

    it("refuses a bad key or address", async () => {
      for (const body of [
        { platform: "FACEBOOK", streamKey: "short" },
        { platform: "YOUTUBE", streamKey: "abc/def-ghi-jkl" },
        { platform: "OTHER", url: "http://example.com/live/key" },
        { platform: "OTHER", url: "rtmp://" },
        { platform: "TIKTOK", streamKey: "abcdefghijk" },
      ]) {
        assert.equal((await setup("PUT", code, body)).status, 400, JSON.stringify(body));
      }
    });

    it("takes YouTube and any other RTMP address too", async () => {
      const yt = await setup("PUT", code, { platform: "YOUTUBE", streamKey: "abcd-efgh-ijkl-mnop" });
      assert.equal(yt.status, 200);
      assert.equal(yt.data.stream.maskedUrl, "rtmp://a.rtmp.youtube.com/live2/••••mnop");
      const other = await setup("PUT", code, {
        platform: "OTHER",
        url: "rtmps://live.example.com/app/secret-key-123",
      });
      assert.equal(other.status, 200);
      const config = await venue.box("GET", "/device/config");
      assert.equal(
        config.data.sessions.find((s) => s.sessionId === session.sessionId).stream.url,
        "rtmps://live.example.com/app/secret-key-123"
      );
    });

    it("a new code replaces the old one", async () => {
      const fresh = await newCode(session.app);
      assert.equal((await setup("GET", code)).status, 404);
      assert.equal((await setup("GET", fresh)).status, 200);
      code = fresh;
    });

    it("stops from the player's page, the device or the Admin portal", async () => {
      assert.equal((await setup("DELETE", code)).status, 200);
      assert.equal((await setup("GET", code)).data.stream, null);
      let config = await venue.box("GET", "/device/config");
      assert.equal(config.data.sessions.find((s) => s.sessionId === session.sessionId).stream, null);

      await setup("PUT", code, { platform: "FACEBOOK", streamKey: FB_KEY });
      const stopped = await session.app("POST", "/app/session/stream/stop");
      assert.equal(stopped.status, 200);
      assert.equal((await session.app("GET", "/app/session")).data.stream, null);

      await setup("PUT", code, { platform: "FACEBOOK", streamKey: FB_KEY });
      assert.equal(
        (await call("POST", `/admin/sessions/${session.sessionId}/stream/stop`, undefined, viewer))
          .status,
        403
      );
      assert.equal((await call("POST", `/admin/sessions/${session.sessionId}/stream/stop`)).status, 200);
      config = await venue.box("GET", "/device/config");
      assert.equal(config.data.sessions.find((s) => s.sessionId === session.sessionId).stream, null);
    });

    it("forgets the key and the code when the session ends", async () => {
      await setup("PUT", code, { platform: "FACEBOOK", streamKey: FB_KEY });
      // The game has run a few minutes (a Stop in its first second keeps 1 s more)
      await ctx.sql.query(
        `UPDATE recording_sessions SET startAt = DATE_SUB(startAt, INTERVAL 5 MINUTE)
         WHERE sessionId = ?`,
        [session.sessionId]
      );
      assert.equal((await session.app("POST", "/app/session/stop")).status, 200);
      const [[row]] = await ctx.sql.query(
        `SELECT status, streamUrl, streamSetupTokenHash FROM recording_sessions WHERE sessionId = ?`,
        [session.sessionId]
      );
      assert.equal(row.status, "Processing");
      assert.equal(row.streamUrl, null);
      assert.equal(row.streamSetupTokenHash, null);
      assert.equal((await setup("GET", code)).status, 404);
      assert.equal((await session.app("POST", "/app/session/stream-link")).status, 409);
    });
  });

  it("before a later session starts: waiting, and not sent to the box yet", async () => {
    const later = await sessionWithDevice({ startNow: false, startAt: await manila(30) });
    const code = await newCode(later.app);
    const res = await setup("PUT", code, { platform: "FACEBOOK", streamKey: FB_KEY });
    assert.equal(res.status, 200);
    assert.equal(res.data.stream.status, "waiting");
    const config = await venue.box("GET", "/device/config");
    assert.equal(config.data.sessions.find((s) => s.sessionId === later.sessionId).stream, null);

    // Cancelling the booking forgets it
    assert.equal((await call("POST", `/admin/sessions/${later.sessionId}/cancel`)).status, 200);
    assert.equal((await setup("GET", code)).status, 404);
  });

  it("an unused code expires after 15 minutes", async () => {
    const { sessionId, app } = await sessionWithDevice();
    const code = await newCode(app);
    await ctx.sql.query(
      `UPDATE recording_sessions SET streamSetupExpiresAt = DATE_SUB(streamSetupExpiresAt,
         INTERVAL 16 MINUTE) WHERE sessionId = ?`,
      [sessionId]
    );
    assert.equal((await setup("GET", code)).status, 404);
    assert.equal((await setup("PUT", code, { platform: "FACEBOOK", streamKey: FB_KEY })).status, 404);
  });

  it("answers junk and unknown codes and sessions safely", async () => {
    assert.equal((await setup("GET", "not a code")).status, 400);
    assert.equal((await setup("GET", "AAAAAAAAAAAAAAAAAAAAAA")).status, 404);
    assert.equal((await setup("DELETE", "AAAAAAAAAAAAAAAAAAAAAA")).status, 404);
    const missing = "00000000-0000-0000-0000-000000000000";
    assert.equal((await call("POST", `/admin/sessions/${missing}/stream/stop`)).status, 404);
  });
});
