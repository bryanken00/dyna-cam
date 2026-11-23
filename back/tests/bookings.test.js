// PLAN-003 Phase B — desk bookings: create (paid now / hold / free), the one
// court timeline (bookings, games, closures, hours), payment, move, cancel
// with refund, no-show, soft delete, and the game side refusing booked time.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

const FORMAT = "YYYY-MM-DD HH:mm:ss";
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const ALL_DAY = EVERY_DAY.map((dayOfWeek) => ({ dayOfWeek, opensAt: "00:00", closesAt: "24:00" }));

describe("bookings at the desk (PLAN-003 Phase B)", () => {
  let ctx;
  let admin; // staff with write access to everything
  let desk; // bookings write, no payments permission
  let moment;
  const home = {};
  let courtNo = 0;

  const call = (method, url, body, who = admin) => ctx.api(method, url, { token: who.token, body });

  /** Manila "now" shifted, on the hour. */
  const at = (hoursFromNow) =>
    moment().tz("Asia/Manila").startOf("hour").add(hoursFromNow, "hours").format(FORMAT);
  const slot = (hoursFromNow) => {
    const s = at(hoursFromNow);
    return { date: s.slice(0, 10), startTime: s.slice(11, 16) };
  };

  const newCourt = async (venueId = home.venueId) => {
    courtNo += 1;
    const res = await call("POST", "/admin/courts", {
      venueId,
      name: `Court ${courtNo}`,
      cameraRtspUrl: `rtsp://u:p@10.0.3.${courtNo}:554/stream1`,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return { courtId: res.data.courtId, qrToken: res.data.qrToken };
  };

  const book = (courtId, hoursFromNow, body = {}, who = admin) =>
    call(
      "POST",
      "/admin/bookings",
      {
        courtId,
        ...slot(hoursFromNow),
        durationMinutes: 60,
        playerName: "Ana Reyes",
        phone: "09123456789",
        email: "ana@example.com",
        payment: "Cash",
        ...body,
      },
      who
    );

  const row = async (bookingId) =>
    (
      await ctx.sql.query(
        `SELECT status, paymentStatus, price, startAt, endAt, courtId, holdExpiresAt, cancelReason
         FROM bookings WHERE bookingId = ?`,
        [bookingId]
      )
    )[0][0];

  const payments = async (bookingId) =>
    (
      await ctx.sql.query(
        `SELECT amount, method, status FROM payments WHERE bookingId = ? ORDER BY paidAt`,
        [bookingId]
      )
    )[0];

  const setupVenue = async (name, settings = {}) => {
    const venueId = (await call("POST", "/admin/venues", { name })).data.venueId;
    const saved = await call("PUT", `/admin/booking-settings/${venueId}`, {
      maxBookingMinutes: 180,
      bookingDaysAhead: 14,
      deskHoldMinutes: 30,
      onlineHoldMinutes: 15,
      cancelCutoffHours: 24,
      checkInEarlyMinutes: 10,
      hours: ALL_DAY,
      rates: [{ name: "All day", daysOfWeek: EVERY_DAY, startTime: "00:00", endTime: "24:00", pricePerHour: 400 }],
      ...settings,
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    return venueId;
  };

  before(async () => {
    ctx = await startTestApp({ env: { RATE_LIMIT_PUBLIC_START_POINTS: "1000" } });
    admin = await ctx.createStaff("Admin", { access: "write" });
    ({ moment } = await ctx.importFromBack("server/src/utils/dateUtils.js"));

    // Desk staff: bookings write only
    desk = await ctx.createStaff("Desk");
    const owner = await ctx.owner();
    const perms = (await ctx.api("GET", "/admin/permissions", { token: owner.token })).data
      .permissions;
    const bookings = perms.find((p) => p.module === "bookings" && !p.submodule);
    const granted = await ctx.api("POST", `/admin/roles/${desk.roleId}/permissions`, {
      token: owner.token,
      body: { permissions: [{ permissionId: bookings.permissionId, accessLevel: "write" }] },
    });
    assert.equal(granted.status, 200, JSON.stringify(granted.body));

    home.venueId = await setupVenue("Desk Courts");
    // The venue's recorder box is online, so the court QR can start games
    const box = (await ctx.pairBox(admin.token, home.venueId, "Box")).data.token;
    const beat = await ctx.api("POST", "/device/heartbeat", {
      body: { cameras: [] },
      headers: { Authorization: `Device ${box}` },
    });
    assert.equal(beat.status, 200, JSON.stringify(beat.body));
  });
  after(() => ctx?.stop());

  describe("creating", () => {
    it("books paid now: confirmed, with the cash payment at the hourly price", async () => {
      const { courtId } = await newCourt();
      const res = await book(courtId, 30, { durationMinutes: 120 });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.data.status, "Confirmed");
      assert.equal(res.data.price, 800);
      assert.match(res.data.bookingCode, /^[A-Z0-9]{6}$/);

      const r = await row(res.data.bookingId);
      assert.equal(r.status, "Confirmed");
      assert.equal(r.paymentStatus, "Paid");
      assert.equal(r.startAt, at(30));
      assert.equal(r.endAt, at(32));
      const paid = await payments(res.data.bookingId);
      assert.equal(paid.length, 1);
      assert.equal(Number(paid[0].amount), 800);
      assert.equal(paid[0].method, "CASH");

      const one = await call("GET", `/admin/bookings/${res.data.bookingId}`);
      assert.equal(one.status, 200);
      assert.equal(one.data.booking.durationMinutes, 120);
      assert.equal(one.data.booking.phone, "0912 3456 789");
      assert.equal(one.data.booking.payments.length, 1);

      const list = await call("GET", `/admin/bookings?venueId=${home.venueId}&search=ana`);
      assert.ok(list.data.bookings.some((b) => b.bookingId === res.data.bookingId));
      assert.ok(list.data.stats.revenueToday >= 800);
    });

    it("holds a pay-at-desk booking until the deadline, then takes the payment", async () => {
      const { courtId } = await newCourt();
      const res = await book(courtId, 30, { payment: "Hold" });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.data.status, "Pending");
      let r = await row(res.data.bookingId);
      assert.equal(r.paymentStatus, "Unpaid");
      assert.equal(
        r.holdExpiresAt,
        moment.tz(at(30), FORMAT, "Asia/Manila").subtract(30, "minutes").format(FORMAT)
      );

      const paid = await call("POST", `/admin/bookings/${res.data.bookingId}/payments`, {});
      assert.equal(paid.status, 201, JSON.stringify(paid.body));
      assert.equal(paid.data.amount, 400);
      r = await row(res.data.bookingId);
      assert.equal(r.status, "Confirmed");
      assert.equal(r.paymentStatus, "Paid");
      assert.equal(r.holdExpiresAt, null);

      assert.equal((await call("POST", `/admin/bookings/${res.data.bookingId}/payments`, {})).status, 409);
    });

    it("books free (staff comp) with no payment", async () => {
      const { courtId } = await newCourt();
      const res = await book(courtId, 30, { payment: "Free" });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const r = await row(res.data.bookingId);
      assert.equal(r.status, "Confirmed");
      assert.equal(r.paymentStatus, "Free");
      assert.equal(Number(r.price), 400);
      assert.equal((await payments(res.data.bookingId)).length, 0);
    });

    it("won't hold a booking that starts before its pay-at-desk deadline", async () => {
      const { courtId } = await newCourt();
      const res = await book(courtId, 0, { payment: "Hold" });
      assert.equal(res.status, 400);
    });

    it("needs payments write to take cash, but not to hold or comp", async () => {
      const { courtId } = await newCourt();
      assert.equal((await book(courtId, 40, {}, desk)).status, 403);
      const held = await book(courtId, 40, { payment: "Hold" }, desk);
      assert.equal(held.status, 201, JSON.stringify(held.body));
      assert.equal(
        (await call("POST", `/admin/bookings/${held.data.bookingId}/payments`, {}, desk)).status,
        403
      );
    });

    it("refuses bad slots: off the hour, part hours, the past, no price", async () => {
      const { courtId } = await newCourt();
      assert.equal((await book(courtId, 30, { startTime: "10:30" })).status, 400);
      assert.equal((await book(courtId, 30, { durationMinutes: 90 })).status, 400);
      assert.equal((await book(courtId, -3)).status, 400);

      const venueId = await setupVenue("Unpriced Courts", { rates: [] });
      const unpriced = await newCourt(venueId);
      assert.equal((await book(unpriced.courtId, 30)).status, 400);
      // Free needs no price
      const free = await book(unpriced.courtId, 30, { payment: "Free" });
      assert.equal(free.status, 201, JSON.stringify(free.body));
      assert.equal(Number((await row(free.data.bookingId)).price), 0);
    });
  });

  describe("one court, one timeline", () => {
    it("refuses an overlapping booking but allows back-to-back ones", async () => {
      const { courtId } = await newCourt();
      assert.equal((await book(courtId, 50, { durationMinutes: 120 })).status, 201);
      assert.equal((await book(courtId, 51)).status, 409);
      assert.equal((await book(courtId, 49, { durationMinutes: 120 })).status, 409);
      assert.equal((await book(courtId, 52)).status, 201);
      assert.equal((await book(courtId, 49)).status, 201);
    });

    it("gives a slot to exactly one of two bookings made at once", async () => {
      const { courtId } = await newCourt();
      const results = await Promise.all([book(courtId, 60), book(courtId, 60)]);
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    });

    it("keeps bookings off a game, and games off a booking", async () => {
      const first = await newCourt();
      const game = await call("POST", "/admin/sessions", {
        courtId: first.courtId,
        startNow: true,
        durationMinutes: 60,
      });
      assert.equal(game.status, 201, JSON.stringify(game.body));
      assert.equal((await book(first.courtId, 0)).status, 409);

      const second = await newCourt();
      const booked = await book(second.courtId, 2);
      assert.equal(booked.status, 201);
      const tooLong = await call("POST", "/admin/sessions", {
        courtId: second.courtId,
        startNow: true,
        durationMinutes: 180,
      });
      assert.equal(tooLong.status, 409);
      assert.ok(tooLong.body.message.includes(booked.data.bookingCode), tooLong.body.message);
      // An open game would run into it too
      const open = await call("POST", "/admin/sessions", { courtId: second.courtId });
      assert.equal(open.status, 409);
      // A game that ends before it is fine
      const short = await call("POST", "/admin/sessions", {
        courtId: second.courtId,
        startNow: true,
        durationMinutes: 30,
      });
      assert.equal(short.status, 201, JSON.stringify(short.body));
    });

    it("won't Add time to a game that would run into a booking", async () => {
      const { courtId } = await newCourt();
      const game = await call("POST", "/admin/sessions", { courtId, startNow: true, durationMinutes: 60 });
      assert.equal(game.status, 201);
      const endAt = (await ctx.sql.query(`SELECT endAt FROM recording_sessions WHERE sessionId = ?`, [game.data.sessionId]))[0][0].endAt;
      // Book the hour after the game's end (rounded up to the hour)
      const endHour = moment.tz(endAt, FORMAT, "Asia/Manila");
      const next = endHour.minutes() === 0 && endHour.seconds() === 0 ? endHour : endHour.clone().startOf("hour").add(1, "hour");
      const hoursAhead = Math.round(next.diff(moment.tz(at(0), FORMAT, "Asia/Manila"), "hours", true));
      const booked = await book(courtId, hoursAhead);
      assert.equal(booked.status, 201, JSON.stringify(booked.body));

      const extend = await call("POST", `/admin/sessions/${game.data.sessionId}/extend`, { minutes: 120 });
      assert.equal(extend.status, 409);
      assert.ok(extend.body.message.includes(booked.data.bookingCode), extend.body.message);
    });

    it("keeps the court QR's Start a game out of booked time (CR-027)", async () => {
      const { courtId, qrToken } = await newCourt();
      assert.equal((await book(courtId, 0)).status, 201);
      const start = await ctx.api("POST", `/public/courts/${qrToken}/games`, {
        body: { durationMinutes: 30 },
      });
      assert.equal(start.status, 409);
      assert.match(start.body.message, /booked/);

      const later = await newCourt();
      assert.equal((await book(later.courtId, 2)).status, 201);
      const tooLong = await ctx.api("POST", `/public/courts/${later.qrToken}/games`, {
        body: { durationMinutes: 180 },
      });
      assert.equal(tooLong.status, 409);
      assert.match(tooLong.body.message, /booked from/);
    });

    it("refuses a closed court, and outside opening hours unless staff override", async () => {
      const { courtId } = await newCourt();
      const closure = await call("POST", "/admin/closures", {
        venueId: home.venueId,
        courtId,
        startAt: at(70),
        endAt: at(72),
      });
      assert.equal(closure.status, 201);
      assert.equal((await book(courtId, 71)).status, 409);

      const start = moment.tz(at(80), FORMAT, "Asia/Manila");
      const venueId = await setupVenue("Short Hours Courts", {
        hours: [{ dayOfWeek: start.day(), opensAt: "06:00", closesAt: "07:00" }],
      });
      const shortHours = await newCourt(venueId);
      const outside = start.clone().hours(20).minutes(0).seconds(0);
      const hoursAhead = Math.round(outside.diff(moment.tz(at(0), FORMAT, "Asia/Manila"), "hours", true));
      if (hoursAhead > 0) {
        assert.equal((await book(shortHours.courtId, hoursAhead)).status, 409);
        assert.equal((await book(shortHours.courtId, hoursAhead, { ignoreHours: true })).status, 201);
      }
    });
  });

  describe("changing", () => {
    it("moves a booking, keeping its length and price, and not into a taken slot", async () => {
      const a = await newCourt();
      const b = await newCourt();
      const res = await book(a.courtId, 90, { durationMinutes: 120 });
      const { bookingId } = res.data;
      assert.equal((await book(b.courtId, 100)).status, 201);

      const moved = await call("PUT", `/admin/bookings/${bookingId}/move`, {
        courtId: b.courtId,
        ...slot(95),
      });
      assert.equal(moved.status, 200, JSON.stringify(moved.body));
      let r = await row(bookingId);
      assert.equal(r.courtId, b.courtId);
      assert.equal(r.startAt, at(95));
      assert.equal(r.endAt, at(97));
      // Its old slot is free again
      assert.equal((await book(a.courtId, 90)).status, 201);

      const clash = await call("PUT", `/admin/bookings/${bookingId}/move`, {
        courtId: b.courtId,
        ...slot(99),
      });
      assert.equal(clash.status, 409);
      r = await row(bookingId);
      assert.equal(r.startAt, at(95));

      // Paid: the price stays
      const reprice = await call("PUT", `/admin/bookings/${bookingId}/move`, {
        courtId: b.courtId,
        ...slot(110),
        reprice: true,
      });
      assert.equal(reprice.status, 409);
    });

    it("moves a hold's deadline with it", async () => {
      const { courtId } = await newCourt();
      const res = await book(courtId, 90, { payment: "Hold" });
      const moved = await call("PUT", `/admin/bookings/${res.data.bookingId}/move`, {
        courtId,
        ...slot(92),
      });
      assert.equal(moved.status, 200, JSON.stringify(moved.body));
      assert.equal(
        (await row(res.data.bookingId)).holdExpiresAt,
        moment.tz(at(92), FORMAT, "Asia/Manila").subtract(30, "minutes").format(FORMAT)
      );
    });

    it("cancels with a refund, freeing the slot", async () => {
      const { courtId } = await newCourt();
      const res = await book(courtId, 120);
      const cancelled = await call("POST", `/admin/bookings/${res.data.bookingId}/cancel`, {
        reason: "Rained out",
      });
      assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
      assert.equal(cancelled.data.refunded, 400);

      const r = await row(res.data.bookingId);
      assert.equal(r.status, "Cancelled");
      assert.equal(r.paymentStatus, "Refunded");
      assert.equal(r.cancelReason, "Rained out");
      assert.equal((await payments(res.data.bookingId))[0].status, "Refunded");
      assert.equal((await book(courtId, 120)).status, 201);

      assert.equal(
        (await call("POST", `/admin/bookings/${res.data.bookingId}/cancel`, { reason: "Again" })).status,
        409
      );
    });

    it("cancels without a refund when staff say so", async () => {
      const { courtId } = await newCourt();
      const res = await book(courtId, 120);
      const cancelled = await call("POST", `/admin/bookings/${res.data.bookingId}/cancel`, {
        reason: "Late cancel",
        refund: false,
      });
      assert.equal(cancelled.data.refunded, 0);
      assert.equal((await row(res.data.bookingId)).paymentStatus, "Paid");
      assert.equal((await payments(res.data.bookingId))[0].status, "Paid");
    });

    it("refunds paid bookings a closure cancels", async () => {
      const { courtId } = await newCourt();
      const res = await book(courtId, 130);
      const closure = await call("POST", "/admin/closures", {
        venueId: home.venueId,
        courtId,
        startAt: at(129),
        endAt: at(132),
        reason: "Tournament",
        cancelConflicts: true,
      });
      assert.equal(closure.status, 201, JSON.stringify(closure.body));
      const r = await row(res.data.bookingId);
      assert.equal(r.status, "Cancelled");
      assert.equal(r.paymentStatus, "Refunded");
      assert.equal(r.cancelReason, "Court closed: Tournament");
    });

    it("lets a hold run out: expired, unpayable, and the slot is free", async () => {
      const { courtId } = await newCourt();
      const res = await book(courtId, 140, { payment: "Hold" });
      await ctx.sql.query(`UPDATE bookings SET holdExpiresAt = ? WHERE bookingId = ?`, [
        at(-1),
        res.data.bookingId,
      ]);
      const one = await call("GET", `/admin/bookings/${res.data.bookingId}`);
      assert.equal(one.data.booking.status, "Expired");
      assert.equal((await call("POST", `/admin/bookings/${res.data.bookingId}/payments`, {})).status, 409);
      assert.equal((await book(courtId, 140)).status, 201);
    });

    it("marks a no-show only once the booking has started", async () => {
      const { courtId } = await newCourt();
      const started = await book(courtId, 0);
      assert.equal(started.status, 201, JSON.stringify(started.body));
      assert.equal((await call("POST", `/admin/bookings/${started.data.bookingId}/no-show`)).status, 200);
      assert.equal((await row(started.data.bookingId)).status, "NoShow");

      const future = await book(courtId, 150);
      assert.equal((await call("POST", `/admin/bookings/${future.data.bookingId}/no-show`)).status, 409);
    });
  });

  describe("payments and deleting", () => {
    it("lists booking payments on Payments, and refunds them only by cancelling", async () => {
      const { courtId } = await newCourt();
      const res = await book(courtId, 160);
      const list = await call("GET", `/admin/payments?venueId=${home.venueId}`);
      assert.equal(list.status, 200, JSON.stringify(list.body));
      const payment = list.data.payments.find((p) => p.bookingId === res.data.bookingId);
      assert.ok(payment);
      assert.equal(payment.kind, "Booking");
      assert.equal(payment.payCode, res.data.bookingCode);

      const refund = await call("POST", `/admin/payments/${payment.paymentId}/refund`, {});
      assert.equal(refund.status, 409);
      assert.equal((await payments(res.data.bookingId))[0].status, "Paid");
    });

    it("refuses to delete a booking with payments", async () => {
      const { courtId } = await newCourt();
      const res = await book(courtId, 170);
      assert.equal((await call("DELETE", `/admin/bookings/${res.data.bookingId}`)).status, 409);
    });

    it("treats a deleted booking as missing and leaves it alone", async () => {
      const { courtId } = await newCourt();
      const res = await book(courtId, 180, { payment: "Hold" });
      const { bookingId } = res.data;
      assert.equal((await call("GET", `/admin/bookings/${bookingId}`)).status, 200);
      assert.equal((await call("DELETE", `/admin/bookings/${bookingId}`)).status, 200);

      assert.equal((await call("GET", `/admin/bookings/${bookingId}`)).status, 404);
      assert.equal(
        (await call("PUT", `/admin/bookings/${bookingId}/move`, { courtId, ...slot(185) })).status,
        404
      );
      assert.equal(
        (await call("POST", `/admin/bookings/${bookingId}/cancel`, { reason: "x" })).status,
        404
      );
      assert.equal((await call("POST", `/admin/bookings/${bookingId}/no-show`)).status, 404);
      assert.equal((await call("POST", `/admin/bookings/${bookingId}/payments`, {})).status, 404);
      assert.equal((await call("DELETE", `/admin/bookings/${bookingId}`)).status, 404);

      const r = await row(bookingId);
      assert.equal(r.status, "Deleted");
      assert.equal(r.startAt, at(180));
      assert.equal(r.paymentStatus, "Unpaid");
      assert.equal((await payments(bookingId)).length, 0);
      // Its slot is free
      assert.equal((await book(courtId, 180)).status, 201);
    });
  });

  describe("day view and quote", () => {
    it("shows a day's courts, bookings, games and closures", async () => {
      const { courtId } = await newCourt();
      const res = await book(courtId, 200);
      const date = at(200).slice(0, 10);
      const day = await call("GET", `/admin/bookings/day?venueId=${home.venueId}&date=${date}`);
      assert.equal(day.status, 200, JSON.stringify(day.body));
      assert.deepEqual(day.data.hours, { opensAt: "00:00", closesAt: "24:00" });
      assert.ok(day.data.courts.some((c) => c.courtId === courtId));
      assert.ok(day.data.bookings.some((b) => b.bookingId === res.data.bookingId));
    });

    it("prices a slot and says when it's taken", async () => {
      const { courtId } = await newCourt();
      const free = await call(
        "GET",
        `/admin/bookings/quote?courtId=${courtId}&date=${slot(210).date}&startTime=${slot(210).startTime}&durationMinutes=120`
      );
      assert.equal(free.status, 200, JSON.stringify(free.body));
      assert.equal(free.data.quote.price, 800);
      assert.equal(free.data.quote.conflict, null);

      const res = await book(courtId, 210);
      const taken = await call(
        "GET",
        `/admin/bookings/quote?courtId=${courtId}&date=${slot(210).date}&startTime=${slot(210).startTime}&durationMinutes=60`
      );
      assert.ok(taken.data.quote.conflict.includes(res.data.bookingCode), taken.data.quote.conflict);
      // Moving that booking: its own slot isn't "taken"
      const own = await call(
        "GET",
        `/admin/bookings/quote?courtId=${courtId}&date=${slot(210).date}&startTime=${slot(210).startTime}&durationMinutes=60&bookingId=${res.data.bookingId}`
      );
      assert.equal(own.data.quote.conflict, null);
    });

    it("needs the bookings permission", async () => {
      const nobody = await ctx.createStaff("No bookings");
      assert.equal((await ctx.api("GET", "/admin/bookings", { token: nobody.token })).status, 403);
      assert.equal((await ctx.api("GET", "/admin/bookings/options", { token: desk.token })).status, 200);
    });
  });
});
