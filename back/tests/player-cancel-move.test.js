// PLAN-003 Phase H — a player cancels or moves their own booking from its page:
// only before the venue's cut-off; cancel refunds an online payment in full
// (Xendit) and closes an open checkout; a booking moves once, same length, to
// a free time that costs the same or less, and keeps its price. Xendit is a
// fake server here.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  fakeXendit,
  XENDIT_TEST_CALLBACK_TOKEN,
  XENDIT_TEST_SECRET,
} from "./helpers/fakeXendit.js";
import { startTestApp } from "./helpers/testApp.js";

const FORMAT = "YYYY-MM-DD HH:mm:ss";
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const OPEN_6_TO_23 = EVERY_DAY.map((dayOfWeek) => ({
  dayOfWeek,
  opensAt: "06:00",
  closesAt: "23:00",
}));
// Day hours ₱300, evening hours ₱500
const RATES = [
  { name: "Day", daysOfWeek: EVERY_DAY, startTime: "06:00", endTime: "18:00", pricePerHour: 300 },
  {
    name: "Evening",
    daysOfWeek: EVERY_DAY,
    startTime: "18:00",
    endTime: "23:00",
    pricePerHour: 500,
  },
];

describe("player cancel and move (PLAN-003 Phase H)", () => {
  let ctx;
  let admin;
  let moment;
  let xendit;
  const home = {};
  let courtNo = 0;

  const call = (method, url, body) => ctx.api(method, url, { token: admin.token, body });
  const pub = (method, url, body) => ctx.api(method, url, { body });
  // PLAN-006: booking online needs a player signed in with Google — the body's
  // email / playerName say which player books (their account gives both)
  const bookAsPlayer = async (url, { email = "bea@example.com", playerName = "Bea Santos", ...body }) => {
    const player = await ctx.signInPlayer({ email, name: playerName });
    return ctx.api("POST", url, { player: player.token, body });
  };

  /** "YYYY-MM-DD" this many days from today (Manila). */
  const day = (daysAhead) => moment().tz("Asia/Manila").add(daysAhead, "days").format("YYYY-MM-DD");
  const hoursFromNow = (hours) =>
    moment().tz("Asia/Manila").startOf("hour").add(hours, "hours").format(FORMAT);

  const row = async (bookingId) =>
    (await ctx.sql.query(`SELECT * FROM bookings WHERE bookingId = ?`, [bookingId]))[0][0];

  const newCourt = async () => {
    courtNo += 1;
    const res = await call("POST", "/admin/courts", {
      venueId: home.venueId,
      name: `Court ${courtNo}`,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.data.courtId;
  };

  /** A desk booking → { bookingId, manageToken, courtId } */
  const deskBooking = async ({
    date = day(3),
    startTime = "10:00",
    payment = "Hold",
    courtId,
  } = {}) => {
    const court = courtId || (await newCourt());
    const res = await call("POST", "/admin/bookings", {
      courtId: court,
      date,
      startTime,
      durationMinutes: 60,
      playerName: "Bea Santos",
      email: "bea@example.test",
      payment,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const { manageToken } = await row(res.data.bookingId);
    return { bookingId: res.data.bookingId, manageToken, courtId: court };
  };

  /** A booking paid online (through the fake Xendit and its webhook) → + { invoiceId } */
  const paidOnline = async ({ date = day(3), startTime = "20:00" } = {}) => {
    const courtId = await newCourt();
    const link = await call("POST", `/admin/booking-settings/${home.venueId}/link`);
    const token = link.data.bookingUrl.split("/book/")[1];
    const courts = (await pub("GET", `/public/book/${token}`)).data.courts;
    const court = courts.find((c) => c.name === `Court ${courtNo}`);
    const res = await bookAsPlayer(`/public/book/${token}/bookings`, {
      courtKey: court.key,
      date,
      startTime,
      durationMinutes: 60,
      playerName: "Bea Santos",
      email: "bea@example.test",
      payMethod: "Online",
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const invoiceId = res.data.checkoutUrl.split("/").pop();
    xendit.pay(invoiceId);
    const hook = await ctx.api("POST", "/webhooks/xendit", {
      body: { id: invoiceId },
      headers: { "x-callback-token": XENDIT_TEST_CALLBACK_TOKEN },
    });
    assert.equal(hook.data.outcome, "CONFIRMED", JSON.stringify(hook.body));
    const [[b]] = await ctx.sql.query(`SELECT bookingId FROM bookings WHERE manageToken = ?`, [
      res.data.manageToken,
    ]);
    return { bookingId: b.bookingId, manageToken: res.data.manageToken, courtId, invoiceId };
  };

  const page = async (manageToken) =>
    (await pub("GET", `/public/bookings/${manageToken}`)).data.booking;
  const moveOptions = (manageToken, date) =>
    pub("GET", `/public/bookings/${manageToken}/move-options?date=${date}`);
  const slotOf = (options, courtName, startTime) =>
    options.data.courts
      .find((c) => c.name === courtName)
      .slots.find((s) => s.startTime === startTime);

  before(async () => {
    xendit = fakeXendit();
    await new Promise((resolve) => xendit.server.listen(0, "127.0.0.1", resolve));
    ctx = await startTestApp({
      env: {
        XENDIT_SECRET_KEY: XENDIT_TEST_SECRET,
        XENDIT_CALLBACK_TOKEN: XENDIT_TEST_CALLBACK_TOKEN,
        // CR-046: this file tests real Xendit (a fake), not the built-in test checkout
        PAYMENT_SANDBOX: "",
        XENDIT_API_URL: `http://127.0.0.1:${xendit.server.address().port}`,
        APP_URL: "http://web.test",
        RATE_LIMIT_PUBLIC_BOOK_POINTS: "1000",
        RATE_LIMIT_PUBLIC_CHANGE_POINTS: "1000",
      },
    });
    admin = await ctx.createStaff("Admin", { access: "write" });
    ({ moment } = await ctx.importFromBack("server/src/utils/dateUtils.js"));
    home.venueId = (await call("POST", "/admin/venues", { name: "Change Courts" })).data.venueId;
    const saved = await call("PUT", `/admin/booking-settings/${home.venueId}`, {
      maxBookingMinutes: 180,
      bookingDaysAhead: 14,
      deskHoldMinutes: 30,
      onlineHoldMinutes: 15,
      cancelCutoffHours: 24,
      checkInEarlyMinutes: 10,
      hours: OPEN_6_TO_23,
      rates: RATES,
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
  });
  after(async () => {
    await ctx?.stop();
    await new Promise((resolve) => xendit?.server.close(resolve));
  });

  it("offers Cancel and Move before the cut-off, and says why not after it", async () => {
    const early = await deskBooking();
    const p = await page(early.manageToken);
    assert.equal(p.actions.cancel, true);
    assert.equal(p.actions.move, true);
    assert.equal(p.cutoffPassed, false);

    // Inside the 24 h cut-off
    const soon = hoursFromNow(5);
    const late = await deskBooking({
      date: soon.slice(0, 10),
      startTime: soon.slice(11, 16),
      payment: "Free",
    });
    const q = await page(late.manageToken);
    assert.equal(q.actions.cancel, false);
    assert.equal(q.actions.move, false);
    assert.equal(q.cutoffPassed, true);

    const cancel = await pub("POST", `/public/bookings/${late.manageToken}/cancel`);
    assert.equal(cancel.status, 409);
    assert.match(cancel.body.message, /call the venue/);
    const move = await pub("POST", `/public/bookings/${late.manageToken}/move`, {
      date: day(4),
      startTime: "10:00",
    });
    assert.equal(move.status, 409);
    assert.equal((await moveOptions(late.manageToken, day(4))).status, 409);
    assert.equal((await row(late.bookingId)).status, "Confirmed");
  });

  it("cancels an unpaid desk hold — nothing to refund", async () => {
    const b = await deskBooking();
    const res = await pub("POST", `/public/bookings/${b.manageToken}/cancel`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const after = await row(b.bookingId);
    assert.equal(after.status, "Cancelled");
    assert.equal(after.cancelledBy, "Player");
    assert.equal((await page(b.manageToken)).actions.cancel, false);
    assert.equal((await pub("POST", `/public/bookings/${b.manageToken}/cancel`)).status, 409);
  });

  it("a booking paid in cash (before CR-046) is cancelled at the desk, not online", async () => {
    // No new cash payments (CR-046) — one paid at the desk before then, as it's stored
    const b = await deskBooking({ payment: "Hold" });
    await ctx.sql.query(
      `UPDATE bookings SET status = 'Confirmed', paymentStatus = 'Paid', holdExpiresAt = NULL
       WHERE bookingId = ?`,
      [b.bookingId]
    );
    await ctx.sql.query(
      `INSERT INTO payments (paymentId, bookingId, venueId, amount, method, status, paidAt, dateCreated, dateUpdated)
       SELECT UUID(), bookingId, venueId, price, 'CASH', 'Paid', dateCreated, dateCreated, dateCreated
       FROM bookings WHERE bookingId = ?`,
      [b.bookingId]
    );
    const p = await page(b.manageToken);
    assert.equal(p.paidAtDesk, true);
    assert.equal(p.actions.cancel, false);
    assert.equal(p.actions.move, true);
    const res = await pub("POST", `/public/bookings/${b.manageToken}/cancel`);
    assert.equal(res.status, 409);
    assert.match(res.body.message, /paid at the desk/);
    assert.equal((await row(b.bookingId)).status, "Confirmed");
  });

  it("an online-paid booking cancelled before the cut-off is refunded in full through Xendit", async () => {
    const b = await paidOnline();
    const res = await pub("POST", `/public/bookings/${b.manageToken}/cancel`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.data.refunded, 500);
    const after = await row(b.bookingId);
    assert.equal(after.status, "Cancelled");
    assert.equal(after.paymentStatus, "Refunded");
    const [[payment]] = await ctx.sql.query(`SELECT * FROM payments WHERE bookingId = ?`, [
      b.bookingId,
    ]);
    assert.equal(payment.status, "Refunded");
    const refund = xendit.refunds.get(payment.providerRefundRef);
    assert.equal(refund.amount, 500);
    assert.equal(refund.invoice_id, b.invoiceId);
    assert.equal(refund.reason, "REQUESTED_BY_CUSTOMER");
  });

  it("cancelling an unpaid online booking closes its checkout", async () => {
    const courtId = await newCourt();
    const link = await call("POST", `/admin/booking-settings/${home.venueId}/link`);
    const token = link.data.bookingUrl.split("/book/")[1];
    const court = (await pub("GET", `/public/book/${token}`)).data.courts.find(
      (c) => c.name === `Court ${courtNo}`
    );
    assert.ok(courtId);
    const res = await bookAsPlayer(`/public/book/${token}/bookings`, {
      courtKey: court.key,
      date: day(3),
      startTime: "11:00",
      durationMinutes: 60,
      playerName: "Bea Santos",
      email: "bea@example.test",
      payMethod: "Online",
    });
    const invoiceId = res.data.checkoutUrl.split("/").pop();
    assert.equal(
      (await pub("POST", `/public/bookings/${res.data.manageToken}/cancel`)).status,
      200
    );
    assert.equal(xendit.invoices.get(invoiceId).status, "EXPIRED");
  });

  it("move options: same length, only times at the same price or less, its own time marked", async () => {
    const b = await paidOnline({ startTime: "20:00" }); // ₱500
    const options = await moveOptions(b.manageToken, day(4));
    assert.equal(options.status, 200, JSON.stringify(options.body));
    assert.equal(options.data.durationMinutes, 60);
    assert.equal(options.data.maxPrice, 500);
    const name = `Court ${courtNo}`;
    assert.equal(slotOf(options, name, "10:00").price, 300);
    assert.equal(slotOf(options, name, "21:00").price, 500);
    // No business IDs
    assert.ok(!JSON.stringify(options.body).includes(b.courtId));

    const own = await moveOptions(b.manageToken, day(3));
    const current = slotOf(own, name, "20:00");
    assert.equal(current.current, true);
    assert.equal(current.available, false);

    // A cheaper booking can't see the pricier evening hours
    const cheap = await deskBooking({ startTime: "09:00", payment: "Free" });
    const cheapOptions = await moveOptions(cheap.manageToken, day(4));
    const cheapName = `Court ${courtNo}`;
    assert.equal(slotOf(cheapOptions, cheapName, "20:00").available, false);
    assert.equal(slotOf(cheapOptions, cheapName, "10:00").available, true);
  });

  it("moves once, keeps the price, and refuses a second move", async () => {
    const b = await paidOnline({ startTime: "20:00" }); // ₱500
    const res = await pub("POST", `/public/bookings/${b.manageToken}/move`, {
      date: day(5),
      startTime: "10:00",
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const after = await row(b.bookingId);
    assert.equal(after.startAt, `${day(5)} 10:00:00`);
    assert.equal(after.endAt, `${day(5)} 11:00:00`);
    assert.equal(Number(after.price), 500); // kept — no partial refund
    assert.equal(after.rescheduledCount, 1);
    assert.equal(after.paymentStatus, "Paid");

    const p = await page(b.manageToken);
    assert.equal(p.actions.move, false);
    assert.equal(p.movedOnce, true);
    assert.equal(p.actions.cancel, true);
    const again = await pub("POST", `/public/bookings/${b.manageToken}/move`, {
      date: day(5),
      startTime: "11:00",
    });
    assert.equal(again.status, 409);
    assert.match(again.body.message, /already moved/);
    assert.equal((await moveOptions(b.manageToken, day(5))).status, 409);
  });

  it("refuses a pricier time, a taken time, closed hours and the past — and changes nothing", async () => {
    const b = await deskBooking({ startTime: "10:00", payment: "Free" });
    const blocker = await deskBooking({
      courtId: b.courtId,
      date: day(4),
      startTime: "12:00",
      payment: "Free",
    });
    assert.ok(blocker.bookingId);

    const cases = [
      [{ date: day(4), startTime: "19:00" }, 409, /costs ₱500/], // pricier: ₱0 → evening
      [{ date: day(4), startTime: "12:00" }, 409, /just taken/],
      [{ date: day(4), startTime: "23:00" }, 409, /opening hours/],
      // CR-043: past the confirmed week (next Sunday) before the 14-day limit
      [{ date: day(20), startTime: "10:00" }, 400, /aren't open yet/],
    ];
    for (const [body, status, message] of cases) {
      const res = await pub("POST", `/public/bookings/${b.manageToken}/move`, body);
      assert.equal(res.status, status, `${JSON.stringify(body)} → ${JSON.stringify(res.body)}`);
      assert.match(res.body.message, message);
    }
    const after = await row(b.bookingId);
    assert.equal(after.startAt, `${day(3)} 10:00:00`);
    assert.equal(after.rescheduledCount, 0);
  });

  it("moves to another court by its key", async () => {
    const b = await deskBooking({ startTime: "10:00" });
    const other = await newCourt();
    const options = await moveOptions(b.manageToken, day(3));
    const key = options.data.courts.find((c) => c.name === `Court ${courtNo}`).key;
    const res = await pub("POST", `/public/bookings/${b.manageToken}/move`, {
      courtKey: key,
      date: day(3),
      startTime: "10:00",
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const after = await row(b.bookingId);
    assert.equal(after.courtId, other);
    // A desk hold follows the new start
    assert.equal(after.holdExpiresAt, `${day(3)} 09:30:00`);

    const bad = await pub("POST", `/public/bookings/${b.manageToken}/move`, {
      courtKey: "0123456789abcdef",
      date: day(3),
      startTime: "11:00",
    });
    assert.equal(bad.status, 409); // moved once already
  });

  it("a Deleted booking's link is gone", async () => {
    const b = await deskBooking();
    assert.equal((await call("DELETE", `/admin/bookings/${b.bookingId}`)).status, 200);
    assert.equal((await pub("POST", `/public/bookings/${b.manageToken}/cancel`)).status, 404);
    assert.equal(
      (
        await pub("POST", `/public/bookings/${b.manageToken}/move`, {
          date: day(4),
          startTime: "10:00",
        })
      ).status,
      404
    );
    assert.equal((await moveOptions(b.manageToken, day(4))).status, 404);
    assert.equal((await row(b.bookingId)).status, "Deleted");
  });
});
