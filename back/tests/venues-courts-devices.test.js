// PLAN-001 — the Admin portal's venues, courts and recorder boxes.
// Covers CRUD, the deleted-record 404 rule, write-only camera URLs, QR rotation,
// device tokens (shown once, revocable, re-issuable) and permission gating.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { runScript, runScriptArgs, startTestApp } from "./helpers/testApp.js";

const CAMERA = "rtsp://cam-user:s3cret-pass@192.168.1.50:554/stream1";

describe("venues, courts and recorder boxes", () => {
  let ctx;
  let admin; // staff with write access to everything
  let viewer; // staff with read access to everything

  const call = (method, url, body, who = admin) => ctx.api(method, url, { token: who.token, body });
  const device = (method, url, token, body) =>
    ctx.api(method, url, { body, headers: { Authorization: `Device ${token}` } });

  const createVenue = async (name) => {
    const res = await call("POST", "/admin/venues", { name, clipRetentionDays: 14 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.data.venueId;
  };

  before(async () => {
    ctx = await startTestApp();
    admin = await ctx.createStaff("Admin", { access: "write" });
    viewer = await ctx.createStaff("Viewer", { access: "read" });
  });
  after(() => ctx?.stop());

  describe("venues", () => {
    it("creates, lists, reads and updates a venue", async () => {
      const venueId = await createVenue("Antipolo Dink Yard");

      const list = await call("GET", "/admin/venues?search=Antipolo");
      assert.equal(list.status, 200);
      assert.ok(list.data.venues.some((v) => v.venueId === venueId));

      const updated = await call("PUT", `/admin/venues/${venueId}`, {
        name: "Antipolo Dink Yard",
        phone: "+639123456789",
        clipRetentionDays: 7,
      });
      assert.equal(updated.status, 200);

      const one = await call("GET", `/admin/venues/${venueId}`);
      assert.equal(one.status, 200);
      assert.equal(one.data.venue.phone, "0912 3456 789");
      assert.equal(one.data.venue.clipRetentionDays, 7);
      assert.equal(one.data.venue.courtCount, 0);
    });

    it("refuses a duplicate venue name", async () => {
      await createVenue("Duplicate Arena");
      const again = await call("POST", "/admin/venues", { name: "Duplicate Arena" });
      assert.equal(again.status, 409);
    });

    it("treats a deleted venue as missing, leaves it alone, and retires its courts and boxes", async () => {
      const venueId = await createVenue("Closing Down Courts");
      const court = await call("POST", "/admin/courts", { venueId, name: "Court 1" });
      const box = await ctx.pairBox(admin.token, venueId, "Box");
      assert.equal(court.status, 201);
      assert.equal(box.status, 201);

      assert.equal((await call("DELETE", `/admin/venues/${venueId}`)).status, 200);

      assert.equal((await call("GET", `/admin/venues/${venueId}`)).status, 404);
      assert.equal(
        (await call("PUT", `/admin/venues/${venueId}`, { name: "Changed", clipRetentionDays: 3 }))
          .status,
        404
      );
      assert.equal((await call("DELETE", `/admin/venues/${venueId}`)).status, 404);

      const [[row]] = await ctx.sql.query(`SELECT name, status FROM venues WHERE venueId = ?`, [
        venueId,
      ]);
      assert.equal(row.name, "Closing Down Courts");
      assert.equal(row.status, "Deleted");

      const [[courtRow]] = await ctx.sql.query(`SELECT status FROM courts WHERE courtId = ?`, [
        court.data.courtId,
      ]);
      assert.equal(courtRow.status, "Deleted");
      assert.equal((await device("GET", "/device/config", box.data.token)).status, 401);
    });
  });

  describe("courts", () => {
    let venueId;
    let courtId;

    before(async () => {
      venueId = await createVenue("Alabang Dink Arena");
    });

    it("stores the camera URL but never returns it", async () => {
      const created = await call("POST", "/admin/courts", {
        venueId,
        name: "Court 1",
        cameraRtspUrl: CAMERA,
      });
      assert.equal(created.status, 201);
      courtId = created.data.courtId;
      assert.match(created.data.qrUrl, /\/court\/[A-Za-z0-9_-]{16,}$/);

      const one = await call("GET", `/admin/courts/${courtId}`);
      assert.equal(one.status, 200);
      const text = JSON.stringify(one.body);
      assert.ok(!text.includes("s3cret-pass"), "password must not leave the API");
      assert.ok(!text.includes("cam-user"), "username must not leave the API");
      assert.equal(one.data.court.camera.configured, true);
      assert.equal(one.data.court.camera.display, "rtsp://192.168.1.50:554/stream1");
      assert.equal(one.data.court.venueName, "Alabang Dink Arena");

      // Encrypted at rest
      const [[row]] = await ctx.sql.query(`SELECT cameraRtspUrl FROM courts WHERE courtId = ?`, [
        courtId,
      ]);
      assert.ok(row.cameraRtspUrl.startsWith("v1:"));
      assert.ok(!row.cameraRtspUrl.includes("s3cret-pass"));
    });

    it("keeps the camera on an update that leaves it blank, and clears it on request", async () => {
      assert.equal(
        (await call("PUT", `/admin/courts/${courtId}`, { name: "Court One", cameraRtspUrl: "" }))
          .status,
        200
      );
      let one = await call("GET", `/admin/courts/${courtId}`);
      assert.equal(one.data.court.name, "Court One");
      assert.equal(one.data.court.camera.configured, true);

      assert.equal(
        (await call("PUT", `/admin/courts/${courtId}`, { name: "Court One", removeCamera: true }))
          .status,
        200
      );
      one = await call("GET", `/admin/courts/${courtId}`);
      assert.equal(one.data.court.camera.configured, false);
    });

    it("rejects a camera address that is not RTSP", async () => {
      const res = await call("POST", "/admin/courts", {
        venueId,
        name: "Court 9",
        cameraRtspUrl: "http://192.168.1.50/stream",
      });
      assert.equal(res.status, 400);
    });

    it("refuses a duplicate court name within the venue", async () => {
      const again = await call("POST", "/admin/courts", { venueId, name: "Court One" });
      assert.equal(again.status, 409);
    });

    it("rotates the QR code", async () => {
      const before = await call("GET", `/admin/courts/${courtId}`);
      const rotated = await call("POST", `/admin/courts/${courtId}/rotate-qr`);
      assert.equal(rotated.status, 200);
      assert.notEqual(rotated.data.qrToken, before.data.court.qrToken);
      assert.equal(
        (await ctx.api("GET", `/public/courts/${before.data.court.qrToken}`)).status,
        404,
        "the old QR code stops working"
      );
      assert.equal((await ctx.api("GET", `/public/courts/${rotated.data.qrToken}`)).status, 200);
    });

    it("treats a deleted court as missing and leaves it alone", async () => {
      const created = await call("POST", "/admin/courts", { venueId, name: "Court Doomed" });
      const id = created.data.courtId;
      assert.equal((await call("DELETE", `/admin/courts/${id}`)).status, 200);

      assert.equal((await call("GET", `/admin/courts/${id}`)).status, 404);
      assert.equal((await call("PUT", `/admin/courts/${id}`, { name: "Changed" })).status, 404);
      assert.equal((await call("POST", `/admin/courts/${id}/rotate-qr`)).status, 404);
      assert.equal((await call("DELETE", `/admin/courts/${id}`)).status, 404);

      const [[row]] = await ctx.sql.query(`SELECT name FROM courts WHERE courtId = ?`, [id]);
      assert.equal(row.name, "Court Doomed");
    });
  });

  describe("recorder boxes", () => {
    let venueId;

    before(async () => {
      venueId = await createVenue("Quezon City Pickle Hub");
    });

    it("enrols from .env, and stores only the token's hash", async () => {
      const created = await ctx.pairBox(admin.token, venueId, "Front box");
      assert.equal(created.status, 201);
      const { deviceId, token } = created.data;
      assert.match(token, /^dcb_/);
      const [[row]] = await ctx.sql.query(
        `SELECT tokenHash, lastSeenAt FROM devices WHERE deviceId = ?`,
        [deviceId]
      );
      assert.notEqual(row.tokenHash, token);
      assert.ok(row.lastSeenAt, "enrolling counts as a sign of life");
      assert.equal((await device("GET", "/device/config", token)).status, 200);
    });

    it("is listed and revoked from the API's command line, for good", async () => {
      const created = await ctx.pairBox(admin.token, venueId, "Back box");
      const { deviceId, token } = created.data;
      const env = { DB_DATABASE: ctx.database };

      const listed = runScript("boxes.js", env);
      assert.ok(listed.ok, listed.output);
      assert.match(listed.output, /Back box/);
      assert.match(listed.output, /Quezon City Pickle Hub/);

      const byName = runScriptArgs("boxes.js", ["revoke", "Back box"], env);
      assert.ok(byName.ok, byName.output);
      assert.match(byName.output, /Revoked Quezon City Pickle Hub · Back box/);
      assert.equal((await device("GET", "/device/config", token)).status, 401);
      assert.match(runScriptArgs("boxes.js", ["revoke", deviceId], env).output, /already revoked/);
      assert.equal(runScriptArgs("boxes.js", ["revoke", "No such box"], env).ok, false);

      // A new enrolment is a new box; the revoked token stays dead
      const again = await ctx.pairBox(admin.token, venueId, "Back box");
      assert.equal(again.status, 201);
      assert.notEqual(again.data.deviceId, deviceId);
      assert.equal((await device("GET", "/device/config", token)).status, 401);
      // By name, only active boxes count — the new "Back box" is the one revoked
      const second = runScriptArgs("boxes.js", ["revoke", "Back box"], env);
      assert.ok(second.ok, second.output);
      assert.equal((await device("GET", "/device/config", again.data.token)).status, 401);
    });

    it("has no Recorder Boxes page or box pairing keys any more (Phase I)", async () => {
      assert.equal((await call("GET", "/admin/devices")).status, 404);
      assert.equal((await call("POST", "/admin/devices", { venueId, name: "x" })).status, 404);
      assert.equal((await call("GET", "/admin/pairing-codes/recorders")).status, 404);
    });

    it("refuses requests without a device token", async () => {
      assert.equal((await ctx.api("GET", "/device/config")).status, 401);
      assert.equal((await device("GET", "/device/config", "dcb_not-a-real-token")).status, 401);
      // A user's JWT is not a device credential
      assert.equal((await ctx.api("GET", "/device/config", { token: admin.token })).status, 401);
    });
  });

  describe("permissions", () => {
    it("lets read access look but not change", async () => {
      assert.equal((await call("GET", "/admin/venues", undefined, viewer)).status, 200);
      assert.equal((await call("GET", "/admin/courts", undefined, viewer)).status, 200);
      assert.equal((await call("GET", "/admin/clips", undefined, viewer)).status, 200);
      assert.equal((await call("POST", "/admin/venues", { name: "Nope" }, viewer)).status, 403);
    });

    it("refuses staff without the permission", async () => {
      const nobody = await ctx.createStaff("Nobody");
      assert.equal((await call("GET", "/admin/venues", undefined, nobody)).status, 403);
    });
  });
});
