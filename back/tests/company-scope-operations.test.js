// PLAN-008 — company scope for the operations Admin modules: Bookings, Sessions
// (games) and Payments. Company B's staff can't list, read, change or use company
// A's bookings, games, payments, venues or courts (404 or absent), and A's rows stay
// as they were; A doesn't see B's either.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const ALL_DAY = EVERY_DAY.map((dayOfWeek) => ({ dayOfWeek, opensAt: "00:00", closesAt: "24:00" }));

describe("company scope — bookings, games, payments (PLAN-008)", () => {
  let ctx;
  let moment;
  let staffA;
  let staffB;
  const a = {};
  const b = {};

  const as = (who) => (method, url, body) => ctx.api(method, url, { token: who.token, body });
  const day = (daysAhead) => moment().tz("Asia/Manila").add(daysAhead, "days").format("YYYY-MM-DD");

  /** A venue with two courts (each with a camera), open all day at ₱300 an hour. */
  const setUpVenue = async (call, name, ip) => {
    const venueId = (await call("POST", "/admin/venues", { name })).data.venueId;
    const courtIds = [];
    for (const [i, court] of ["Court 1", "Court 2"].entries()) {
      const res = await call("POST", "/admin/courts", {
        venueId,
        name: court,
        cameraRtspUrl: `rtsp://u:p@10.0.${ip}.${i + 1}:554/stream1`,
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      courtIds.push(res.data.courtId);
    }
    const saved = await call("PUT", `/admin/booking-settings/${venueId}`, {
      deskHoldMinutes: 30,
      onlineHoldMinutes: 15,
      cancelCutoffHours: 24,
      checkInEarlyMinutes: 10,
      hours: ALL_DAY,
      rates: [{ name: "All day", daysOfWeek: EVERY_DAY, startTime: "00:00", endTime: "24:00", pricePerHour: 300 }],
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    return { venueId, courtIds };
  };

  const deskBooking = async (call, courtId, date, startTime, payment = "Free") => {
    const res = await call("POST", "/admin/bookings", {
      courtId,
      date,
      startTime,
      durationMinutes: 60,
      playerName: "Scope Player",
      email: "scope.player@example.test",
      payment,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.data.bookingId;
  };

  const bookingRow = async (bookingId) =>
    (await ctx.sql.query(`SELECT status, courtId, startAt, paymentStatus FROM bookings WHERE bookingId = ?`, [bookingId]))[0][0];

  before(async () => {
    ctx = await startTestApp();
    ({ moment } = await ctx.importFromBack("server/src/utils/dateUtils.js"));
    staffA = await ctx.createStaff("Ops A", { access: "write" });
    const companyB = await ctx.createCompany("Rival Courts");
    staffB = await ctx.createStaff("Ops B", { access: "write", company: companyB });

    const callA = as(staffA);
    const callB = as(staffB);
    Object.assign(a, await setUpVenue(callA, "Alpha Courts", 41));
    Object.assign(b, await setUpVenue(callB, "Bravo Courts", 42));

    // A: a free booking, a paid one (online, test checkout), and a game recording now
    a.date = day(3);
    a.bookingId = await deskBooking(callA, a.courtIds[0], a.date, "10:00");
    a.paidBookingId = await deskBooking(callA, a.courtIds[0], a.date, "12:00", "Hold");
    await ctx.payBooking(a.paidBookingId);
    a.paymentId = (
      await ctx.sql.query(`SELECT paymentId FROM payments WHERE bookingId = ?`, [a.paidBookingId])
    )[0][0].paymentId;
    const game = await callA("POST", "/admin/sessions", {
      courtId: a.courtIds[1],
      startNow: true,
      durationMinutes: 60,
    });
    assert.equal(game.status, 201, JSON.stringify(game.body));
    a.sessionId = game.data.sessionId;

    // B: its own booking
    b.bookingId = await deskBooking(callB, b.courtIds[0], day(4), "10:00");
  });
  after(async () => {
    await ctx?.stop();
  });

  it("B's booking lists, options, day grid and quote never show A's", async () => {
    const callB = as(staffB);
    const list = await callB("GET", "/admin/bookings?pageSize=100");
    assert.equal(list.status, 200);
    const ids = list.data.bookings.map((x) => x.bookingId);
    assert.ok(ids.includes(b.bookingId));
    assert.ok(!ids.includes(a.bookingId) && !ids.includes(a.paidBookingId));
    // Filtering by A's venue finds nothing
    const filtered = await callB("GET", `/admin/bookings?venueId=${a.venueId}`);
    assert.equal(filtered.data.pagination.total, 0);
    assert.equal(filtered.data.stats.revenueToday, 0);

    const options = await callB("GET", "/admin/bookings/options");
    assert.ok(!options.data.venues.some((v) => v.venueId === a.venueId));
    assert.ok(!options.data.courts.some((c) => a.courtIds.includes(c.courtId)));

    assert.equal((await callB("GET", `/admin/bookings/day?venueId=${a.venueId}&date=${a.date}`)).status, 404);
    const quote = await callB(
      "GET",
      `/admin/bookings/quote?courtId=${a.courtIds[0]}&date=${a.date}&startTime=15:00&durationMinutes=60`
    );
    assert.equal(quote.status, 404);
  });

  it("B can't read, move, cancel, check in, mark, resend, refund or delete A's booking", async () => {
    const callB = as(staffB);
    const before = await bookingRow(a.bookingId);
    const id = a.bookingId;
    const tries = [
      ["GET", `/admin/bookings/${id}`],
      ["PUT", `/admin/bookings/${id}/move`, { courtId: a.courtIds[0], date: a.date, startTime: "16:00" }],
      ["POST", `/admin/bookings/${id}/cancel`, { reason: "Not ours" }],
      ["POST", `/admin/bookings/${id}/check-in`],
      ["POST", `/admin/bookings/${id}/no-show`],
      ["POST", `/admin/bookings/${id}/resend`],
      ["POST", `/admin/bookings/${a.paidBookingId}/retry-refund`],
      ["DELETE", `/admin/bookings/${id}`],
    ];
    for (const [method, url, body] of tries) {
      const res = await callB(method, url, body);
      assert.equal(res.status, 404, `${method} ${url} → ${res.status} ${JSON.stringify(res.body)}`);
    }
    assert.deepEqual(await bookingRow(a.bookingId), before);
  });

  it("B can't book or move onto A's courts", async () => {
    const callB = as(staffB);
    const [[{ n: beforeCount }]] = await ctx.sql.query(`SELECT COUNT(*) AS n FROM bookings WHERE courtId = ?`, [
      a.courtIds[0],
    ]);
    const made = await callB("POST", "/admin/bookings", {
      courtId: a.courtIds[0],
      date: a.date,
      startTime: "18:00",
      durationMinutes: 60,
      playerName: "Sneaky",
      payment: "Free",
    });
    assert.equal(made.status, 404);
    const moved = await callB("PUT", `/admin/bookings/${b.bookingId}/move`, {
      courtId: a.courtIds[0],
      date: a.date,
      startTime: "18:00",
    });
    assert.equal(moved.status, 404);
    const [[{ n: afterCount }]] = await ctx.sql.query(`SELECT COUNT(*) AS n FROM bookings WHERE courtId = ?`, [
      a.courtIds[0],
    ]);
    assert.equal(afterCount, beforeCount);
    assert.equal((await bookingRow(b.bookingId)).courtId, b.courtIds[0]);
  });

  it("A doesn't see or reach B's booking either", async () => {
    const callA = as(staffA);
    const list = await callA("GET", "/admin/bookings?pageSize=100");
    assert.ok(!list.data.bookings.some((x) => x.bookingId === b.bookingId));
    assert.equal((await callA("GET", `/admin/bookings/${b.bookingId}`)).status, 404);
    // …while A's own still works
    assert.equal((await callA("GET", `/admin/bookings/${a.bookingId}`)).status, 200);
  });

  it("B can't see, start on, change or end A's games", async () => {
    const callB = as(staffB);
    const list = await callB("GET", "/admin/sessions?pageSize=100");
    assert.equal(list.status, 200);
    assert.ok(!list.data.sessions.some((s) => s.sessionId === a.sessionId));
    assert.equal((await callB("GET", `/admin/sessions?venueId=${a.venueId}`)).data.pagination.total, 0);

    const id = a.sessionId;
    const tries = [
      ["GET", `/admin/sessions/${id}`],
      ["POST", `/admin/sessions/${id}/cancel`],
      ["POST", `/admin/sessions/${id}/end`],
      ["POST", `/admin/sessions/${id}/extend`, { minutes: 15 }],
      ["PATCH", `/admin/sessions/${id}/email`, { email: "x@example.test" }],
      ["POST", `/admin/sessions/${id}/drive-upload`],
      ["POST", `/admin/sessions/${id}/drive-email`],
      ["POST", `/admin/sessions/${id}/stream/stop`],
      ["POST", `/admin/sessions/${id}/pairing-codes`, { name: "Sneaky tablet" }],
      ["POST", `/admin/sessions/${id}/videos/0/retry`],
    ];
    for (const [method, url, body] of tries) {
      const res = await callB(method, url, body);
      assert.equal(res.status, 404, `${method} ${url} → ${res.status} ${JSON.stringify(res.body)}`);
    }
    const [[game]] = await ctx.sql.query(
      `SELECT status, endAt, email, addedMinutes FROM recording_sessions WHERE sessionId = ?`,
      [id]
    );
    assert.equal(game.status, "Recording");
    assert.equal(game.email, null);
    assert.equal(Number(game.addedMinutes), 0);
    const [[{ n: keys }]] = await ctx.sql.query(`SELECT COUNT(*) AS n FROM pairing_codes WHERE sessionId = ?`, [id]);
    assert.equal(keys, 0);

    // New game on A's court: refused, with and without a game time
    const startNow = await callB("POST", "/admin/sessions", {
      courtId: a.courtIds[0],
      startNow: true,
      durationMinutes: 30,
    });
    assert.equal(startNow.status, 404);
    const open = await callB("POST", "/admin/sessions", { courtId: a.courtIds[0] });
    assert.equal(open.status, 404);
    const [[{ n: games }]] = await ctx.sql.query(`SELECT COUNT(*) AS n FROM recording_sessions WHERE courtId = ?`, [
      a.courtIds[0],
    ]);
    assert.equal(games, 0);
  });

  it("B's payments never show A's, and B can't refund one", async () => {
    const callB = as(staffB);
    const list = await callB("GET", "/admin/payments?pageSize=100");
    assert.equal(list.status, 200);
    assert.ok(!list.data.payments.some((p) => p.paymentId === a.paymentId));
    assert.equal(list.data.totals.thisMonth, 0);
    const options = await callB("GET", "/admin/payments/options");
    assert.ok(!options.data.venues.some((v) => v.venueId === a.venueId));

    const refund = await callB("POST", `/admin/payments/${a.paymentId}/refund`, { note: "Not ours" });
    assert.equal(refund.status, 404);
    const [[payment]] = await ctx.sql.query(`SELECT status FROM payments WHERE paymentId = ?`, [a.paymentId]);
    assert.equal(payment.status, "Paid");

    // A still sees its own payment
    const mine = await as(staffA)("GET", "/admin/payments?pageSize=100");
    assert.ok(mine.data.payments.some((p) => p.paymentId === a.paymentId));
  });
});
