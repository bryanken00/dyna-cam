// CR-027 — nothing saves a 60-second clip any more: the court QR starts a game
// (player-start-game.test.js), and court buttons are gone — a press the
// recorder box relays is refused (404, which the box drops), and courts no
// longer take a button code. Staff "save now" was removed in PLAN-002 Phase E
// (the Admin portal's clips are view only).

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";
import { insertLegacyClip } from "./helpers/legacyClip.js";

describe("no 60-second clip saves (CR-027)", () => {
  let ctx;
  let admin;
  const home = {};

  const call = (method, url, body, who = admin) => ctx.api(method, url, { token: who.token, body });

  const clipCount = async () => {
    const [[{ n }]] = await ctx.sql.query(`SELECT COUNT(*) AS n FROM clips`);
    return Number(n);
  };

  before(async () => {
    ctx = await startTestApp();
    admin = await ctx.createStaff("Admin", { access: "write" });
    home.venueId = (await call("POST", "/admin/venues", { name: "Button Courts" })).data.venueId;
    const court = await call("POST", "/admin/courts", {
      venueId: home.venueId,
      name: "Court 1",
      cameraRtspUrl: "rtsp://u:p@10.0.0.9:554/stream1",
      // An old client may still send it: ignored
      buttonCode: "home-court-1",
    });
    assert.equal(court.status, 201, JSON.stringify(court.body));
    home.courtId = court.data.courtId;
    home.qrToken = court.data.qrToken;
    home.boxToken = (await ctx.pairBox(admin.token, home.venueId, "Box")).data.token;
  });
  after(() => ctx?.stop());

  it("courts have no button code", async () => {
    const one = await call("GET", `/admin/courts/${home.courtId}`);
    assert.equal(one.status, 200);
    assert.equal(one.data.court.buttonCode, undefined);
    const [[cols]] = await ctx.sql.query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'courts'
         AND COLUMN_NAME IN ('buttonCode', 'startToken')`
    );
    assert.equal(Number(cols.n), 0);
  });

  it("refuses a button press relayed by the box, and saves nothing", async () => {
    const press = await ctx.api("POST", "/device/buttons/home-court-1/press", {
      body: { pressedAtMs: Date.now() },
      headers: { Authorization: `Device ${home.boxToken}` },
    });
    assert.equal(press.status, 404);
    assert.equal(await clipCount(), 0);
  });

  it("the court QR no longer saves the last 60 seconds", async () => {
    const save = await ctx.api("POST", `/public/courts/${home.qrToken}/clips`);
    assert.equal(save.status, 404);
    assert.equal(await clipCount(), 0);
  });

  describe("clips are view only in the Admin portal (PLAN-002 Phase E)", () => {
    it("has no staff save and no delete", async () => {
      assert.equal((await call("POST", "/admin/clips", { courtId: home.courtId })).status, 404);
      // A clip saved before CR-027
      const { clipId } = await insertLegacyClip(ctx.sql, { courtId: home.courtId });
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
