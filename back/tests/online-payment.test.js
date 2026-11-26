// PLAN-003 Phase F — paying a booking online through Xendit: the checkout, the
// webhook (callback token, read-back, replays, amount), late payments on a lost
// slot, refunds through cancel (and when Xendit refuses one), closing open
// checkouts, and the settlement statement. Xendit is a fake server here, so
// nothing leaves the machine.

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
const ALL_DAY = EVERY_DAY.map((dayOfWeek) => ({ dayOfWeek, opensAt: "00:00", closesAt: "24:00" }));
const SECRET = XENDIT_TEST_SECRET;
const CALLBACK_TOKEN = XENDIT_TEST_CALLBACK_TOKEN;

describe("online payment through Xendit (PLAN-003 Phase F)", () => {
  let ctx;
  let admin;
  let moment;
  let xendit;
  const home = {};

  const call = (method, url, body) => ctx.api(method, url, { token: admin.token, body });
  const pub = (method, url, body) => ctx.api(method, url, { body });
  // PLAN-006: booking online needs a player signed in with Google — the body's
  // email / playerName say which player books (their account gives both)
  const bookAsPlayer = async (url, { email = "bea@example.com", playerName = "Bea Santos", ...body }) => {
    const player = await ctx.signInPlayer({ email, name: playerName });
    return ctx.api("POST", url, { player: player.token, body });
  };
  const webhook = (body, token = CALLBACK_TOKEN) =>
    ctx.api("POST", "/webhooks/xendit", {
      body,
      headers: token === null ? {} : { "x-callback-token": token },
    });

  const at = (hoursFromNow) =>
    moment().tz("Asia/Manila").startOf("hour").add(hoursFromNow, "hours").format(FORMAT);
  const slot = (hoursFromNow) => {
    const s = at(hoursFromNow);
    return { date: s.slice(0, 10), startTime: s.slice(11, 16) };
  };
  const now = () => moment().tz("Asia/Manila").format(FORMAT);

  const bookingRow = async (bookingCode) =>
    (await ctx.sql.query(`SELECT * FROM bookings WHERE bookingCode = ?`, [bookingCode]))[0][0];
  const paymentsOf = async (bookingId) =>
    (
      await ctx.sql.query(`SELECT * FROM payments WHERE bookingId = ? ORDER BY dateCreated ASC`, [
        bookingId,
      ])
    )[0];
  const invoiceIdOf = (checkoutUrl) => checkoutUrl.split("/").pop();

  /** A player books online → { bookingCode, manageToken, checkoutUrl, invoiceId, bookingId } */
  const bookOnline = async (hoursFromNow, body = {}) => {
    const res = await bookAsPlayer(`/public/book/${home.token}/bookings`, {
      courtKey: home.courtKey,
      ...slot(hoursFromNow),
      durationMinutes: 60,
      playerName: "Bea Santos",
      email: "bea@example.com",
      payMethod: "Online",
      ...body,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const row = await bookingRow(res.data.bookingCode);
    return {
      ...res.data,
      invoiceId: invoiceIdOf(res.data.checkoutUrl),
      bookingId: row.bookingId,
    };
  };

  /** Pay it at Xendit and deliver the webhook. */
  const payAndNotify = (booking) => {
    xendit.pay(booking.invoiceId);
    return webhook({
      id: booking.invoiceId,
      external_id: `booking-${booking.bookingCode}`,
      status: "PAID",
    });
  };

  before(async () => {
    xendit = fakeXendit();
    await new Promise((resolve) => xendit.server.listen(0, "127.0.0.1", resolve));
    ctx = await startTestApp({
      env: {
        XENDIT_SECRET_KEY: SECRET,
        XENDIT_CALLBACK_TOKEN: CALLBACK_TOKEN,
        XENDIT_API_URL: `http://127.0.0.1:${xendit.server.address().port}`,
        APP_URL: "http://web.test",
        RATE_LIMIT_PUBLIC_BOOK_POINTS: "1000",
        RATE_LIMIT_PUBLIC_PAY_POINTS: "1000",
      },
    });
    admin = await ctx.createStaff("Admin", { access: "write" });
    ({ moment } = await ctx.importFromBack("server/src/utils/dateUtils.js"));

    home.venueId = (
      await call("POST", "/admin/venues", { name: "Online Pay Courts" })
    ).data.venueId;
    const court = await call("POST", "/admin/courts", { venueId: home.venueId, name: "Court 1" });
    home.courtId = court.data.courtId;
    const saved = await call("PUT", `/admin/booking-settings/${home.venueId}`, {
      maxBookingMinutes: 180,
      bookingDaysAhead: 14,
      deskHoldMinutes: 30,
      onlineHoldMinutes: 15,
      cancelCutoffHours: 24,
      checkInEarlyMinutes: 10,
      hours: ALL_DAY,
      rates: [
        {
          name: "All day",
          daysOfWeek: EVERY_DAY,
          startTime: "00:00",
          endTime: "24:00",
          pricePerHour: 400,
        },
      ],
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const link = await call("POST", `/admin/booking-settings/${home.venueId}/link`);
    home.token = link.data.bookingUrl.split("/book/")[1];
    home.courtKey = (await pub("GET", `/public/book/${home.token}`)).data.courts[0].key;
  });
  after(async () => {
    await ctx?.stop();
    await new Promise((resolve) => xendit?.server.close(resolve));
  });

  it("is off without both keys: no Pay now, Online refused, webhook refused", async () => {
    const saved = process.env.XENDIT_SECRET_KEY;
    process.env.XENDIT_SECRET_KEY = "";
    try {
      assert.equal((await pub("GET", `/public/book/${home.token}`)).data.payOnline, false);
      const res = await bookAsPlayer(`/public/book/${home.token}/bookings`, {
        courtKey: home.courtKey,
        ...slot(30),
        durationMinutes: 60,
        playerName: "Bea Santos",
        email: "bea@example.com",
        payMethod: "Online",
      });
      assert.equal(res.status, 409);
    } finally {
      process.env.XENDIT_SECRET_KEY = saved;
    }
    assert.equal((await pub("GET", `/public/book/${home.token}`)).data.payOnline, true);
  });

  it("books online: holds the slot for the checkout and opens a Xendit invoice for its price", async () => {
    const booking = await bookOnline(28, { durationMinutes: 120 });
    assert.match(booking.checkoutUrl, /^https:\/\/checkout\.test\/web\//);

    const row = await bookingRow(booking.bookingCode);
    assert.equal(row.status, "Pending");
    assert.equal(row.paymentStatus, "Unpaid");
    assert.equal(row.payMethod, "Online");
    assert.equal(row.checkoutId, booking.invoiceId);
    const holdMinutes = moment
      .tz(row.holdExpiresAt, FORMAT, "Asia/Manila")
      .diff(moment.tz(now(), FORMAT, "Asia/Manila"), "minutes", true);
    assert.ok(holdMinutes > 14 && holdMinutes <= 15.1, `hold ${holdMinutes} min`);

    const invoice = xendit.invoices.get(booking.invoiceId);
    assert.equal(invoice.amount, 800); // 2 h × ₱400, from the server's price
    assert.equal(invoice.currency, "PHP");
    assert.equal(invoice.external_id, `booking-${booking.bookingCode}`);
    assert.equal(invoice.payer_email, "bea@example.com");
    assert.ok(invoice.invoice_duration > 840 && invoice.invoice_duration <= 900);
    assert.equal(
      invoice.success_redirect_url,
      `http://web.test/booking/${booking.manageToken}?checkout=done`
    );
    // No business ID goes to Xendit
    assert.ok(!JSON.stringify(invoice).includes(booking.bookingId));

    const page = await pub("GET", `/public/bookings/${booking.manageToken}`);
    assert.equal(page.data.booking.checkoutOpen, true);
    assert.equal(page.data.booking.actions.payOnline, true);
  });

  it("refuses a webhook with a wrong or missing callback token, and changes nothing", async () => {
    const booking = await bookOnline(31);
    xendit.pay(booking.invoiceId);
    for (const token of ["wrong-token", null, ""]) {
      const res = await webhook({ id: booking.invoiceId, status: "PAID" }, token);
      assert.equal(res.status, 401, `token ${token}`);
    }
    assert.equal((await bookingRow(booking.bookingCode)).status, "Pending");
    assert.equal((await paymentsOf(booking.bookingId)).length, 0);
  });

  it("believes Xendit's API, not the webhook body: 'PAID' in the body alone changes nothing", async () => {
    const booking = await bookOnline(32);
    const res = await webhook({
      id: booking.invoiceId,
      external_id: `booking-${booking.bookingCode}`,
      status: "PAID",
      amount: 400,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.data.outcome, "NOT_PAID");
    assert.equal((await bookingRow(booking.bookingCode)).status, "Pending");
    assert.equal((await paymentsOf(booking.bookingId)).length, 0);

    // An ID Xendit has never heard of is ignored (200, so it isn't retried)
    const stray = await webhook({ id: "inv_forged_123", status: "PAID" });
    assert.equal(stray.status, 200);
    assert.equal(stray.data.outcome, "UNKNOWN");
  });

  it("confirms on a paid invoice, once — a replayed webhook records no second payment", async () => {
    const booking = await bookOnline(33);
    const first = await payAndNotify(booking);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.data.outcome, "CONFIRMED");

    const row = await bookingRow(booking.bookingCode);
    assert.equal(row.status, "Confirmed");
    assert.equal(row.paymentStatus, "Paid");
    assert.equal(row.holdExpiresAt, null);
    assert.equal(row.checkoutId, null);

    const replay = await webhook({ id: booking.invoiceId, status: "PAID" });
    assert.equal(replay.data.outcome, "ALREADY_RECORDED");
    const [concurrentA, concurrentB] = await Promise.all([
      webhook({ id: booking.invoiceId }),
      webhook({ id: booking.invoiceId }),
    ]);
    assert.equal(concurrentA.status, 200);
    assert.equal(concurrentB.status, 200);

    const payments = await paymentsOf(booking.bookingId);
    assert.equal(payments.length, 1);
    assert.equal(payments[0].method, "ONLINE");
    assert.equal(payments[0].provider, "xendit");
    assert.equal(payments[0].providerRef, booking.invoiceId);
    assert.equal(Number(payments[0].amount), 400);
    assert.equal(payments[0].status, "Paid");

    const page = await pub("GET", `/public/bookings/${booking.manageToken}`);
    assert.equal(page.data.booking.status, "Confirmed");
    assert.equal(page.data.booking.actions.payOnline, false);
  });

  it("never confirms a payment whose amount isn't the booking's price — it's refunded", async () => {
    const booking = await bookOnline(34);
    xendit.invoices.get(booking.invoiceId).amount = 1; // e.g. a checkout from before a reprice
    const res = await payAndNotify(booking);
    assert.equal(res.status, 200);
    assert.equal(res.data.outcome, "REFUNDED");

    const row = await bookingRow(booking.bookingCode);
    assert.equal(row.status, "Pending");
    assert.equal(row.paymentStatus, "Unpaid");
    const [payment] = await paymentsOf(booking.bookingId);
    assert.equal(payment.status, "Refunded");
    assert.ok(payment.providerRefundRef);
  });

  it("a payment after the hold ran out keeps the slot if it's still free", async () => {
    const booking = await bookOnline(35);
    await ctx.sql.query(`UPDATE bookings SET holdExpiresAt = ? WHERE bookingId = ?`, [
      at(-1),
      booking.bookingId,
    ]);
    await pub(
      "GET",
      `/public/book/${home.token}/availability?date=${slot(35).date}&durationMinutes=60`
    );
    assert.equal((await bookingRow(booking.bookingCode)).status, "Expired");

    const res = await payAndNotify(booking);
    assert.equal(res.data.outcome, "CONFIRMED");
    assert.equal((await bookingRow(booking.bookingCode)).status, "Confirmed");
  });

  it("a payment after the slot was taken is refunded in full, automatically", async () => {
    const booking = await bookOnline(36);
    await ctx.sql.query(`UPDATE bookings SET holdExpiresAt = ? WHERE bookingId = ?`, [
      at(-1),
      booking.bookingId,
    ]);
    // Staff sell the slot at the desk meanwhile
    const desk = await call("POST", "/admin/bookings", {
      courtId: home.courtId,
      ...slot(36),
      durationMinutes: 60,
      playerName: "Walk-in",
      payment: "Free",
    });
    assert.equal(desk.status, 201, JSON.stringify(desk.body));

    const res = await payAndNotify(booking);
    assert.equal(res.data.outcome, "REFUNDED");
    const row = await bookingRow(booking.bookingCode);
    assert.equal(row.status, "Expired");
    assert.equal(row.paymentStatus, "Unpaid");
    const [payment] = await paymentsOf(booking.bookingId);
    assert.equal(payment.status, "Refunded");
    assert.equal(payment.refundError, null);
    const refund = xendit.refunds.get(payment.providerRefundRef);
    assert.equal(refund.invoice_id, booking.invoiceId);
    assert.equal(refund.amount, 400);
    assert.equal(refund.reference_id, payment.paymentId);
  });

  it("staff cancel of a paid online booking refunds it through Xendit", async () => {
    const booking = await bookOnline(37);
    await payAndNotify(booking);
    const res = await call("POST", `/admin/bookings/${booking.bookingId}/cancel`, {
      reason: "Player asked",
      refund: true,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.data.refundedOnline, 400);
    assert.equal(res.data.refundFailed, 0);
    assert.match(res.body.message, /refunded online through Xendit/);

    const row = await bookingRow(booking.bookingCode);
    assert.equal(row.status, "Cancelled");
    assert.equal(row.paymentStatus, "Refunded");
    const [payment] = await paymentsOf(booking.bookingId);
    assert.equal(payment.status, "Refunded");
    assert.ok(payment.providerRefundRef);
  });

  it("when Xendit refuses a refund the booking is still cancelled and shows Refund failed", async () => {
    const booking = await bookOnline(38);
    await payAndNotify(booking);
    xendit.refuseRefunds = true;
    let res;
    try {
      res = await call("POST", `/admin/bookings/${booking.bookingId}/cancel`, {
        reason: "Court flooded",
        refund: true,
      });
    } finally {
      xendit.refuseRefunds = false;
    }
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.data.refundFailed, 400);
    assert.match(res.body.message, /failed/);

    const row = await bookingRow(booking.bookingCode);
    assert.equal(row.status, "Cancelled");
    assert.equal(row.paymentStatus, "Paid"); // the money is still owed back
    const [payment] = await paymentsOf(booking.bookingId);
    assert.equal(payment.status, "Paid");
    assert.match(payment.refundError, /REFUND_NOT_SUPPORTED/);

    // Shown in the booking drawer and in Payments
    const detail = await call("GET", `/admin/bookings/${booking.bookingId}`);
    assert.match(detail.data.booking.payments[0].refundError, /REFUND_NOT_SUPPORTED/);
    const list = await call("GET", `/admin/payments?venueId=${home.venueId}`);
    const listed = list.data.payments.find((p) => p.paymentId === payment.paymentId);
    assert.match(listed.refundError, /REFUND_NOT_SUPPORTED/);

    // Try again once Xendit takes it
    const retry = await call("POST", `/admin/bookings/${booking.bookingId}/retry-refund`);
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(retry.data.refundedOnline, 400);
    assert.equal((await bookingRow(booking.bookingCode)).paymentStatus, "Refunded");
    const again = await call("POST", `/admin/bookings/${booking.bookingId}/retry-refund`);
    assert.equal(again.status, 409);
  });

  it("a refund failed by hand: staff mark it repaid in Payments", async () => {
    const booking = await bookOnline(39);
    await payAndNotify(booking);
    xendit.refuseRefunds = true;
    try {
      await call("POST", `/admin/bookings/${booking.bookingId}/cancel`, {
        reason: "Rain",
        refund: true,
      });
    } finally {
      xendit.refuseRefunds = false;
    }
    const [payment] = await paymentsOf(booking.bookingId);
    const res = await call("POST", `/admin/payments/${payment.paymentId}/refund`, {
      note: "GCash sent by hand",
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const [after] = await paymentsOf(booking.bookingId);
    assert.equal(after.status, "Refunded");
    assert.equal(after.refundError, null);
    assert.equal((await bookingRow(booking.bookingCode)).paymentStatus, "Refunded");
  });

  it("Xendit's refund.failed after accepting a refund puts the payment back to Refund failed", async () => {
    const booking = await bookOnline(40);
    await payAndNotify(booking);
    await call("POST", `/admin/bookings/${booking.bookingId}/cancel`, {
      reason: "Asked",
      refund: true,
    });
    const [payment] = await paymentsOf(booking.bookingId);
    const refundId = payment.providerRefundRef;

    // Body alone says failed, Xendit's API still says PENDING → nothing changes
    const premature = await webhook({
      event: "refund.failed",
      data: { id: refundId, status: "FAILED" },
    });
    assert.equal(premature.data.outcome, "NO_CHANGE");
    assert.equal((await paymentsOf(booking.bookingId))[0].status, "Refunded");

    Object.assign(xendit.refunds.get(refundId), {
      status: "FAILED",
      failure_code: "ACCOUNT_CLOSED",
    });
    const res = await webhook({ event: "refund.failed", data: { id: refundId } });
    assert.equal(res.data.outcome, "REFUND_FAILED");
    const [after] = await paymentsOf(booking.bookingId);
    assert.equal(after.status, "Paid");
    assert.match(after.refundError, /ACCOUNT_CLOSED/);
    assert.equal((await bookingRow(booking.bookingCode)).paymentStatus, "Paid");
  });

  it("cancelling or moving an unpaid online booking closes its checkout", async () => {
    const cancelled = await bookOnline(41);
    const res = await call("POST", `/admin/bookings/${cancelled.bookingId}/cancel`, {
      reason: "Duplicate",
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(xendit.invoices.get(cancelled.invoiceId).status, "EXPIRED");
    assert.equal((await bookingRow(cancelled.bookingCode)).checkoutId, null);

    const moved = await bookOnline(42);
    const move = await call("PUT", `/admin/bookings/${moved.bookingId}/move`, {
      courtId: home.courtId,
      ...slot(43),
    });
    assert.equal(move.status, 200, JSON.stringify(move.body));
    assert.equal(xendit.invoices.get(moved.invoiceId).status, "EXPIRED");
    // The player pays the moved booking with a fresh checkout
    const pay = await pub("POST", `/public/bookings/${moved.manageToken}/pay`);
    assert.equal(pay.status, 200, JSON.stringify(pay.body));
    assert.notEqual(invoiceIdOf(pay.data.checkoutUrl), moved.invoiceId);

    // Cash at the desk closes it too
    const desk = await bookOnline(44);
    const cash = await call("POST", `/admin/bookings/${desk.bookingId}/payments`, {});
    assert.equal(cash.status, 201, JSON.stringify(cash.body));
    assert.equal(xendit.invoices.get(desk.invoiceId).status, "EXPIRED");
  });

  it("Pay reopens the open checkout, or opens a new one while the hold lasts", async () => {
    const booking = await bookOnline(45);
    const again = await pub("POST", `/public/bookings/${booking.manageToken}/pay`);
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.data.checkoutUrl, booking.checkoutUrl);

    xendit.invoices.get(booking.invoiceId).status = "EXPIRED";
    const fresh = await pub("POST", `/public/bookings/${booking.manageToken}/pay`);
    assert.equal(fresh.status, 200);
    assert.notEqual(fresh.data.checkoutUrl, booking.checkoutUrl);

    // Paid already (the webhook hasn't come): settled right here
    xendit.pay(invoiceIdOf(fresh.data.checkoutUrl));
    const paid = await pub("POST", `/public/bookings/${booking.manageToken}/pay`);
    assert.equal(paid.data.paid, true);
    assert.equal((await bookingRow(booking.bookingCode)).status, "Confirmed");
    assert.equal((await pub("POST", `/public/bookings/${booking.manageToken}/pay`)).status, 409);

    // A desk hold can be paid online too
    const deskHold = await bookAsPlayer(`/public/book/${home.token}/bookings`, {
      courtKey: home.courtKey,
      ...slot(46),
      durationMinutes: 60,
      playerName: "Bea Santos",
      email: "bea@example.com",
      payMethod: "Desk",
    });
    const deskPay = await pub("POST", `/public/bookings/${deskHold.data.manageToken}/pay`);
    assert.equal(deskPay.status, 200, JSON.stringify(deskPay.body));
    assert.ok(deskPay.data.checkoutUrl);
  });

  it("the booking page asks Xendit when the player comes back before the webhook", async () => {
    const booking = await bookOnline(47);
    xendit.pay(booking.invoiceId);
    const page = await pub("GET", `/public/bookings/${booking.manageToken}`);
    assert.equal(page.status, 200);
    assert.equal(page.data.booking.status, "Confirmed");
    assert.equal(page.data.booking.paymentStatus, "Paid");
    // The webhook arriving afterwards records nothing twice
    const late = await webhook({ id: booking.invoiceId });
    assert.equal(late.data.outcome, "ALREADY_RECORDED");
    assert.equal((await paymentsOf(booking.bookingId)).length, 1);
  });

  it("a Deleted booking can't be paid, and its refund can't be retried", async () => {
    const booking = await bookOnline(48);
    await ctx.sql.query(`UPDATE bookings SET status = 'Deleted' WHERE bookingId = ?`, [
      booking.bookingId,
    ]);
    assert.equal((await pub("POST", `/public/bookings/${booking.manageToken}/pay`)).status, 404);
    assert.equal(
      (await call("POST", `/admin/bookings/${booking.bookingId}/retry-refund`)).status,
      404
    );
    assert.equal((await bookingRow(booking.bookingCode)).status, "Deleted");

    // Paid anyway (an old checkout): the money goes back
    const res = await payAndNotify(booking);
    assert.equal(res.data.outcome, "REFUNDED");
  });

  it("Payments → Online settlement: each venue's online money for a date range", async () => {
    const today = now().slice(0, 10);
    const res = await call("GET", `/admin/payments/settlement?dateFrom=${today}&dateTo=${today}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const venue = res.data.venues.find((v) => v.venueId === home.venueId);
    assert.ok(venue);
    const [[expected]] = await ctx.sql.query(
      `SELECT COUNT(*) AS n, SUM(amount) AS collected,
              SUM(CASE WHEN status = 'Refunded' THEN amount ELSE 0 END) AS refunded
       FROM payments WHERE method = 'ONLINE' AND venueId = ?`,
      [home.venueId]
    );
    assert.equal(venue.payments, Number(expected.n));
    assert.equal(venue.collected, Number(expected.collected));
    assert.equal(venue.refunded, Number(expected.refunded));
    assert.equal(venue.net, venue.collected - venue.refunded - venue.refundFailed);
    // Cash isn't on the statement
    assert.equal(res.data.totals.collected, venue.collected);

    const viewer = await ctx.createStaff("No payments");
    const refused = await ctx.api("GET", "/admin/payments/settlement", { token: viewer.token });
    assert.equal(refused.status, 403);
    const bad = await call("GET", `/admin/payments/settlement?dateFrom=${today}&dateTo=2000-01-01`);
    assert.equal(bad.status, 400);
  });
});
