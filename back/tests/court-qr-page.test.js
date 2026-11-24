// The court's QR page. CR-034: it only checks a booking in by its code
// (booking-check-in.test.js); CR-027's walk-in "start a game" is gone, so a
// game never starts from the QR without a booking. Issue new code retires the
// printed sign.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

describe("the court QR page (CR-034)", () => {
  let ctx;
  let admin;
  const home = {};
  let courtNo = 0;

  const call = (method, url, body, who = admin) => ctx.api(method, url, { token: who.token, body });

  /** A court with a camera; returns { courtId, qrToken }. */
  const newCourt = async (venueId = home.venueId) => {
    courtNo += 1;
    const court = await call("POST", "/admin/courts", {
      venueId,
      name: `Court ${courtNo}`,
      cameraRtspUrl: `rtsp://u:p@10.0.3.${courtNo}:554/stream1`,
    });
    assert.equal(court.status, 201, JSON.stringify(court.body));
    return { courtId: court.data.courtId, qrToken: court.data.qrToken };
  };

  const page = (qrToken) => ctx.api("GET", `/public/courts/${qrToken}`);
  const gamesOn = async (courtId) => {
    const [[{ n }]] = await ctx.sql.query(
      `SELECT COUNT(*) AS n FROM recording_sessions WHERE courtId = ?`,
      [courtId]
    );
    return Number(n);
  };

  before(async () => {
    ctx = await startTestApp();
    admin = await ctx.createStaff("Admin", { access: "write" });
    home.venueId = (await call("POST", "/admin/venues", { name: "QR Courts" })).data.venueId;
    // The venue's recorder box is online, so the camera is ready
    const box = (await ctx.pairBox(admin.token, home.venueId, "Box")).data.token;
    const beat = await ctx.api("POST", "/device/heartbeat", {
      body: { cameras: [] },
      headers: { Authorization: `Device ${box}` },
    });
    assert.equal(beat.status, 200, JSON.stringify(beat.body));
  });
  after(() => ctx?.stop());

  it("the court's QR link is the court page", async () => {
    const { courtId, qrToken } = await newCourt();
    const court = await call("GET", `/admin/courts/${courtId}`);
    assert.ok(court.data.court.qrUrl.endsWith(`/court/${qrToken}`));
  });

  it("shows the player the court and a booked game's 5 saves, no walk-in fields", async () => {
    const { qrToken } = await newCourt();
    const res = await page(qrToken);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const { court } = res.data;
    assert.equal(court.venueName, "QR Courts");
    assert.equal(court.cameraReady, true);
    assert.equal(court.busy, false);
    assert.equal(court.booking, null);
    assert.equal(court.maxSaves, 5);
    assert.equal(court.freeUntil, undefined, "no walk-in game time to fit");
    // No business IDs on a player's route
    assert.equal(court.courtId, undefined);
    assert.equal(court.venueId, undefined);
  });

  it("starting a game without a booking is gone: 404, and nothing is recorded", async () => {
    const { courtId, qrToken } = await newCourt();
    const res = await ctx.api("POST", `/public/courts/${qrToken}/games`, {
      body: { durationMinutes: 60, playerName: "Walk In" },
    });
    assert.equal(res.status, 404);
    assert.equal(await gamesOn(courtId), 0);
  });

  it("says when a game is on the court (staff's New game still works)", async () => {
    const { courtId, qrToken } = await newCourt();
    const staff = await call("POST", "/admin/sessions", {
      courtId,
      startNow: true,
      durationMinutes: 30,
    });
    assert.equal(staff.status, 201, JSON.stringify(staff.body));
    const busy = await page(qrToken);
    assert.equal(busy.data.court.busy, true);
    assert.ok(busy.data.court.busyUntil);
  });

  it("the printed sign stops working after Issue new code", async () => {
    const { courtId, qrToken } = await newCourt();
    const rotated = await call("POST", `/admin/courts/${courtId}/rotate-qr`);
    assert.equal(rotated.status, 200);
    assert.equal((await page(qrToken)).status, 404);
    assert.equal((await page(rotated.data.qrToken)).status, 200);
  });

  it("a deleted court's QR stops working", async () => {
    const { courtId, qrToken } = await newCourt();
    assert.equal((await call("DELETE", `/admin/courts/${courtId}`)).status, 200);
    assert.equal((await page(qrToken)).status, 404);
  });

  it("says the camera is offline when the venue's box is", async () => {
    const venueId = (await call("POST", "/admin/venues", { name: "No Box Courts" })).data.venueId;
    const { qrToken } = await newCourt(venueId);
    assert.equal((await page(qrToken)).data.court.cameraReady, false);
  });

  it("rejects a malformed code", async () => {
    assert.equal((await page("not a token")).status, 400);
  });
});
