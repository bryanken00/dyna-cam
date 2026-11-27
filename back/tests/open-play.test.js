// PLAN-009 phase C — Open Play: staff set up drop-in sessions on some courts (one-off or a
// weekly series); a session's courts are taken on the court timeline (booking refuses that
// time, and the session refuses booked time); players join — free at once, paid through the
// payment sandbox like bookings — up to its cap; staff add walk-ins and check players in;
// cancelling refunds paid spots. Every Admin route is company-scoped.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

const FORMAT = "YYYY-MM-DD HH:mm:ss";
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const ALL_DAY = EVERY_DAY.map((dayOfWeek) => ({ dayOfWeek, opensAt: "00:00", closesAt: "24:00" }));
const SETTINGS = {
  maxBookingMinutes: 180,
  bookingDaysAhead: 14,
  deskHoldMinutes: 30,
  onlineHoldMinutes: 15,
  cancelCutoffHours: 24,
  checkInEarlyMinutes: 10,
  hours: ALL_DAY,
  rates: [{ name: "All day", daysOfWeek: EVERY_DAY, startTime: "00:00", endTime: "24:00", pricePerHour: 300 }],
};

describe("Open Play (PLAN-009 phase C)", () => {
  let ctx;
  let admin;
  let viewer;
  let moment;
  let settleInvoice;
  let expirePlayHolds;
  let runPlaySeries;
  let playerNo = 0;
  const home = {};

  const call = (method, url, body, who = admin) =>
    ctx.api(method, url, { token: who.token, body: body ?? undefined });
  const as = (player, method, url, body) => ctx.api(method, url, { player: player.token, body });
  const day = (n) => moment().tz("Asia/Manila").add(n, "days").format("YYYY-MM-DD");
  const newPlayer = () => {
    playerNo += 1;
    return ctx.signInPlayer({ email: `play${playerNo}@example.test`, name: `Play Person${playerNo}` });
  };

  /** A session body: courts by name, on `date` from `startTime` to `endTime`. */
  const body = (over = {}) => ({
    venueId: home.venueId,
    title: "Evening Open Play",
    date: day(3),
    startTime: "18:00",
    endTime: "21:00",
    courtIds: [home.courts["Court A"], home.courts["Court B"]],
    capacity: 12,
    pricePerHead: 0,
    ...over,
  });

  const create = async (over = {}, who = admin) => {
    const res = await call("POST", "/admin/open-play/sessions", body(over), who);
    return res;
  };
  const tokenOf = (shareUrl) => shareUrl.split("/open-play/")[1];

  /** Pay a spot's checkout in the sandbox and settle it, as Xendit's webhook would. */
  const payCheckout = async (checkoutUrl) => {
    const checkoutId = checkoutUrl.split("/").pop();
    const paid = await ctx.api("POST", `/public/payment-sandbox/${checkoutId}/pay`);
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    return settleInvoice(ctx.db, checkoutId);
  };

  const spot = async (signupCode) =>
    (await ctx.sql.query(`SELECT * FROM play_signups WHERE signupCode = ?`, [signupCode]))[0][0];

  before(async () => {
    ctx = await startTestApp();
    admin = await ctx.createStaff("Admin", { access: "write" });
    viewer = await ctx.createStaff("Viewer", { access: "read" });
    ({ moment } = await ctx.importFromBack("server/src/utils/dateUtils.js"));
    ({ settleInvoice } = await ctx.importFromBack("server/src/utils/bookingPayments.js"));
    ({ expirePlayHolds } = await ctx.importFromBack("server/src/utils/openPlay.js"));
    ({ runPlaySeries } = await ctx.importFromBack("server/src/utils/playSeries.js"));

    home.venueId = (await call("POST", "/admin/venues", { name: "Open Play Courts" })).data.venueId;
    home.courts = {};
    for (const name of ["Court A", "Court B", "Court C"]) {
      const c = await call("POST", "/admin/courts", { venueId: home.venueId, name });
      assert.equal(c.status, 201, JSON.stringify(c.body));
      home.courts[name] = c.data.courtId;
    }
    assert.equal((await call("PUT", `/admin/booking-settings/${home.venueId}`, SETTINGS)).status, 200);
    const link = await call("POST", `/admin/booking-settings/${home.venueId}/link`);
    home.bookingToken = link.data.bookingUrl.split("/book/")[1];
    const page = await ctx.api("GET", `/public/book/${home.bookingToken}`);
    home.courtKeys = Object.fromEntries(page.data.courts.map((c) => [c.name, c.key]));
  });
  after(async () => {
    await ctx?.stop();
  });

  describe("sessions and the court timeline", () => {
    it("adds a session on two courts; the player app gets its link", async () => {
      const res = await create();
      assert.equal(res.status, 201, JSON.stringify(res.body));
      home.free = { playSessionId: res.data.playSessionId, token: tokenOf(res.data.shareUrl) };
      const got = await call("GET", `/admin/open-play/sessions/${home.free.playSessionId}`);
      assert.equal(got.status, 200);
      assert.equal(got.data.session.state, "Scheduled");
      assert.deepEqual(got.data.session.courts.map((c) => c.name), ["Court A", "Court B"]);
      assert.equal(got.data.session.spotsTaken, 0);
    });

    it("takes its courts off the booking grid, and a booking there is refused", async () => {
      const avail = await ctx.api(
        "GET",
        `/public/book/${home.bookingToken}/availability?date=${day(3)}&durationMinutes=60`
      );
      const at = (court, time) =>
        avail.data.courts.find((c) => c.name === court).slots.find((s) => s.startTime === time)?.available;
      assert.equal(at("Court A", "19:00"), false);
      assert.equal(at("Court B", "18:00"), false);
      assert.equal(at("Court C", "19:00"), true);

      const player = await newPlayer();
      const refused = await ctx.api("POST", `/public/book/${home.bookingToken}/bookings`, {
        player: player.token,
        body: { date: day(3), slots: [{ courtKey: home.courtKeys["Court A"], startTime: "19:00" }] },
      });
      assert.equal(refused.status, 409, JSON.stringify(refused.body));
    });

    it("refuses a session over booked time or another session, naming the court", async () => {
      const player = await newPlayer();
      const booked = await ctx.api("POST", `/public/book/${home.bookingToken}/bookings`, {
        player: player.token,
        body: { date: day(3), slots: [{ courtKey: home.courtKeys["Court C"], startTime: "08:00" }] },
      });
      assert.equal(booked.status, 201, JSON.stringify(booked.body));
      const overBooking = await create({ courtIds: [home.courts["Court C"]], startTime: "07:00", endTime: "09:00" });
      assert.equal(overBooking.status, 409);
      assert.match(overBooking.body.message, /^Court C: /);

      const overSession = await create({ courtIds: [home.courts["Court B"]], startTime: "20:00", endTime: "22:00" });
      assert.equal(overSession.status, 409);
      assert.match(overSession.body.message, /^Court B: Open Play has the court then/);
    });

    it("keeps its court blocks out of Closures — they can't be listed or removed there", async () => {
      const list = await call("GET", `/admin/closures?venueId=${home.venueId}&when=upcoming`);
      assert.equal(list.status, 200, JSON.stringify(list.body));
      assert.equal(list.data.closures.length, 0);
      const [blocks] = await ctx.sql.query(
        `SELECT closureId FROM court_closures WHERE playSessionId = ? AND status = 'Active'`,
        [home.free.playSessionId]
      );
      assert.equal(blocks.length, 2);
      assert.equal((await call("DELETE", `/admin/closures/${blocks[0].closureId}`)).status, 404);
      assert.equal((await call("GET", `/admin/closures/${blocks[0].closureId}`)).status, 404);
    });

    it("moves a session's block when its courts change, and keeps the cap above the spots taken", async () => {
      const made = await create({ date: day(4), courtIds: [home.courts["Court A"]], capacity: 4 });
      const id = made.data.playSessionId;
      const token = tokenOf(made.data.shareUrl);
      for (let i = 0; i < 3; i += 1) {
        assert.equal((await as(await newPlayer(), "POST", `/player/play/sessions/${token}/join`)).status, 201);
      }

      const { venueId, ...rest } = body({ date: day(4), courtIds: [home.courts["Court C"]], capacity: 2 });
      assert.ok(venueId);
      const tooSmall = await call("PUT", `/admin/open-play/sessions/${id}`, rest);
      assert.equal(tooSmall.status, 409, JSON.stringify(tooSmall.body));
      assert.match(tooSmall.body.message, /3 players have joined/);

      const moved = await call("PUT", `/admin/open-play/sessions/${id}`, { ...rest, capacity: 4 });
      assert.equal(moved.status, 200, JSON.stringify(moved.body));
      const [blocks] = await ctx.sql.query(
        `SELECT courtId FROM court_closures WHERE playSessionId = ? AND status = 'Active'`,
        [id]
      );
      assert.deepEqual(blocks.map((b) => b.courtId), [home.courts["Court C"]]);
    });

    it("lets read access look but not change", async () => {
      assert.equal((await call("GET", "/admin/open-play/sessions", null, viewer)).status, 200);
      assert.equal((await create({}, viewer)).status, 403);
    });
  });

  describe("players", () => {
    it("lists upcoming sessions publicly, with spots left and no business IDs", async () => {
      const res = await ctx.api("GET", `/public/open-play?from=${day(0)}&days=7`);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const s = res.data.sessions.find((x) => x.key === home.free.token);
      assert.ok(s);
      assert.equal(s.spotsLeft, 12);
      assert.equal(s.courts, "Court A, Court B");
      const text = JSON.stringify(res.body);
      assert.ok(!text.includes(home.venueId) && !text.includes(home.free.playSessionId));
    });

    it("joins a free session at once, once, and shows only first names and levels", async () => {
      const ana = await newPlayer();
      await as(ana, "PUT", "/player/sports", { sport: "Pickleball", skillLevel: "Intermediate" });
      const joined = await as(ana, "POST", `/player/play/sessions/${home.free.token}/join`);
      assert.equal(joined.status, 201, JSON.stringify(joined.body));
      assert.equal(joined.data.status, "Confirmed");
      assert.equal(joined.data.checkoutUrl, null);
      assert.equal((await as(ana, "POST", `/player/play/sessions/${home.free.token}/join`)).status, 409);

      const page = await ctx.api("GET", `/public/open-play/${home.free.token}`);
      assert.deepEqual(page.data.session.players, [{ firstName: "Play", level: "Intermediate" }]);
      assert.equal(page.data.session.spotsLeft, 11);
      const mine = await as(ana, "GET", "/player/play/signups?when=upcoming");
      assert.equal(mine.data.spots.length, 1);
      assert.equal(mine.data.spots[0].session.key, home.free.token);
    });

    it("refuses a player who hasn't finished their profile, and a signed-out caller", async () => {
      const half = await ctx.signInPlayer({ email: "half.play@example.test", completeProfile: false });
      const res = await as(half, "POST", `/player/play/sessions/${home.free.token}/join`);
      assert.equal(res.status, 409);
      assert.equal(res.body.code, "PROFILE_INCOMPLETE");
      assert.equal((await ctx.api("POST", `/player/play/sessions/${home.free.token}/join`)).status, 401);
    });

    it("stops at the cap", async () => {
      const made = await create({ date: day(5), capacity: 2 });
      const token = tokenOf(made.data.shareUrl);
      for (let i = 0; i < 2; i += 1) {
        assert.equal((await as(await newPlayer(), "POST", `/player/play/sessions/${token}/join`)).status, 201);
      }
      const full = await as(await newPlayer(), "POST", `/player/play/sessions/${token}/join`);
      assert.equal(full.status, 409);
      assert.match(full.body.message, /full/);
    });
  });

  describe("paid sessions", () => {
    before(async () => {
      const made = await create({ date: day(6), title: "Paid Open Play", pricePerHead: 150, capacity: 2 });
      assert.equal(made.status, 201, JSON.stringify(made.body));
      home.paid = { playSessionId: made.data.playSessionId, token: tokenOf(made.data.shareUrl) };
    });

    it("holds a spot for its checkout, then confirms it once paid — with a payment row", async () => {
      const ben = await newPlayer();
      const joined = await as(ben, "POST", `/player/play/sessions/${home.paid.token}/join`);
      assert.equal(joined.status, 201, JSON.stringify(joined.body));
      assert.equal(joined.data.status, "Pending");
      assert.ok(joined.data.checkoutUrl);
      // Joining again while held hands back the same checkout
      const again = await as(ben, "POST", `/player/play/sessions/${home.paid.token}/join`);
      assert.equal(again.status, 200, JSON.stringify(again.body));

      const settled = await payCheckout(joined.data.checkoutUrl);
      assert.equal(settled.outcome, "CONFIRMED");
      const row = await spot(joined.data.signupCode);
      assert.equal(row.status, "Confirmed");
      assert.equal(row.paymentStatus, "Paid");
      const [pays] = await ctx.sql.query(`SELECT amount, status FROM payments WHERE playSignupId = ?`, [
        row.playSignupId,
      ]);
      assert.deepEqual(pays.map((p) => [Number(p.amount), p.status]), [[150, "Paid"]]);

      const list = await call("GET", "/admin/payments");
      const mine = list.data.payments.find((p) => p.payCode === joined.data.signupCode);
      assert.equal(mine.kind, "Open Play");
      assert.equal(mine.courtName, "Open Play: Paid Open Play");
      home.paid.ben = { ...ben, signupCode: joined.data.signupCode };
    });

    it("frees a hold that ran out, and refunds a late payment once the session is full", async () => {
      const cy = await newPlayer();
      const joined = await as(cy, "POST", `/player/play/sessions/${home.paid.token}/join`);
      assert.equal(joined.status, 201);
      const later = moment().tz("Asia/Manila").add(1, "hour").format(FORMAT);
      assert.ok((await expirePlayHolds(ctx.db, { now: later })) >= 1);
      assert.equal((await spot(joined.data.signupCode)).status, "Expired");

      // Someone takes the freed spot; the late payment then has no spot to keep
      const dee = await newPlayer();
      const taken = await as(dee, "POST", `/player/play/sessions/${home.paid.token}/join`);
      assert.equal(taken.status, 201);
      assert.equal((await payCheckout(taken.data.checkoutUrl)).outcome, "CONFIRMED");
      const late = await payCheckout(joined.data.checkoutUrl);
      assert.equal(late.outcome, "REFUNDED");
      assert.equal(late.why, "SESSION_FULL");
    });

    it("lets a player cancel a paid spot before the cut-off, refunded", async () => {
      const res = await as(home.paid.ben, "POST", `/player/play/signups/${home.paid.ben.signupCode}/cancel`);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.data.refunded, 150);
      const row = await spot(home.paid.ben.signupCode);
      assert.equal(row.status, "Cancelled");
      assert.equal(row.paymentStatus, "Refunded");
    });

    it("refuses a refund after the venue's cut-off", async () => {
      const start = moment().tz("Asia/Manila").add(3, "hours").startOf("hour");
      const made = await create({
        date: start.format("YYYY-MM-DD"),
        startTime: start.format("HH:mm"),
        endTime: start.clone().add(1, "hour").format("HH:mm") === "00:00" ? "24:00" : start.clone().add(1, "hour").format("HH:mm"),
        courtIds: [home.courts["Court C"]],
        pricePerHead: 100,
      });
      assert.equal(made.status, 201, JSON.stringify(made.body));
      const eve = await newPlayer();
      const joined = await as(eve, "POST", `/player/play/sessions/${tokenOf(made.data.shareUrl)}/join`);
      await payCheckout(joined.data.checkoutUrl);
      const res = await as(eve, "POST", `/player/play/signups/${joined.data.signupCode}/cancel`);
      assert.equal(res.status, 409);
      assert.match(res.body.message, /too late/);
    });
  });

  describe("staff", () => {
    it("adds a walk-in (free) and checks players in", async () => {
      const id = home.free.playSessionId;
      const walk = await call("POST", `/admin/open-play/sessions/${id}/walk-ins`, { name: "Walk In Wally" });
      assert.equal(walk.status, 201, JSON.stringify(walk.body));
      const detail = await call("GET", `/admin/open-play/sessions/${id}`);
      const wally = detail.data.signups.find((s) => s.name === "Walk In Wally");
      assert.equal(wally.walkIn, true);
      assert.equal(wally.paymentStatus, "Free");
      // Not running yet — check-in waits for the session
      assert.equal((await call("POST", `/admin/open-play/signups/${wally.playSignupId}/check-in`)).status, 200);
      assert.equal((await spot(wally.signupCode)).status, "CheckedIn");
    });

    it("cancels a paid spot only with Cancel and refund", async () => {
      const made = await create({ date: day(7), pricePerHead: 80 });
      const fay = await newPlayer();
      const joined = await as(fay, "POST", `/player/play/sessions/${tokenOf(made.data.shareUrl)}/join`);
      await payCheckout(joined.data.checkoutUrl);
      const row = await spot(joined.data.signupCode);
      const plain = await call("POST", `/admin/open-play/signups/${row.playSignupId}/cancel`);
      assert.equal(plain.status, 409);
      const refunded = await call("POST", `/admin/open-play/signups/${row.playSignupId}/cancel-refund`);
      assert.equal(refunded.status, 200, JSON.stringify(refunded.body));
      assert.equal((await spot(joined.data.signupCode)).paymentStatus, "Refunded");
    });

    it("cancels a session: every spot cancelled, paid ones refunded, its courts free again", async () => {
      const made = await create({ date: day(8), pricePerHead: 120, courtIds: [home.courts["Court A"]] });
      const id = made.data.playSessionId;
      const gil = await newPlayer();
      const joined = await as(gil, "POST", `/player/play/sessions/${tokenOf(made.data.shareUrl)}/join`);
      await payCheckout(joined.data.checkoutUrl);

      const res = await call("POST", `/admin/open-play/sessions/${id}/cancel`, { reason: "Rain" });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.data.cancelledSpots, 1);
      const row = await spot(joined.data.signupCode);
      assert.equal(row.status, "Cancelled");
      assert.equal(row.paymentStatus, "Refunded");

      const booked = await ctx.api("POST", `/public/book/${home.bookingToken}/bookings`, {
        player: gil.token,
        body: { date: day(8), slots: [{ courtKey: home.courtKeys["Court A"], startTime: "19:00" }] },
      });
      assert.equal(booked.status, 201, JSON.stringify(booked.body));
      assert.equal((await call("POST", `/admin/open-play/sessions/${id}/cancel`, {})).status, 409);
    });
  });

  describe("weekly series", () => {
    it("makes a series' sessions ahead, once, and stops on request", async () => {
      const first = day(2);
      const weekday = moment.tz(first, "YYYY-MM-DD", "Asia/Manila").day();
      const res = await create({
        title: "Morning Drop-in",
        date: first,
        startTime: "06:00",
        endTime: "08:00",
        courtIds: [home.courts["Court B"]],
        repeat: { daysOfWeek: [weekday], endsOn: day(16) },
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.data.made, 3); // day 2, 9, 16
      const { seriesId } = res.data;
      assert.equal((await runPlaySeries(ctx.db, { seriesId })).made, 0);

      const series = await call("GET", `/admin/open-play/series?venueId=${home.venueId}`);
      const mine = series.data.series.find((s) => s.seriesId === seriesId);
      assert.deepEqual(mine.daysOfWeek, [weekday]);
      assert.equal(mine.upcomingSessions, 3);

      assert.equal((await call("POST", `/admin/open-play/series/${seriesId}/stop`)).status, 200);
      assert.equal((await call("POST", `/admin/open-play/series/${seriesId}/stop`)).status, 404);
    });
  });

  describe("company scope", () => {
    it("is a 404 for another company's staff", async () => {
      const other = await ctx.createCompany("Rival Courts Co");
      const owner = other.owner;
      const id = home.free.playSessionId;
      assert.equal((await call("GET", `/admin/open-play/sessions/${id}`, null, owner)).status, 404);
      assert.equal((await call("POST", `/admin/open-play/sessions/${id}/cancel`, {}, owner)).status, 404);
      assert.equal((await call("POST", `/admin/open-play/sessions/${id}/walk-ins`, { name: "X" }, owner)).status, 404);
      const list = await call("GET", "/admin/open-play/sessions", null, owner);
      assert.equal(list.data.sessions.length, 0);
      const detail = await call("GET", `/admin/open-play/sessions/${id}`);
      const anyone = detail.data.signups[0];
      assert.equal((await call("POST", `/admin/open-play/signups/${anyone.playSignupId}/check-in`, null, owner)).status, 404);
      assert.equal((await create({}, owner)).status, 400); // not their venue
    });

    it("is a 404 for a Deleted session", async () => {
      const made = await create({ date: day(9) });
      const id = made.data.playSessionId;
      await ctx.sql.query(`UPDATE play_sessions SET status = 'Deleted' WHERE playSessionId = ?`, [id]);
      assert.equal((await call("GET", `/admin/open-play/sessions/${id}`)).status, 404);
      assert.equal((await call("POST", `/admin/open-play/sessions/${id}/cancel`, {})).status, 404);
      assert.equal((await ctx.api("GET", `/public/open-play/${tokenOf(made.data.shareUrl)}`)).status, 404);
      const [[row]] = await ctx.sql.query(`SELECT status FROM play_sessions WHERE playSessionId = ?`, [id]);
      assert.equal(row.status, "Deleted");
    });
  });
});
