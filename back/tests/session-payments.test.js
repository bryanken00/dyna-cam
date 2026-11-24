// CR-015 — a game's videos open only after it is paid at the front desk.
// Every new game gets a code and starts Unpaid: the courtside device shows the
// code (no download link), the player's page shows nothing to play. Staff
// record the payment from the game in Sessions (they type the amount); the
// device gets its link and the page opens. A refund locks it again. After the
// device unpairs, Find a game (/public/games/:payCode) gives the link once paid.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

describe("game payments", () => {
  let ctx;
  let admin;
  let viewer;
  let courtCount = 0;
  let venueId;

  const call = (method, url, body, who = admin) => ctx.api(method, url, { token: who.token, body });
  const asApp = (token) => (method, url, body) =>
    ctx.api(method, url, { body, headers: { Authorization: `App ${token}` } });

  /** A new open game on a fresh court; returns its create response data. */
  const newGame = async () => {
    courtCount += 1;
    const court = await call("POST", "/admin/courts", {
      venueId,
      name: `Court ${courtCount}`,
      cameraRtspUrl: "rtsp://u:p@10.0.0.9:554/stream1",
    });
    assert.equal(court.status, 201, JSON.stringify(court.body));
    const res = await call("POST", "/admin/sessions", { courtId: court.data.courtId });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    // CR-039: New game is always free; this test is about an unpaid game (one made before)
    res.data.payCode = await ctx.makeUnpaid(res.data.sessionId);
    return res.data;
  };

  const pairTo = async (sessionId) => {
    const key = await call("POST", `/admin/sessions/${sessionId}/pairing-codes`, {
      name: "Court tablet",
    });
    assert.equal(key.status, 201, JSON.stringify(key.body));
    const res = await ctx.api("POST", "/pair/app", {
      body: { code: key.data.code, platform: "android", appVersion: "1.0.0" },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return { app: asApp(res.data.token), session: res.data.session };
  };

  const page = async (shareUrl) =>
    (await ctx.api("GET", `/public/sessions/${shareUrl.split("/").pop()}`)).data.session;
  const pay = (sessionId, amount, who = admin) =>
    call("POST", "/admin/payments", { sessionId, amount }, who);

  before(async () => {
    ctx = await startTestApp({
      env: { RATE_LIMIT_PAIR_POINTS: "1000", RATE_LIMIT_PAIR_HOURLY_POINTS: "1000" },
    });
    admin = await ctx.createStaff("Admin", { access: "write" });
    viewer = await ctx.createStaff("Viewer", { access: "read" });
    venueId = (await call("POST", "/admin/venues", { name: "Pay Courts" })).data.venueId;
  });
  after(() => ctx?.stop());

  describe("a new game", () => {
    let game;
    let device;

    before(async () => {
      game = await newGame();
      device = await pairTo(game.sessionId);
    });

    it("starts Unpaid, with a code staff can search for", async () => {
      assert.match(game.payCode, /^[A-Z0-9]{6}$/);
      const one = await call("GET", `/admin/sessions/${game.sessionId}`);
      assert.equal(one.data.session.paymentStatus, "Unpaid");
      assert.equal(one.data.session.payCode, game.payCode);
      assert.equal(one.data.session.paidAmount, null);

      // "k7qm 2p" as staff might type it
      const spaced = `${game.payCode.slice(0, 3).toLowerCase()} ${game.payCode.slice(3)}`;
      const found = await call("GET", `/admin/sessions?search=${encodeURIComponent(spaced)}`);
      assert.deepEqual(
        found.data.sessions.map((s) => s.sessionId),
        [game.sessionId]
      );
      const unpaid = await call("GET", "/admin/sessions?payment=Unpaid");
      assert.ok(unpaid.data.sessions.some((s) => s.sessionId === game.sessionId));
    });

    it("the device shows the code, not the download link", async () => {
      assert.equal(device.session.shareUrl, null);
      const res = await device.app("GET", "/app/session");
      assert.equal(res.status, 200);
      assert.equal(res.data.session.shareUrl, null);
      assert.deepEqual(res.data.session.payment, { status: "Unpaid", payCode: game.payCode });
    });

    it("the player's page is locked: the code, nothing to play", async () => {
      const session = await page(game.shareUrl);
      assert.equal(session.locked, true);
      assert.equal(session.paymentStatus, "Unpaid");
      assert.equal(session.payCode, game.payCode);
      assert.equal(session.driveUrl, null);
    });

    it("Find a game says not paid yet, with no link", async () => {
      const res = await ctx.api("GET", `/public/games/${game.payCode.toLowerCase()}`);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.data.game.paid, false);
      assert.equal(res.data.game.shareUrl, null);
      assert.equal(res.data.game.courtName, `Court ${courtCount}`);
      assert.equal(res.data.game.venueName, "Pay Courts");
      assert.equal(res.data.game.sessionId, undefined, "no IDs on a public route");
    });

    it("needs the amount, and the payments permission to write", async () => {
      const noAmount = await call("POST", "/admin/payments", { sessionId: game.sessionId });
      assert.equal(noAmount.status, 400);
      const negative = await pay(game.sessionId, -5);
      assert.equal(negative.status, 400);
      const both = await call("POST", "/admin/payments", {
        sessionId: game.sessionId,
        clipId: "x",
        amount: 100,
      });
      assert.equal(both.status, 400);
      assert.equal((await pay(game.sessionId, 300, viewer)).status, 403);
      const one = await call("GET", `/admin/sessions/${game.sessionId}`);
      assert.equal(one.data.session.paymentStatus, "Unpaid", "nothing recorded");
    });

    it("recording the payment opens the device, the page and Find a game", async () => {
      const res = await pay(game.sessionId, "350.50");
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.data.amount, 350.5);
      assert.equal(res.data.sessionId, game.sessionId);

      const onDevice = await device.app("GET", "/app/session");
      assert.equal(onDevice.data.session.shareUrl, game.shareUrl);
      assert.deepEqual(onDevice.data.session.payment, { status: "Paid", payCode: null });

      const session = await page(game.shareUrl);
      assert.equal(session.locked, false);
      assert.equal(session.payCode, null);

      const found = await ctx.api("GET", `/public/games/${game.payCode}`);
      assert.equal(found.data.game.paid, true);
      assert.equal(found.data.game.shareUrl, game.shareUrl);

      const one = await call("GET", `/admin/sessions/${game.sessionId}`);
      assert.equal(one.data.session.paymentStatus, "Paid");
      assert.equal(one.data.session.paidAmount, 350.5);
    });

    it("Take payment on the Payments page finds the game by its code", async () => {
      const spaced = `${game.payCode.slice(0, 3).toLowerCase()} ${game.payCode.slice(3)}`;
      const res = await call("GET", `/admin/payments/lookup?payCode=${encodeURIComponent(spaced)}`);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.data.kind, "Game");
      assert.equal(res.data.clip, undefined);
      assert.equal(res.data.game.sessionId, game.sessionId);
      assert.equal(res.data.game.paymentStatus, "Paid");
      assert.equal(res.data.game.paidAmount, 350.5);
      assert.equal(res.data.game.venueName, "Pay Courts");
      const none = await call("GET", "/admin/payments/lookup?payCode=ZZZZZZ");
      assert.equal(none.status, 404);
      assert.match(none.body.message, /clip or game/);
    });

    it("a second payment is refused", async () => {
      const again = await pay(game.sessionId, 100);
      assert.equal(again.status, 409);
      assert.match(again.body.message, /already paid/);
    });

    it("is listed on the Payments page and counts in the totals", async () => {
      const list = await call("GET", "/admin/payments");
      assert.equal(list.status, 200, JSON.stringify(list.body));
      const row = list.data.payments.find((p) => p.sessionId === game.sessionId);
      assert.ok(row, "the game's payment is listed");
      assert.equal(row.kind, "Game");
      assert.equal(row.clipId, null);
      assert.equal(row.payCode, game.payCode);
      assert.equal(row.amount, 350.5);
      assert.equal(row.courtName, `Court ${courtCount}`);
      assert.ok(list.data.totals.today >= 350.5);
    });

    it("a refund locks the game again", async () => {
      const list = await call("GET", "/admin/payments");
      const row = list.data.payments.find((p) => p.sessionId === game.sessionId);
      const refund = await call("POST", `/admin/payments/${row.paymentId}/refund`, {});
      assert.equal(refund.status, 200, JSON.stringify(refund.body));
      assert.match(refund.body.message, /game/);

      assert.equal((await page(game.shareUrl)).locked, true);
      const onDevice = await device.app("GET", "/app/session");
      assert.equal(onDevice.data.session.shareUrl, null);
      assert.equal(onDevice.data.session.payment.payCode, game.payCode);
      // …and it can be paid again
      assert.equal((await pay(game.sessionId, 300)).status, 201);
    });
  });

  describe("games that can't be paid", () => {
    it("a cancelled game: 409, nothing recorded; Find a game doesn't know it", async () => {
      const game = await newGame();
      assert.equal((await call("POST", `/admin/sessions/${game.sessionId}/cancel`)).status, 200);
      const res = await pay(game.sessionId, 300);
      assert.equal(res.status, 409);
      assert.match(res.body.message, /cancelled/);
      const [[row]] = await ctx.sql.query(
        `SELECT paymentStatus FROM recording_sessions WHERE sessionId = ?`,
        [game.sessionId]
      );
      assert.equal(row.paymentStatus, "Unpaid");
      assert.equal((await ctx.api("GET", `/public/games/${game.payCode}`)).status, 404);
    });

    it("a game from before payments (Free) stays open and can't be paid", async () => {
      const game = await newGame();
      await ctx.sql.query(
        `UPDATE recording_sessions SET paymentStatus = 'Free', payCode = NULL WHERE sessionId = ?`,
        [game.sessionId]
      );
      const res = await pay(game.sessionId, 300);
      assert.equal(res.status, 409);
      assert.match(res.body.message, /free/);
      const session = await page(game.shareUrl);
      assert.equal(session.locked, false);
      assert.equal(session.payCode, null);
    });

    it("New game is always free (CR-039): no code, whatever is sent, now, scheduled or waiting", async () => {
      const { moment } = await ctx.importFromBack("server/src/utils/dateUtils.js");
      const startAt = moment().tz("Asia/Manila").add(2, "hours").startOf("hour").format("YYYY-MM-DD HH:mm:ss");
      for (const body of [{}, { free: false }, { startNow: true, durationMinutes: 30, free: false }, { startAt, durationMinutes: 30 }]) {
        courtCount += 1;
        const court = await call("POST", "/admin/courts", {
          venueId,
          name: `Court ${courtCount}`,
          cameraRtspUrl: "rtsp://u:p@10.0.0.9:554/stream1",
        });
        const res = await call("POST", "/admin/sessions", { courtId: court.data.courtId, ...body });
        assert.equal(res.status, 201, JSON.stringify(res.body));
        assert.equal(res.data.payCode, null, JSON.stringify(body));
        const one = await call("GET", `/admin/sessions/${res.data.sessionId}`);
        assert.equal(one.data.session.paymentStatus, "Free", JSON.stringify(body));
        assert.equal((await pay(res.data.sessionId, 300)).status, 409);
      }
    });

    it("a free game: no code, open on the device and the page at once", async () => {
      courtCount += 1;
      const court = await call("POST", "/admin/courts", {
        venueId,
        name: `Court ${courtCount}`,
        cameraRtspUrl: "rtsp://u:p@10.0.0.9:554/stream1",
      });
      const res = await call("POST", "/admin/sessions", { courtId: court.data.courtId });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.data.payCode, null);
      const device = await pairTo(res.data.sessionId);
      assert.equal(device.session.shareUrl, res.data.shareUrl);
      assert.deepEqual(device.session.payment, { status: "Free", payCode: null });
      assert.equal((await page(res.data.shareUrl)).locked, false);
      const one = await call("GET", `/admin/sessions/${res.data.sessionId}`);
      assert.equal(one.data.session.paymentStatus, "Free");
      assert.equal((await pay(res.data.sessionId, 300)).status, 409);
    });

    it("an unknown game is 404", async () => {
      assert.equal((await pay("no-such-game", 300)).status, 404);
    });
  });

  describe("Find a game", () => {
    it("an unknown code is 404; a malformed one 400", async () => {
      assert.equal((await ctx.api("GET", "/public/games/ZZZZZZ")).status, 404);
      assert.equal((await ctx.api("GET", "/public/games/no!")).status, 400);
    });
  });
});
