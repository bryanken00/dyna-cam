// PLAN-002 — 6-digit pairing keys: a recorder box, or a phone/tablet for one
// recording session (Phase E), redeems a single-use key once for its own
// token. What a session device can then do is in session-devices.test.js;
// limits on guessing are in pairing-limits.test.js.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

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

  /** A key for a recorder box (`recorders`) of a venue. */
  const newKey = async (kind, venueId, name) => {
    const res = await call("POST", `/admin/pairing-codes/${kind}`, { venueId, name });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.data;
  };
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

    it("of one kind don't pair the other kind", async () => {
      const appKey = await sessionKey(sessionId, "Phone");
      assert.equal(
        (await ctx.api("POST", "/pair/device", { body: { code: appKey.code } })).status,
        400
      );
      const boxKey = await newKey("recorders", home.venueId, "Box");
      assert.equal(
        (await ctx.api("POST", "/pair/app", { body: { code: boxKey.code } })).status,
        400
      );
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
        (await call("GET", "/admin/pairing-codes/recorders", undefined, nobody)).status,
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

  describe("a recorder box", () => {
    it("pairs with a key instead of a copied token", async () => {
      const key = await newKey("recorders", home.venueId, "Paired box");
      const res = await ctx.api("POST", "/pair/device", {
        body: { code: key.code, agentVersion: "1.2.0" },
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.match(res.data.token, /^dcb_/);
      assert.equal(res.data.venue.venueId, home.venueId);
      home.device = asDevice(res.data.token);
      const config = await home.device("GET", "/device/config");
      assert.equal(config.status, 200);
      assert.equal(config.data.device.name, "Paired box");
    });
  });
});
