// PLAN-001 Phase 2 — a court's physical button (relayed by the venue's
// recorder box) saves a clip by the same rules as a QR scan; button codes are
// unique and freed when a court goes away. Staff "save now" was removed in
// PLAN-002 Phase E (the Admin portal's Clips page is view only).

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

describe("court buttons", () => {
  let ctx;
  let admin;
  const home = {};
  const other = {};

  const call = (method, url, body, who = admin) => ctx.api(method, url, { token: who.token, body });
  const asDevice = (token) => (method, url, body) =>
    ctx.api(method, url, { body, headers: { Authorization: `Device ${token}` } });

  const setupVenue = async (target, name, buttonCode) => {
    target.venueId = (await call("POST", "/admin/venues", { name })).data.venueId;
    const court = await call("POST", "/admin/courts", {
      venueId: target.venueId,
      name: "Court 1",
      cameraRtspUrl: "rtsp://u:p@10.0.0.9:554/stream1",
      buttonCode,
    });
    assert.equal(court.status, 201, JSON.stringify(court.body));
    target.courtId = court.data.courtId;
    const box = await ctx.pairBox(admin.token, target.venueId, "Box");
    target.device = asDevice(box.data.token);
  };

  const clipsOf = async (courtId) => {
    const [rows] = await ctx.sql.query(
      `SELECT clipId, source, requestedAt, status FROM clips WHERE courtId = ? ORDER BY id`,
      [courtId]
    );
    return rows;
  };
  const ageClips = (courtId) =>
    ctx.sql.query(
      `UPDATE clips SET requestedAt = DATE_SUB(requestedAt, INTERVAL 1 MINUTE) WHERE courtId = ?`,
      [courtId]
    );

  before(async () => {
    ctx = await startTestApp();
    admin = await ctx.createStaff("Admin", { access: "write" });
    await setupVenue(home, "Button Courts", "home-court-1");
    await setupVenue(other, "Other Courts", "other-court-1");
  });
  after(() => ctx?.stop());

  describe("button codes", () => {
    it("shows the button code on the court and refuses a duplicate anywhere", async () => {
      const one = await call("GET", `/admin/courts/${home.courtId}`);
      assert.equal(one.data.court.buttonCode, "home-court-1");

      const clash = await call("POST", "/admin/courts", {
        venueId: other.venueId,
        name: "Court 2",
        buttonCode: "home-court-1",
      });
      assert.equal(clash.status, 409);

      const bad = await call("POST", "/admin/courts", {
        venueId: other.venueId,
        name: "Court 3",
        buttonCode: "has spaces",
      });
      assert.equal(bad.status, 400);
    });

    it("frees a deleted court's code for a new court", async () => {
      const temp = await call("POST", "/admin/courts", {
        venueId: other.venueId,
        name: "Temporary",
        buttonCode: "reuse-me",
      });
      assert.equal(temp.status, 201);
      assert.equal((await call("DELETE", `/admin/courts/${temp.data.courtId}`)).status, 200);

      const again = await call("POST", "/admin/courts", {
        venueId: other.venueId,
        name: "Replacement",
        buttonCode: "reuse-me",
      });
      assert.equal(again.status, 201);
    });
  });

  describe("button presses (relayed by the recorder box)", () => {
    it("saves a BUTTON clip at the press time, and merges a second press", async () => {
      const pressedAtMs = Date.now() - 4000;
      const first = await home.device("POST", "/device/buttons/home-court-1/press", {
        pressedAtMs,
      });
      assert.equal(first.status, 201, JSON.stringify(first.body));
      assert.equal(first.data.merged, false);
      assert.match(first.data.shareUrl, /\/clip\//);

      const second = await home.device("POST", "/device/buttons/home-court-1/press", {});
      assert.equal(second.status, 200);
      assert.equal(second.data.merged, true);
      assert.equal(second.data.clipId, first.data.clipId);

      const rows = await clipsOf(home.courtId);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].source, "BUTTON");

      // The box gets it as a job like any other clip
      const jobs = await home.device("GET", "/device/jobs?wait=0");
      const job = jobs.data.jobs.find((j) => j.clipId === first.data.clipId);
      assert.ok(job);
      assert.ok(Math.abs(job.requestedAtMs - pressedAtMs) <= 1000, "clip is anchored to the press");
    });

    it("won't let a box press another venue's button", async () => {
      const res = await other.device("POST", "/device/buttons/home-court-1/press", {});
      assert.equal(res.status, 404);
    });

    it("refuses an unknown button and a press too old to still be in the buffer", async () => {
      assert.equal((await home.device("POST", "/device/buttons/nope-123/press", {})).status, 404);
      const old = await home.device("POST", "/device/buttons/home-court-1/press", {
        pressedAtMs: Date.now() - 10 * 60 * 1000,
      });
      assert.equal(old.status, 422);
    });

    it("needs a device token", async () => {
      assert.equal((await ctx.api("POST", "/device/buttons/home-court-1/press")).status, 401);
    });
  });

  describe("clips are view only in the Admin portal (PLAN-002 Phase E)", () => {
    it("has no staff save and no delete", async () => {
      await ageClips(home.courtId);
      assert.equal((await call("POST", "/admin/clips", { courtId: home.courtId })).status, 404);
      const rows = await clipsOf(home.courtId);
      assert.ok(rows.length > 0, "the court has clips from the button presses");
      const clipId = rows.at(-1).clipId;
      assert.equal((await call("DELETE", `/admin/clips/${clipId}`)).status, 404);
      const [[row]] = await ctx.sql.query(`SELECT status FROM clips WHERE clipId = ?`, [clipId]);
      assert.notEqual(row.status, "Deleted");
    });

    it("marks which courts are active in the filter options", async () => {
      const temp = await call("POST", "/admin/courts", { venueId: home.venueId, name: "Resting" });
      await call("PUT", `/admin/courts/${temp.data.courtId}`, {
        name: "Resting",
        status: "Inactive",
      });
      const options = await call("GET", "/admin/clips/options");
      const byId = new Map(options.data.courts.map((c) => [c.courtId, c.active]));
      assert.equal(byId.get(home.courtId), true);
      assert.equal(byId.get(temp.data.courtId), false);
    });
  });
});
