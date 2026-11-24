// CR-033 — the payment sandbox: PAYMENT_SANDBOX=true stands a built-in test
// checkout in for Xendit (no keys, nothing leaves the machine). Book online,
// the test checkout's view, Pay, the booking turning Paid when its page is
// opened, Pay again, closing a checkout, refunds, and the switch itself.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

const FORMAT = "YYYY-MM-DD HH:mm:ss";
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const ALL_DAY = EVERY_DAY.map((dayOfWeek) => ({ dayOfWeek, opensAt: "00:00", closesAt: "24:00" }));

describe("payment sandbox (CR-033)", () => {
  let ctx;
  let admin;
  let moment;
  let storeDir;
  const home = {};

  const call = (method, url, body) => ctx.api(method, url, { token: admin.token, body });
  const pub = (method, url, body) => ctx.api(method, url, { body });

  const slot = (hoursFromNow) => {
    const s = moment()
      .tz("Asia/Manila")
      .startOf("hour")
      .add(hoursFromNow, "hours")
      .format(FORMAT);
    return { date: s.slice(0, 10), startTime: s.slice(11, 16) };
  };
  const bookingRow = async (bookingCode) =>
    (await ctx.sql.query(`SELECT * FROM bookings WHERE bookingCode = ?`, [bookingCode]))[0][0];
  const paymentsOf = async (bookingId) =>
    (await ctx.sql.query(`SELECT * FROM payments WHERE bookingId = ?`, [bookingId]))[0];

  /** A player books online → { bookingCode, manageToken, checkoutUrl, checkoutId, bookingId } */
  const bookOnline = async (hoursFromNow) => {
    const res = await pub("POST", `/public/book/${home.token}/bookings`, {
      courtKey: home.courtKey,
      ...slot(hoursFromNow),
      durationMinutes: 60,
      playerName: "Bea Santos",
      email: "bea@example.com",
      payMethod: "Online",
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const row = await bookingRow(res.data.bookingCode);
    return { ...res.data, checkoutId: res.data.checkoutUrl.split("/").pop(), bookingId: row.bookingId };
  };

  before(async () => {
    storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "payment-sandbox-"));
    ctx = await startTestApp({
      env: {
        PAYMENT_SANDBOX: "true",
        PAYMENT_SANDBOX_FILE: path.join(storeDir, "store.json"),
        APP_URL: "http://web.test",
        RATE_LIMIT_PUBLIC_BOOK_POINTS: "1000",
        RATE_LIMIT_PUBLIC_PAY_POINTS: "1000",
      },
    });
    admin = await ctx.createStaff("Admin", { access: "write" });
    ({ moment } = await ctx.importFromBack("server/src/utils/dateUtils.js"));

    home.venueId = (await call("POST", "/admin/venues", { name: "Sandbox Courts" })).data.venueId;
    await call("POST", "/admin/courts", { venueId: home.venueId, name: "Court 1" });
    const saved = await call("PUT", `/admin/booking-settings/${home.venueId}`, {
      maxBookingMinutes: 180,
      bookingDaysAhead: 14,
      deskHoldMinutes: 30,
      onlineHoldMinutes: 15,
      cancelCutoffHours: 24,
      checkInEarlyMinutes: 10,
      hours: ALL_DAY,
      rates: [
        { name: "All day", daysOfWeek: EVERY_DAY, startTime: "00:00", endTime: "24:00", pricePerHour: 400 },
      ],
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const link = await call("POST", `/admin/booking-settings/${home.venueId}/link`);
    home.token = link.data.bookingUrl.split("/book/")[1];
    home.courtKey = (await pub("GET", `/public/book/${home.token}`)).data.courts[0].key;
  });
  after(async () => {
    await ctx?.stop();
    fs.rmSync(storeDir, { recursive: true, force: true });
  });

  it("turns online payment on without Xendit keys, and says it's the sandbox", async () => {
    const page = await pub("GET", `/public/book/${home.token}`);
    assert.equal(page.data.payOnline, true);
    assert.equal(page.data.paymentSandbox, true);
  });

  it("books online into a test checkout showing the booking and its price", async () => {
    const booking = await bookOnline(30);
    assert.match(booking.checkoutUrl, /^http:\/\/web\.test\/payment-sandbox\/sandbox_[A-Za-z0-9_-]+$/);
    const row = await bookingRow(booking.bookingCode);
    assert.equal(row.status, "Pending");
    assert.equal(row.checkoutId, booking.checkoutId);

    const view = await pub("GET", `/public/payment-sandbox/${booking.checkoutId}`);
    assert.equal(view.status, 200, JSON.stringify(view.body));
    assert.equal(view.data.checkout.amount, 400);
    assert.equal(view.data.checkout.currency, "PHP");
    assert.equal(view.data.checkout.status, "PENDING");
    assert.equal(
      view.data.checkout.returnUrl,
      `http://web.test/booking/${booking.manageToken}?checkout=done`
    );
    // No business ID on the checkout
    assert.ok(!JSON.stringify(view.body).includes(booking.bookingId));

    const manage = await pub("GET", `/public/bookings/${booking.manageToken}`);
    assert.equal(manage.data.booking.paymentSandbox, true);
    assert.equal(manage.data.booking.checkoutOpen, true);
  });

  it("Pay marks it paid; the booking turns Paid when its page is opened, once", async () => {
    const booking = await bookOnline(32);
    const paid = await pub("POST", `/public/payment-sandbox/${booking.checkoutId}/pay`);
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    assert.equal(paid.data.returnUrl, `http://web.test/booking/${booking.manageToken}?checkout=done`);
    // Paying twice is harmless
    assert.equal((await pub("POST", `/public/payment-sandbox/${booking.checkoutId}/pay`)).status, 200);

    const page = await pub("GET", `/public/bookings/${booking.manageToken}`);
    assert.equal(page.data.booking.status, "Confirmed");
    assert.equal(page.data.booking.paymentStatus, "Paid");
    const payments = await paymentsOf(booking.bookingId);
    assert.equal(payments.length, 1);
    assert.equal(payments[0].providerRef, booking.checkoutId);
    assert.equal(Number(payments[0].amount), 400);
  });

  it("going back without paying keeps the checkout; Pay again reopens the same one", async () => {
    const booking = await bookOnline(34);
    const again = await pub("POST", `/public/bookings/${booking.manageToken}/pay`);
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.data.checkoutUrl, booking.checkoutUrl);
    assert.equal((await bookingRow(booking.bookingCode)).paymentStatus, "Unpaid");
  });

  it("cancelling an unpaid booking closes its checkout: it can't be paid any more", async () => {
    const booking = await bookOnline(36);
    const res = await pub("POST", `/public/bookings/${booking.manageToken}/cancel`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const view = await pub("GET", `/public/payment-sandbox/${booking.checkoutId}`);
    assert.equal(view.data.checkout.status, "EXPIRED");
    assert.equal((await pub("POST", `/public/payment-sandbox/${booking.checkoutId}/pay`)).status, 409);
  });

  it("staff cancel of a paid test booking refunds it at once", async () => {
    const booking = await bookOnline(38);
    await pub("POST", `/public/payment-sandbox/${booking.checkoutId}/pay`);
    await pub("GET", `/public/bookings/${booking.manageToken}`);
    const res = await call("POST", `/admin/bookings/${booking.bookingId}/cancel`, {
      reason: "Player asked",
      refund: true,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.data.refundedOnline, 400);
    assert.equal(res.data.refundFailed, 0);
    const row = await bookingRow(booking.bookingCode);
    assert.equal(row.paymentStatus, "Refunded");
    const [payment] = await paymentsOf(booking.bookingId);
    assert.equal(payment.status, "Refunded");
    assert.match(payment.providerRefundRef, /^sandbox_/);
  });

  it("an unknown or malformed checkout is refused", async () => {
    assert.equal((await pub("GET", "/public/payment-sandbox/sandbox_AAAAAAAAAAAAAAAAAAAAAA")).status, 404);
    assert.equal(
      (await pub("POST", "/public/payment-sandbox/sandbox_AAAAAAAAAAAAAAAAAAAAAA/pay")).status,
      404
    );
    assert.equal((await pub("GET", "/public/payment-sandbox/inv_123")).status, 400);
  });

  it("off: the checkout answers 404 and online payment is off without Xendit keys", async () => {
    const booking = await bookOnline(40);
    process.env.PAYMENT_SANDBOX = "false";
    try {
      assert.equal((await pub("GET", `/public/payment-sandbox/${booking.checkoutId}`)).status, 404);
      assert.equal((await pub("POST", `/public/payment-sandbox/${booking.checkoutId}/pay`)).status, 404);
      const page = await pub("GET", `/public/book/${home.token}`);
      assert.equal(page.data.payOnline, false);
      assert.equal(page.data.paymentSandbox, false);
    } finally {
      process.env.PAYMENT_SANDBOX = "true";
    }
  });

  it("is never on in production", async () => {
    const { isPaymentSandbox, isOnlinePaymentOn } = await ctx.importFromBack(
      "server/src/lib/payments/xendit.js"
    );
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      assert.equal(isPaymentSandbox(), false);
      assert.equal(isOnlinePaymentOn(), false);
    } finally {
      process.env.NODE_ENV = saved;
    }
    assert.equal(isPaymentSandbox(), true);
  });
});
