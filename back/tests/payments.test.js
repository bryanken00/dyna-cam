// PLAN-001 Phase 4 — paid clips, cash at the front desk: a priced player clip
// is locked (thumbnail + pay code only) until staff record the payment;
// refunding locks it again. Staff saves are free.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { JPEG, startTestApp } from "./helpers/testApp.js";

const MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from("ftypisom"),
  Buffer.alloc(64, 1),
]);

describe("clip payments (cash)", () => {
  let ctx;
  let admin;
  let viewer;
  const paid = {}; // a venue that charges
  const free = {}; // a venue that doesn't

  const call = (method, url, body, who = admin) => ctx.api(method, url, { token: who.token, body });
  const asDevice =
    (token) =>
    (method, url, options = {}) =>
      ctx.api(method, url, { ...options, headers: { Authorization: `Device ${token}` } });

  const setupVenue = async (target, name, clipPrice) => {
    const venue = await call("POST", "/admin/venues", { name, clipPrice });
    assert.equal(venue.status, 201, JSON.stringify(venue.body));
    target.venueId = venue.data.venueId;
    const court = await call("POST", "/admin/courts", {
      venueId: target.venueId,
      name: "Court 1",
      cameraRtspUrl: "rtsp://u:p@10.0.0.9:554/stream1",
    });
    target.courtId = court.data.courtId;
    target.qrToken = court.data.qrToken;
    const box = await call("POST", "/admin/devices", { venueId: target.venueId, name: "Box" });
    target.device = asDevice(box.data.token);
    await target.device("GET", "/device/config"); // online
  };

  const ageClips = (courtId) =>
    ctx.sql.query(
      `UPDATE clips SET requestedAt = DATE_SUB(requestedAt, INTERVAL 1 MINUTE) WHERE courtId = ?`,
      [courtId]
    );

  /** Save a clip by QR, have the box upload it; returns { shareToken, clipId }. */
  const readyClip = async (target) => {
    await ageClips(target.courtId);
    const save = await ctx.api("POST", `/public/courts/${target.qrToken}/clips`);
    assert.equal(save.status, 201, JSON.stringify(save.body));
    const [[row]] = await ctx.sql.query(`SELECT clipId FROM clips WHERE shareToken = ?`, [
      save.data.shareToken,
    ]);
    const upload = await target.device("POST", `/device/clips/${row.clipId}/upload`, {
      form: [
        ["video", MP4, "video/mp4", "c.mp4"],
        ["thumbnail", JPEG, "image/jpeg", "c.jpg"],
      ],
    });
    assert.equal(upload.status, 200);
    return { shareToken: save.data.shareToken, clipId: row.clipId };
  };

  before(async () => {
    ctx = await startTestApp();
    admin = await ctx.createStaff("Admin", { access: "write" });
    viewer = await ctx.createStaff("Viewer", { access: "read" });
    await setupVenue(paid, "Paid Courts", 50);
    await setupVenue(free, "Free Courts", 0);
  });
  after(() => ctx?.stop());

  let clip;
  let payCode;

  it("locks a priced clip: thumbnail and pay code, no video", async () => {
    clip = await readyClip(paid);
    const page = await ctx.api("GET", `/public/clips/${clip.shareToken}`);
    assert.equal(page.data.clip.status, "Ready");
    assert.equal(page.data.clip.locked, true);
    assert.equal(page.data.clip.price, 50);
    assert.equal(page.data.clip.videoUrl, null);
    assert.equal(page.data.clip.downloadUrl, null);
    assert.ok(page.data.clip.thumbnailUrl, "the player still sees what they're paying for");
    assert.match(page.data.clip.payCode, /^[A-Z2-9]{6}$/);
    payCode = page.data.clip.payCode;

    const adminView = await call("GET", `/admin/clips/${clip.clipId}`);
    assert.equal(adminView.data.clip.paymentStatus, "Unpaid");
    assert.ok(adminView.data.clip.videoUrl, "staff can still check the clip");
  });

  it("finds the clip by its pay code, however it is typed", async () => {
    const typed = `${payCode.slice(0, 3).toLowerCase()} ${payCode.slice(3)}`;
    const found = await call("GET", `/admin/payments/lookup?payCode=${encodeURIComponent(typed)}`);
    assert.equal(found.status, 200, JSON.stringify(found.body));
    assert.equal(found.data.clip.clipId, clip.clipId);
    assert.equal(found.data.clip.price, 50);
    assert.equal(found.data.clip.courtName, "Court 1");
    assert.equal((await call("GET", "/admin/payments/lookup?payCode=ZZZZZZ")).status, 404);
  });

  it("records the cash payment and unlocks the clip — once", async () => {
    assert.equal(
      (await call("POST", "/admin/payments", { payCode }, viewer)).status,
      403,
      "read access can't take payments"
    );
    const payment = await call("POST", "/admin/payments", { payCode, note: "Paid at desk" });
    assert.equal(payment.status, 201, JSON.stringify(payment.body));
    assert.equal(payment.data.amount, 50);
    clip.paymentId = payment.data.paymentId;

    const page = await ctx.api("GET", `/public/clips/${clip.shareToken}`);
    assert.equal(page.data.clip.locked, false);
    assert.equal(page.data.clip.payCode, null);
    assert.ok(page.data.clip.videoUrl);
    assert.ok(page.data.clip.downloadUrl);

    assert.equal((await call("POST", "/admin/payments", { payCode })).status, 409);

    const list = await call("GET", "/admin/payments");
    assert.equal(list.status, 200);
    assert.equal(list.data.totals.today, 50);
    assert.equal(list.data.totals.countToday, 1);
    assert.equal(list.data.payments[0].method, "CASH");
    assert.ok(list.data.payments[0].receivedBy);
  });

  it("locks the clip again on refund", async () => {
    const refund = await call("POST", `/admin/payments/${clip.paymentId}/refund`, {});
    assert.equal(refund.status, 200);
    const page = await ctx.api("GET", `/public/clips/${clip.shareToken}`);
    assert.equal(page.data.clip.locked, true);
    assert.equal(page.data.clip.videoUrl, null);
    assert.equal((await call("POST", `/admin/payments/${clip.paymentId}/refund`, {})).status, 409);
    const list = await call("GET", "/admin/payments");
    assert.equal(list.data.totals.today, 0);
  });

  it("can take payment from the clip itself (Clips page)", async () => {
    const payment = await call("POST", "/admin/payments", { clipId: clip.clipId });
    assert.equal(payment.status, 201);
    const page = await ctx.api("GET", `/public/clips/${clip.shareToken}`);
    assert.equal(page.data.clip.locked, false);
  });

  it("keeps free venues and staff saves free", async () => {
    const freeClip = await readyClip(free);
    const page = await ctx.api("GET", `/public/clips/${freeClip.shareToken}`);
    assert.equal(page.data.clip.locked, false);
    assert.equal(page.data.clip.paymentStatus, "Free");
    assert.equal(page.data.clip.payCode, null);
    assert.ok(page.data.clip.videoUrl);
    assert.equal((await call("POST", "/admin/payments", { clipId: freeClip.clipId })).status, 409);

    await ageClips(paid.courtId);
    const staff = await call("POST", "/admin/clips", { courtId: paid.courtId });
    assert.equal(staff.status, 201);
    const adminView = await call("GET", `/admin/clips/${staff.data.clipId}`);
    assert.equal(adminView.data.clip.paymentStatus, "Free");
    assert.equal(adminView.data.clip.price, 0);
  });

  it("won't take payment for a clip that failed", async () => {
    await ageClips(paid.courtId);
    const save = await ctx.api("POST", `/public/courts/${paid.qrToken}/clips`);
    const [[row]] = await ctx.sql.query(`SELECT clipId FROM clips WHERE shareToken = ?`, [
      save.data.shareToken,
    ]);
    await paid.device("POST", `/device/clips/${row.clipId}/fail`, { body: { reason: "x" } });
    assert.equal((await call("POST", "/admin/payments", { clipId: row.clipId })).status, 409);
  });

  it("gives the Payments filter its venues under the payments permission alone", async () => {
    const cashier = await ctx.createStaff("Cashier");
    const perms = (await call("GET", "/admin/permissions")).data.permissions;
    const payments = perms.find((p) => p.module === "payments" && !p.submodule);
    await call("POST", `/admin/roles/${cashier.roleId}/permissions`, {
      permissions: [{ permissionId: payments.permissionId, accessLevel: "write" }],
    });
    const options = await ctx.api("GET", "/admin/payments/options", { token: cashier.token });
    assert.equal(options.status, 200);
    assert.ok(options.data.venues.some((v) => v.venueId === paid.venueId));
    assert.equal(
      (await ctx.api("GET", "/admin/clips/options", { token: cashier.token })).status,
      403
    );
    const found = await ctx.api("GET", `/admin/payments/lookup?payCode=${payCode}`, {
      token: cashier.token,
    });
    assert.equal(found.status, 200);
  });

  it("shows the venue's clip price", async () => {
    const venue = await call("GET", `/admin/venues/${paid.venueId}`);
    assert.equal(venue.data.venue.clipPrice, 50);
    const bad = await call("POST", "/admin/venues", { name: "Cheap", clipPrice: 1.234 });
    assert.equal(bad.status, 400);
  });
});
