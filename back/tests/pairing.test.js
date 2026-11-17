// PLAN-002 — 6-digit pairing keys: a recorder box, or a phone/tablet for one
// recording session (Phase E), redeems a single-use key once for its own
// token. What a session device can then do is in session-devices.test.js;
// limits on guessing are in pairing-limits.test.js.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp, TEST_ENROLL_KEY } from "./helpers/testApp.js";

describe("pairing", () => {
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

  /** A key for a device of a session. */
  const sessionKey = async (sessionId, name, who = admin) => {
    const res = await call("POST", `/admin/sessions/${sessionId}/pairing-codes`, { name }, who);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.data;
  };
  const startSession = async (target) => {
    const res = await call("POST", "/admin/sessions", {
      courtId: target.courtId,
      startNow: true,
      durationMinutes: 60,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.data.sessionId;
  };

  before(async () => {
    ctx = await startTestApp({
      env: {
        RATE_LIMIT_PAIR_POINTS: "1000",
        RATE_LIMIT_PAIR_HOURLY_POINTS: "1000",
        PAIR_MAX_FAILURES: "1000",
      },
    });
    admin = await ctx.createStaff("Admin", { access: "write" });
    viewer = await ctx.createStaff("Viewer", { access: "read" });
    for (const [target, name, clipPrice] of [
      [home, "Pair Courts", 50],
      [other, "Other Courts", 0],
    ]) {
      target.venueId = (await call("POST", "/admin/venues", { name, clipPrice })).data.venueId;
      const court = await call("POST", "/admin/courts", {
        venueId: target.venueId,
        name: "Court 1",
        cameraRtspUrl: "rtsp://u:p@10.0.0.9:554/stream1",
      });
      target.courtId = court.data.courtId;
      target.qrToken = court.data.qrToken;
    }
  });
  after(() => ctx?.stop());

  describe("keys", () => {
    let sessionId;
    before(async () => {
      sessionId = await startSession(home);
    });

    it("are 6 digits, shown once, and never cached", async () => {
      const res = await ctx.api("POST", `/admin/sessions/${sessionId}/pairing-codes`, {
        token: admin.token,
        body: { name: "Court 1 tablet" },
        headers: { "Idempotency-Key": "key-create-1" },
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.match(res.data.code, /^\d{6}$/);
      assert.ok(res.data.expiresAt);
      assert.ok(res.data.expiresInSeconds > 500 && res.data.expiresInSeconds <= 600);
      const [cached] = await ctx.sql.query(`SELECT responseBody FROM idempotency_keys`);
      assert.ok(!JSON.stringify(cached).includes(res.data.code));
      const [[row]] = await ctx.sql.query(
        `SELECT codeHash FROM pairing_codes WHERE pairingCodeId = ?`,
        [res.data.pairingCodeId]
      );
      assert.notEqual(row.codeHash, res.data.code);

      const detail = await call("GET", `/admin/sessions/${sessionId}`);
      const listed = detail.data.session.pairingCodes.find(
        (p) => p.pairingCodeId === res.data.pairingCodeId
      );
      assert.ok(listed);
      assert.equal(listed.code, undefined, "the digits are never listed");
    });

    it("work once, and not after expiry or cancelling", async () => {
      const key = await sessionKey(sessionId, "Once");
      assert.equal((await ctx.api("POST", "/pair/app", { body: { code: key.code } })).status, 201);
      assert.equal((await ctx.api("POST", "/pair/app", { body: { code: key.code } })).status, 400);

      const expired = await sessionKey(sessionId, "Late");
      await ctx.sql.query(
        `UPDATE pairing_codes SET expiresAt = DATE_SUB(expiresAt, INTERVAL 11 MINUTE)
         WHERE pairingCodeId = ?`,
        [expired.pairingCodeId]
      );
      assert.equal(
        (await ctx.api("POST", "/pair/app", { body: { code: expired.code } })).status,
        400
      );

      const cancelled = await sessionKey(sessionId, "Cancelled");
      assert.equal(
        (
          await call(
            "DELETE",
            `/admin/sessions/${sessionId}/pairing-codes/${cancelled.pairingCodeId}`
          )
        ).status,
        200
      );
      assert.equal(
        (await ctx.api("POST", "/pair/app", { body: { code: cancelled.code } })).status,
        400
      );
      assert.equal(
        (
          await call(
            "DELETE",
            `/admin/sessions/${sessionId}/pairing-codes/${cancelled.pairingCodeId}`
          )
        ).status,
        404
      );
    });

    it("are for session devices only — boxes enrol from .env (Phase I)", async () => {
      assert.equal(
        (await call("POST", "/admin/pairing-codes/recorders", { venueId: home.venueId, name: "x" }))
          .status,
        404
      );
      const appKey = await sessionKey(sessionId, "Phone");
      assert.equal(
        (await ctx.api("POST", "/pair/device", { body: { code: appKey.code } })).status,
        404
      );
      const enrol = await ctx.api("POST", "/pair/enroll", {
        body: { enrollKey: appKey.code, venueId: home.venueId },
      });
      assert.equal(enrol.status, 400, "a session key is not an enrol key");
    });

    it("accept the key typed with a space or dash", async () => {
      const key = await sessionKey(sessionId, "Typed");
      const typed = `${key.code.slice(0, 3)} ${key.code.slice(3)}`;
      assert.equal((await ctx.api("POST", "/pair/app", { body: { code: typed } })).status, 201);
    });

    it("need the right permission", async () => {
      assert.equal(
        (await call("POST", `/admin/sessions/${sessionId}/pairing-codes`, { name: "x" }, viewer))
          .status,
        403
      );
      const nobody = await ctx.createStaff("Nobody");
      assert.equal(
        (await call("POST", `/admin/sessions/${sessionId}/pairing-codes`, { name: "x" }, nobody))
          .status,
        403
      );
    });

    it("no longer exist for a whole venue (Phase E)", async () => {
      assert.equal(
        (await call("POST", "/admin/pairing-codes/apps", { venueId: home.venueId, name: "x" }))
          .status,
        404
      );
      assert.equal((await call("GET", "/admin/paired-apps")).status, 404);
    });
  });

  describe("a recorder box (Phase I: enrols from .env)", () => {
    const enrol = (body, ip = "203.0.113.50") =>
      ctx.api("POST", "/pair/enroll", { body, headers: { "X-Forwarded-For": ip } });

    it("enrols with the API's key and its venue, once, for its own token", async () => {
      const res = await enrol({
        enrollKey: TEST_ENROLL_KEY,
        venueId: home.venueId,
        name: "Bry's Table",
        agentVersion: "1.2.0",
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.match(res.data.token, /^dcb_/);
      assert.deepEqual(res.data.venue, { venueId: home.venueId, name: "Pair Courts" });
      home.device = asDevice(res.data.token);
      const config = await home.device("GET", "/device/config");
      assert.equal(config.status, 200);
      assert.equal(config.data.device.name, "Bry's Table");
      const [[row]] = await ctx.sql.query(
        `SELECT tokenHash, agentVersion FROM devices WHERE deviceId = ?`,
        [res.data.device.deviceId]
      );
      assert.notEqual(row.tokenHash, res.data.token);
      assert.equal(row.agentVersion, "1.2.0");
      const [cached] = await ctx.sql.query(`SELECT responseBody FROM idempotency_keys`);
      assert.ok(!JSON.stringify(cached).includes(res.data.token));
    });

    it("refuses a wrong key, an unknown venue, and a deleted one alike", async () => {
      const gone = (await call("POST", "/admin/venues", { name: "Closed Courts" })).data.venueId;
      await call("DELETE", `/admin/venues/${gone}`);
      const cases = [
        [{ enrollKey: "x".repeat(48), venueId: home.venueId }, "203.0.113.51"],
        [{ enrollKey: TEST_ENROLL_KEY, venueId: "00000000-0000-0000-0000-000000000000" }, "203.0.113.52"],
        [{ enrollKey: TEST_ENROLL_KEY, venueId: gone }, "203.0.113.53"],
      ];
      for (const [body, ip] of cases) {
        const res = await enrol(body, ip);
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.match(res.body.message, /isn't accepted/);
      }
      assert.equal((await enrol({ enrollKey: TEST_ENROLL_KEY }, "203.0.113.54")).status, 400);
    });
  });
});
