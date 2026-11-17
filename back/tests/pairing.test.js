// PLAN-002 Phase B — 6-digit pairing keys: a staff phone or recorder box
// redeems a single-use, 10-minute key once for its own token; a paired phone
// then works for its venue only (courts, Record, recent clips, cash) until
// it is revoked. Limits on guessing are in pairing-limits.test.js.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { JPEG, startTestApp } from "./helpers/testApp.js";

const MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from("ftypisom"),
  Buffer.alloc(64, 1),
]);

describe("pairing", () => {
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

  const newKey = async (kind, venueId, name) => {
    const res = await call("POST", `/admin/pairing-codes/${kind}`, { venueId, name });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.data;
  };
  const pairPhone = async (target, name) => {
    const key = await newKey("apps", target.venueId, name);
    const res = await ctx.api("POST", "/pair/app", {
      body: { code: key.code, platform: "android", appVersion: "1.0.0" },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.data;
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
    it("are 6 digits, shown once, and never cached", async () => {
      const res = await ctx.api("POST", "/admin/pairing-codes/apps", {
        token: admin.token,
        body: { venueId: home.venueId, name: "Front desk phone" },
        headers: { "Idempotency-Key": "key-create-1" },
      });
      assert.equal(res.status, 201);
      assert.match(res.data.code, /^\d{6}$/);
      assert.ok(res.data.expiresAt);
      const [cached] = await ctx.sql.query(`SELECT responseBody FROM idempotency_keys`);
      assert.ok(!JSON.stringify(cached).includes(res.data.code));
      const [[row]] = await ctx.sql.query(
        `SELECT codeHash FROM pairing_codes WHERE pairingCodeId = ?`,
        [res.data.pairingCodeId]
      );
      assert.notEqual(row.codeHash, res.data.code);

      const list = await call("GET", "/admin/pairing-codes/apps");
      const listed = list.data.pairingCodes.find((p) => p.pairingCodeId === res.data.pairingCodeId);
      assert.ok(listed);
      assert.equal(listed.code, undefined, "the digits are never listed");
    });

    it("work once, and not after expiry or cancelling", async () => {
      const key = await newKey("apps", home.venueId, "Once");
      assert.equal((await ctx.api("POST", "/pair/app", { body: { code: key.code } })).status, 201);
      assert.equal((await ctx.api("POST", "/pair/app", { body: { code: key.code } })).status, 400);

      const expired = await newKey("apps", home.venueId, "Late");
      await ctx.sql.query(
        `UPDATE pairing_codes SET expiresAt = DATE_SUB(expiresAt, INTERVAL 11 MINUTE)
         WHERE pairingCodeId = ?`,
        [expired.pairingCodeId]
      );
      assert.equal(
        (await ctx.api("POST", "/pair/app", { body: { code: expired.code } })).status,
        400
      );

      const cancelled = await newKey("apps", home.venueId, "Cancelled");
      assert.equal(
        (await call("DELETE", `/admin/pairing-codes/apps/${cancelled.pairingCodeId}`)).status,
        200
      );
      assert.equal(
        (await ctx.api("POST", "/pair/app", { body: { code: cancelled.code } })).status,
        400
      );
    });

    it("of one kind don't pair the other kind", async () => {
      const appKey = await newKey("apps", home.venueId, "Phone");
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
      const key = await newKey("apps", home.venueId, "Typed");
      const typed = `${key.code.slice(0, 3)} ${key.code.slice(3)}`;
      assert.equal((await ctx.api("POST", "/pair/app", { body: { code: typed } })).status, 201);
    });

    it("need the right permission", async () => {
      assert.equal(
        (
          await call(
            "POST",
            "/admin/pairing-codes/apps",
            { venueId: home.venueId, name: "x" },
            viewer
          )
        ).status,
        403
      );
      const nobody = await ctx.createStaff("Nobody");
      assert.equal(
        (await call("GET", "/admin/pairing-codes/recorders", undefined, nobody)).status,
        403
      );
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

  describe("a paired phone", () => {
    let phone;
    let clipId;

    before(async () => {
      const paired = await pairPhone(home, "Front desk phone");
      assert.match(paired.token, /^dca_/);
      assert.equal(paired.venue.venueId, home.venueId);
      phone = asApp(paired.token);
      home.pairedAppId = paired.pairedApp.pairedAppId;
    });

    it("sees its venue and courts, not another venue's", async () => {
      const me = await phone("GET", "/app/me");
      assert.equal(me.status, 200);
      assert.equal(me.data.venue.name, "Pair Courts");
      const courts = await phone("GET", "/app/courts");
      assert.deepEqual(
        courts.data.courts.map((c) => [c.courtId, c.canRecord]),
        [[home.courtId, true]]
      );
      assert.equal((await phone("POST", `/app/courts/${other.courtId}/clips`)).status, 404);
      assert.equal((await phone("GET", `/app/courts/${other.courtId}/clips`)).status, 404);
    });

    it("records the last 60 s as a free staff clip, credited to the phone", async () => {
      const res = await phone("POST", `/app/courts/${home.courtId}/clips`);
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.match(res.data.shareUrl, /\/clip\//);
      clipId = res.data.clipId;
      const again = await phone("POST", `/app/courts/${home.courtId}/clips`);
      assert.equal(again.data.merged, true);

      const clip = await phone("GET", `/app/clips/${clipId}`);
      assert.equal(clip.data.clip.status, "Pending");
      assert.equal(clip.data.clip.source, "STAFF");
      assert.equal(clip.data.clip.paymentStatus, "Free");

      const adminView = await call("GET", `/admin/clips/${clipId}`);
      assert.equal(adminView.data.clip.pairedAppName, "Front desk phone");
    });

    it("lists the court's recent clips to show a QR again", async () => {
      const recent = await phone("GET", `/app/courts/${home.courtId}/clips?limit=5`);
      assert.equal(recent.status, 200);
      assert.ok(recent.data.clips.some((c) => c.clipId === clipId && c.shareUrl));
    });

    it("takes cash for its venue's clips only", async () => {
      // A player's priced clip at this venue, made ready by the box
      await ctx.sql.query(
        `UPDATE clips SET requestedAt = DATE_SUB(requestedAt, INTERVAL 1 MINUTE) WHERE courtId = ?`,
        [home.courtId]
      );
      const save = await ctx.api("POST", `/public/courts/${home.qrToken}/clips`);
      assert.equal(save.status, 201);
      const [[row]] = await ctx.sql.query(
        `SELECT clipId, payCode FROM clips WHERE shareToken = ?`,
        [save.data.shareToken]
      );
      await home.device("POST", `/device/clips/${row.clipId}/upload`, {
        form: [
          ["video", MP4, "video/mp4", "c.mp4"],
          ["thumbnail", JPEG, "image/jpeg", "c.jpg"],
        ],
      });

      const found = await phone("GET", `/app/payments/lookup?payCode=${row.payCode.toLowerCase()}`);
      assert.equal(found.status, 200, JSON.stringify(found.body));
      assert.equal(found.data.clip.price, 50);
      const paid = await phone("POST", "/app/payments", { payCode: row.payCode });
      assert.equal(paid.status, 201, JSON.stringify(paid.body));
      assert.equal((await phone("POST", "/app/payments", { payCode: row.payCode })).status, 409);

      const page = await ctx.api("GET", `/public/clips/${save.data.shareToken}`);
      assert.equal(page.data.clip.locked, false);
      const payments = await call("GET", "/admin/payments");
      assert.equal(payments.data.payments[0].receivedBy, "Front desk phone (phone)");

      // Another venue's phone can't find or pay it
      const otherPhone = asApp((await pairPhone(other, "Other phone")).token);
      assert.equal(
        (await otherPhone("GET", `/app/payments/lookup?payCode=${row.payCode}`)).status,
        404
      );
    });

    it("is listed, can be renamed, and stops working once revoked", async () => {
      const list = await call("GET", `/admin/paired-apps?venueId=${home.venueId}`);
      const listed = list.data.pairedApps.find((p) => p.pairedAppId === home.pairedAppId);
      assert.equal(listed.platform, "android");
      assert.ok(listed.lastSeenSecondsAgo >= 0);
      assert.equal(listed.tokenHash, undefined);

      assert.equal(
        (await call("PUT", `/admin/paired-apps/${home.pairedAppId}`, { name: "Desk 1" })).status,
        200
      );
      assert.equal(
        (await call("POST", `/admin/paired-apps/${home.pairedAppId}/revoke`)).status,
        200
      );
      const refused = await phone("GET", "/app/courts");
      assert.equal(refused.status, 401);
      assert.equal(refused.body.code, "TOKEN_INVALID");
    });

    it("treats a deleted phone as missing and leaves it alone", async () => {
      const paired = await pairPhone(home, "To delete");
      const id = paired.pairedApp.pairedAppId;
      assert.equal((await call("DELETE", `/admin/paired-apps/${id}`)).status, 200);
      assert.equal((await call("GET", `/admin/paired-apps/${id}`)).status, 404);
      assert.equal((await call("PUT", `/admin/paired-apps/${id}`, { name: "x" })).status, 404);
      assert.equal((await call("POST", `/admin/paired-apps/${id}/revoke`)).status, 404);
      assert.equal((await call("DELETE", `/admin/paired-apps/${id}`)).status, 404);
      assert.equal((await asApp(paired.token)("GET", "/app/me")).status, 401);
      const [[row]] = await ctx.sql.query(`SELECT name FROM paired_apps WHERE pairedAppId = ?`, [
        id,
      ]);
      assert.equal(row.name, "To delete");
    });

    it("can unpair itself, which revokes it on the server", async () => {
      const paired = await pairPhone(home, "Self unpair");
      const self = asApp(paired.token);
      assert.equal((await self("POST", "/app/unpair")).status, 200);
      const refused = await self("GET", "/app/me");
      assert.equal(refused.status, 401);
      assert.equal(refused.body.code, "TOKEN_INVALID");
      const listed = await call("GET", `/admin/paired-apps/${paired.pairedApp.pairedAppId}`);
      assert.equal(listed.data.pairedApp.status, "Revoked");
    });

    it("can't use a user's login or nothing at all", async () => {
      assert.equal((await ctx.api("GET", "/app/courts")).status, 401);
      assert.equal((await ctx.api("GET", "/app/courts", { token: admin.token })).status, 401);
    });
  });
});
