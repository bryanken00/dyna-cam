// CR-027 — players start their own game from the court's QR sign. The game
// records at once for the game time, is free (the court was paid at
// reservation) and allows 5 saves. One game per court; Issue new code retires
// the printed sign.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

describe("player starts a game from the court QR (CR-027)", () => {
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
  const startGame = (qrToken, body = { durationMinutes: 60 }) =>
    ctx.api("POST", `/public/courts/${qrToken}/games`, { body });

  before(async () => {
    ctx = await startTestApp({ env: { RATE_LIMIT_PUBLIC_START_POINTS: "1000" } });
    admin = await ctx.createStaff("Admin", { access: "write" });
    home.venueId = (await call("POST", "/admin/venues", { name: "Self-Start Courts" })).data
      .venueId;
    // The venue's recorder box is online, so the camera is ready
    const box = (await ctx.pairBox(admin.token, home.venueId, "Box")).data.token;
    const beat = await ctx.api("POST", "/device/heartbeat", {
      body: { cameras: [] },
      headers: { Authorization: `Device ${box}` },
    });
    assert.equal(beat.status, 200, JSON.stringify(beat.body));
  });
  after(() => ctx?.stop());

  it("the court's QR link is the Start a game page", async () => {
    const { courtId, qrToken } = await newCourt();
    const court = await call("GET", `/admin/courts/${courtId}`);
    assert.ok(court.data.court.qrUrl.endsWith(`/court/${qrToken}`));
    assert.equal(court.data.court.startUrl, undefined);
  });

  it("shows the player the court, free to start, with 5 saves", async () => {
    const { qrToken } = await newCourt();
    const res = await page(qrToken);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const { court } = res.data;
    assert.equal(court.venueName, "Self-Start Courts");
    assert.equal(court.cameraReady, true);
    assert.equal(court.busy, false);
    assert.equal(court.busyUntil, null);
    assert.equal(court.maxSaves, 5);
    assert.equal(court.clipSeconds, undefined, "no 60-second save");
    // No business IDs on a player's route
    assert.equal(court.courtId, undefined);
    assert.equal(court.venueId, undefined);
  });

  it("starts a free game that records now, with 5 saves, started by Player (QR)", async () => {
    const { qrToken } = await newCourt();
    const res = await startGame(qrToken, {
      durationMinutes: 45,
      playerName: "Ana",
      phone: "09123456789",
      email: "ana@example.com",
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(res.data.shareToken);
    assert.ok(res.data.shareUrl.endsWith(`/session/${res.data.shareToken}`));
    assert.equal(res.data.sessionId, undefined);

    const [[row]] = await ctx.sql.query(
      `SELECT sessionId, status, paymentStatus, payCode, maxCaptures, startedByPlayer, openEnded,
              createdByAccountId, playerName, phone, email,
              TIMESTAMPDIFF(MINUTE, startAt, endAt) AS minutes
       FROM recording_sessions WHERE shareToken = ?`,
      [res.data.shareToken]
    );
    assert.equal(row.status, "Recording");
    assert.equal(row.paymentStatus, "Free");
    assert.equal(row.payCode, null);
    assert.equal(Number(row.maxCaptures), 5);
    assert.equal(Number(row.startedByPlayer), 1);
    assert.equal(Number(row.openEnded), 0);
    assert.equal(row.createdByAccountId, null);
    assert.equal(Number(row.minutes), 45);
    assert.equal(row.playerName, "Ana");
    assert.equal(row.phone, "0912 3456 789");
    assert.equal(row.email, "ana@example.com");

    // The game's own page: unlocked, 5 saves
    const game = await ctx.api("GET", `/public/sessions/${res.data.shareToken}`);
    assert.equal(game.status, 200);
    assert.equal(game.data.session.locked, false);
    assert.equal(game.data.session.payCode, null);
    assert.equal(game.data.capture.maxPerGame, 5);

    // Admin sees who started it
    const one = await call("GET", `/admin/sessions/${row.sessionId}`);
    assert.equal(one.status, 200);
    assert.equal(one.data.session.startedBy, "Player (QR)");
    assert.equal(one.data.session.paymentStatus, "Free");
    assert.equal(one.data.session.maxCaptures, 5);
  });

  it("ignores payment and save-limit fields a player sends", async () => {
    const { qrToken } = await newCourt();
    const res = await startGame(qrToken, { durationMinutes: 30, maxCaptures: 20, free: false });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const [[row]] = await ctx.sql.query(
      `SELECT paymentStatus, maxCaptures FROM recording_sessions WHERE shareToken = ?`,
      [res.data.shareToken]
    );
    assert.equal(row.paymentStatus, "Free");
    assert.equal(Number(row.maxCaptures), 5);
  });

  it("needs a game time between 5 minutes and 3 hours", async () => {
    const { courtId, qrToken } = await newCourt();
    for (const body of [{}, { durationMinutes: 4 }, { durationMinutes: 181 }]) {
      const res = await startGame(qrToken, body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    const [[{ n }]] = await ctx.sql.query(
      `SELECT COUNT(*) AS n FROM recording_sessions WHERE courtId = ?`,
      [courtId]
    );
    assert.equal(Number(n), 0);
  });

  it("won't start a second game on a court that has one", async () => {
    const mine = await newCourt();
    assert.equal((await startGame(mine.qrToken)).status, 201);

    const busy = await page(mine.qrToken);
    assert.equal(busy.data.court.busy, true);
    assert.ok(busy.data.court.busyUntil);

    const again = await startGame(mine.qrToken);
    assert.equal(again.status, 409);
    assert.match(again.body.message, /already has a game/);

    // A staff game on the court blocks it too, and the other way round
    const other = await newCourt();
    const staff = await call("POST", "/admin/sessions", {
      courtId: other.courtId,
      startNow: true,
      durationMinutes: 30,
    });
    assert.equal(staff.status, 201);
    assert.equal((await startGame(other.qrToken)).status, 409);
    const staffAgain = await call("POST", "/admin/sessions", {
      courtId: mine.courtId,
      startNow: true,
      durationMinutes: 30,
    });
    assert.equal(staffAgain.status, 409);
  });

  it("the printed sign stops working after Issue new code", async () => {
    const { courtId, qrToken } = await newCourt();
    const rotated = await call("POST", `/admin/courts/${courtId}/rotate-qr`);
    assert.equal(rotated.status, 200);
    assert.equal((await page(qrToken)).status, 404);
    assert.equal((await startGame(qrToken)).status, 404);
    assert.equal((await page(rotated.data.qrToken)).status, 200);
  });

  it("a deleted court's QR stops working", async () => {
    const { courtId, qrToken } = await newCourt();
    assert.equal((await call("DELETE", `/admin/courts/${courtId}`)).status, 200);
    assert.equal((await page(qrToken)).status, 404);
    assert.equal((await startGame(qrToken)).status, 404);
    const [[{ n }]] = await ctx.sql.query(
      `SELECT COUNT(*) AS n FROM recording_sessions WHERE courtId = ?`,
      [courtId]
    );
    assert.equal(Number(n), 0);
  });

  it("won't start a game while the venue's camera is offline", async () => {
    const venueId = (await call("POST", "/admin/venues", { name: "No Box Courts" })).data.venueId;
    const { qrToken } = await newCourt(venueId);
    assert.equal((await page(qrToken)).data.court.cameraReady, false);
    const res = await startGame(qrToken);
    assert.equal(res.status, 503);
    assert.equal(res.body.code, "CAMERA_OFFLINE");
  });

  it("rejects a malformed code", async () => {
    assert.equal((await page("not a token")).status, 400);
  });
});
