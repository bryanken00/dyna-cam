// PLAN-002 Phase E — a phone/tablet is paired to ONE recording session. It
// sees that session (timers, share link, saving progress) and a signed live
// view from the venue's recorder box, can stop the recording, and is unpaired
// 10 minutes after the session ends — or at once when staff cancel the session
// or unpair it.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";
import { gameJobs, sendGame } from "./helpers/gameUpload.js";

const LIVE_KEY = "ab".repeat(32);

describe("session devices", () => {
  let ctx;
  let admin;
  let viewer;
  const home = {};
  const other = {};

  const call = (method, url, body, who = admin) => ctx.api(method, url, { token: who.token, body });
  const asApp = (token) => (method, url, body) =>
    ctx.api(method, url, { body, headers: { Authorization: `App ${token}` } });
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

  /** Book a session on a fresh court of the venue (sessions on one court can't overlap). */
  let courtCount = 0;
  const book = async (target, body = {}) => {
    courtCount += 1;
    const court = await call("POST", "/admin/courts", {
      venueId: target.venueId,
      name: `Court ${courtCount + 1}`,
      cameraRtspUrl: "rtsp://u:p@10.0.0.9:554/stream1",
    });
    assert.equal(court.status, 201, JSON.stringify(court.body));
    const res = await call("POST", "/admin/sessions", {
      courtId: court.data.courtId,
      startNow: true,
      durationMinutes: 60,
      ...body,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.data.sessionId;
  };

  /** Pair a device to a session; returns { app, pairedAppId, session }. */
  const pairTo = async (sessionId, name = "Court 1 tablet") => {
    const key = await call("POST", `/admin/sessions/${sessionId}/pairing-codes`, { name });
    assert.equal(key.status, 201, JSON.stringify(key.body));
    const res = await ctx.api("POST", "/pair/app", {
      body: { code: key.data.code, platform: "android", appVersion: "1.0.0" },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.match(res.data.token, /^dca_/);
    return {
      app: asApp(res.data.token),
      pairedAppId: res.data.device.pairedAppId,
      session: res.data.session,
    };
  };

  before(async () => {
    ctx = await startTestApp({
      env: { RATE_LIMIT_PAIR_POINTS: "1000", RATE_LIMIT_PAIR_HOURLY_POINTS: "1000" },
    });
    admin = await ctx.createStaff("Admin", { access: "write" });
    viewer = await ctx.createStaff("Viewer", { access: "read" });
    for (const [target, name] of [
      [home, "Session Courts"],
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
      target.token = box.data.token;
      target.deviceId = box.data.deviceId;
    }
  });
  after(() => ctx?.stop());

  describe("a device paired to a running session", () => {
    let sessionId;
    let device;

    before(async () => {
      sessionId = await book(home);
      device = await pairTo(sessionId);
    });

    it("gets its session on pairing", () => {
      assert.equal(device.session.sessionId, sessionId);
      assert.match(device.session.courtName, /^Court \d+$/);
      assert.equal(device.session.venueName, "Session Courts");
      assert.match(device.session.shareUrl, /\/session\//);
    });

    it("sees the session recording, with no live view until the box reports one", async () => {
      const res = await device.app("GET", "/app/session");
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const { session, live, unpairInSeconds } = res.data;
      assert.equal(session.status, "Recording");
      assert.equal(session.startsInSeconds, 0);
      assert.ok(session.endsInSeconds > 59 * 60);
      assert.equal(live, null);
      assert.equal(unpairInSeconds, null);
      assert.equal(res.data.device.name, "Court 1 tablet");
    });

    it("gets a signed live-view link once the box reports its LAN address", async () => {
      const beat = await home.device("POST", "/device/heartbeat", {
        body: { cameras: [], live: { url: "http://192.168.1.50:8090", key: LIVE_KEY } },
      });
      assert.equal(beat.status, 200, JSON.stringify(beat.body));

      const res = await device.app("GET", "/app/session");
      const url = new URL(res.data.live.hlsUrl);
      assert.equal(url.origin, "http://192.168.1.50:8090");
      const { courtId } = device.session;
      assert.equal(url.pathname, `/live/${courtId}/index.m3u8`);
      const exp = url.searchParams.get("exp");
      const expected = crypto
        .createHmac("sha256", LIVE_KEY)
        .update(`${courtId}.${exp}`)
        .digest("hex");
      assert.equal(url.searchParams.get("sig"), expected);
      assert.ok(Number(exp) > Date.now() / 1000 + 10 * 60);

      // The key is stored encrypted and never shown
      const [[row]] = await ctx.sql.query(`SELECT liveKey FROM devices WHERE venueId = ?`, [
        home.venueId,
      ]);
      assert.ok(!String(row.liveKey).includes(LIVE_KEY));
      const courts = await call("GET", `/admin/courts?venueId=${home.venueId}`);
      assert.ok(!JSON.stringify(courts.body).includes(LIVE_KEY));
    });

    it("is listed on the session with its live keys", async () => {
      const pending = await call("POST", `/admin/sessions/${sessionId}/pairing-codes`, {
        name: "Spare",
      });
      const detail = await call("GET", `/admin/sessions/${sessionId}`);
      const { devices, pairingCodes, devicesCount } = detail.data.session;
      assert.equal(devicesCount, 1);
      assert.deepEqual(
        devices.map((d) => [d.pairedAppId, d.name, d.status]),
        [[device.pairedAppId, "Court 1 tablet", "Active"]]
      );
      assert.ok(devices[0].lastSeenSecondsAgo >= 0);
      assert.equal(devices[0].tokenHash, undefined);
      assert.ok(pairingCodes.some((k) => k.pairingCodeId === pending.data.pairingCodeId));
      const list = await call("GET", `/admin/sessions?courtId=${device.session.courtId}`);
      assert.equal(list.data.sessions[0].devicesCount, 1);
    });

    it("stops the recording, keeps working for 10 minutes, then is unpaired", async () => {
      // Pretend the game has run for 7 minutes → 2 parts
      await ctx.sql.query(`UPDATE recording_sessions SET startAt = ? WHERE sessionId = ?`, [
        await manila(-7),
        sessionId,
      ]);
      const stopped = await device.app("POST", "/app/session/stop");
      assert.equal(stopped.status, 200, JSON.stringify(stopped.body));
      assert.equal(stopped.data.session.status, "Processing");
      assert.equal(stopped.data.session.uploadPercent, null, "the box is making the file (CR-006)");
      assert.equal(stopped.data.live, null);
      assert.ok(stopped.data.unpairInSeconds > 590 && stopped.data.unpairInSeconds <= 600);
      assert.equal((await device.app("POST", "/app/session/stop")).status, 409);

      // CR-006: the box sends the game's one file → Ready, still visible to the device
      const jobs = await gameJobs(ctx, home.token, sessionId);
      assert.equal(jobs.length, 1);
      const res = await sendGame(ctx, home.token, jobs[0].sessionVideoId);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const ready = await device.app("GET", "/app/session");
      assert.equal(ready.data.session.status, "Ready");
      assert.equal(ready.data.session.uploadPercent, 100);

      // 11 minutes later the grace is over
      await ctx.sql.query(`UPDATE recording_sessions SET endAt = ? WHERE sessionId = ?`, [
        await manila(-11),
        sessionId,
      ]);
      const gone = await device.app("GET", "/app/session");
      assert.equal(gone.status, 401);
      assert.equal(gone.body.code, "TOKEN_INVALID");
      const [[row]] = await ctx.sql.query(`SELECT status FROM paired_apps WHERE pairedAppId = ?`, [
        device.pairedAppId,
      ]);
      assert.equal(row.status, "Revoked");
    });

    it("can't get a key for, or be paired to, a session that has ended", async () => {
      const res = await call("POST", `/admin/sessions/${sessionId}/pairing-codes`, {
        name: "Late",
      });
      assert.equal(res.status, 409);
    });
  });

  it("refuses a key whose session ended after it was made", async () => {
    const sessionId = await book(home, { durationMinutes: 30 });
    const key = await call("POST", `/admin/sessions/${sessionId}/pairing-codes`, { name: "x" });
    assert.equal((await call("POST", `/admin/sessions/${sessionId}/end`)).status, 200);
    await ctx.sql.query(`UPDATE recording_sessions SET endAt = ? WHERE sessionId = ?`, [
      await manila(-1),
      sessionId,
    ]);
    const res = await ctx.api("POST", "/pair/app", { body: { code: key.data.code } });
    assert.equal(res.status, 400);
  });

  it("a key never outlives its session", async () => {
    const sessionId = await book(other, {
      startNow: false,
      startAt: (await manila(60)).slice(0, 16),
      durationMinutes: 5,
    });
    await ctx.sql.query(
      `UPDATE recording_sessions SET startAt = ?, endAt = ? WHERE sessionId = ?`,
      [await manila(-1), await manila(3), sessionId]
    );
    const key = await call("POST", `/admin/sessions/${sessionId}/pairing-codes`, { name: "x" });
    assert.equal(key.status, 201);
    assert.ok(key.data.expiresInSeconds <= 3 * 60 + 5, "expires with the session");
  });

  it("before a later session starts: shows the start, can't stop it", async () => {
    const sessionId = await book(other, {
      startNow: false,
      startAt: (await manila(30)).slice(0, 16),
      durationMinutes: 30,
    });
    const device = await pairTo(sessionId);
    const res = await device.app("GET", "/app/session");
    assert.equal(res.data.session.status, "Scheduled");
    assert.ok(res.data.session.startsInSeconds > 25 * 60);
    assert.equal(res.data.live, null);
    const stop = await device.app("POST", "/app/session/stop");
    assert.equal(stop.status, 409);
    assert.match(stop.body.message, /hasn't started/);

    // Staff cancel the session → the device is unpaired at once
    assert.equal((await call("POST", `/admin/sessions/${sessionId}/cancel`)).status, 200);
    const gone = await device.app("GET", "/app/session");
    assert.equal(gone.status, 401);
    assert.equal(gone.body.code, "TOKEN_INVALID");
  });

  it("staff can unpair a device; Done unpairs it too", async () => {
    const sessionId = await book(other, { durationMinutes: 30 });
    const first = await pairTo(sessionId, "First");
    const second = await pairTo(sessionId, "Second");

    const unpair = (id) => call("POST", `/admin/sessions/${sessionId}/devices/${id}/unpair`);
    assert.equal((await unpair(first.pairedAppId)).status, 200);
    assert.equal((await first.app("GET", "/app/session")).status, 401);
    assert.equal((await unpair(first.pairedAppId)).status, 404, "already unpaired");

    assert.equal((await second.app("POST", "/app/unpair")).status, 200);
    assert.equal((await second.app("GET", "/app/session")).status, 401);

    // Another session's device can't be unpaired through this session
    const elsewhere = await pairTo(await book(home, { durationMinutes: 30 }), "Elsewhere");
    assert.equal((await unpair(elsewhere.pairedAppId)).status, 404);
    assert.equal((await elsewhere.app("GET", "/app/session")).status, 200);
  });

  it("returns 404 for unknown sessions, keys and devices", async () => {
    const missing = "00000000-0000-0000-0000-000000000000";
    assert.equal(
      (await call("POST", `/admin/sessions/${missing}/pairing-codes`, { name: "x" })).status,
      404
    );
    assert.equal(
      (await call("DELETE", `/admin/sessions/${missing}/pairing-codes/${missing}`)).status,
      404
    );
    assert.equal(
      (await call("POST", `/admin/sessions/${missing}/devices/${missing}/unpair`)).status,
      404
    );
  });

  it("needs clips write to pair or unpair", async () => {
    const sessionId = await book(other, { durationMinutes: 30 });
    assert.equal(
      (await call("POST", `/admin/sessions/${sessionId}/pairing-codes`, { name: "x" }, viewer))
        .status,
      403
    );
    assert.equal(
      (await call("GET", `/admin/sessions/${sessionId}`, undefined, viewer)).status,
      200,
      "read access can see the devices"
    );
  });

  it("a venue-wide phone from before Phase E, or no token, is refused", async () => {
    const token = `dca_${crypto.randomBytes(24).toString("base64url")}`;
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const now = await manila(0);
    await ctx.sql.query(
      `INSERT INTO paired_apps (pairedAppId, venueId, name, tokenHash, status, dateCreated, dateUpdated)
       VALUES (UUID(), ?, 'Old phone', ?, 'Active', ?, ?)`,
      [home.venueId, hash, now, now]
    );
    assert.equal((await asApp(token)("GET", "/app/session")).status, 401);
    assert.equal((await ctx.api("GET", "/app/session")).status, 401);
    assert.equal((await ctx.api("GET", "/app/session", { token: admin.token })).status, 401);
    // The Phase B–D routes are gone
    assert.equal((await asApp(token)("GET", "/app/courts")).status, 401);
  });
});
