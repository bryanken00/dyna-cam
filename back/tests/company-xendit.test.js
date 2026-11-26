// PLAN-008 phase C — each company takes online payments into its own Xendit
// account: keys saved (write-only, encrypted) in Admin → Online payment, every
// invoice / refund made with the venue's company's key, and a webhook per company
// that can only settle that company's bookings.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { fakeXendit } from "./helpers/fakeXendit.js";
import { startTestApp } from "./helpers/testApp.js";

const FORMAT = "YYYY-MM-DD HH:mm:ss";
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const ALL_DAY = EVERY_DAY.map((dayOfWeek) => ({ dayOfWeek, opensAt: "00:00", closesAt: "24:00" }));
const KEYS = {
  a: { secretKey: "xnd_development_company_a_secret_0001", callbackToken: "company-a-callback-token" },
  b: { secretKey: "xnd_development_company_b_secret_0002", callbackToken: "company-b-callback-token" },
};

describe("each company's own Xendit (PLAN-008 phase C)", () => {
  let ctx;
  let moment;
  let xendit;
  const co = {};
  let playerNo = 0;

  const as = (company) => (method, url, body) => ctx.api(method, url, { token: company.owner.token, body });
  const at = (hoursFromNow) =>
    moment().tz("Asia/Manila").startOf("hour").add(hoursFromNow, "hours").format(FORMAT);
  const webhookKeyOf = (url) => url.split("/webhooks/xendit/")[1];
  const webhook = (key, token, body) =>
    ctx.api("POST", `/webhooks/xendit/${key}`, { body, headers: { "x-callback-token": token } });
  const bookingRow = async (bookingCode) =>
    (await ctx.sql.query(`SELECT * FROM bookings WHERE bookingCode = ?`, [bookingCode]))[0][0];

  /** A company with a venue, a court and online booking on → { …company, venueId, token, courtKey } */
  const setUp = async (name) => {
    const company = await ctx.createCompany(name);
    const call = as(company);
    company.venueId = (await call("POST", "/admin/venues", { name: `${name} Courts` })).data.venueId;
    await call("POST", "/admin/courts", { venueId: company.venueId, name: "Court 1" });
    const saved = await call("PUT", `/admin/booking-settings/${company.venueId}`, {
      deskHoldMinutes: 30,
      onlineHoldMinutes: 15,
      cancelCutoffHours: 24,
      checkInEarlyMinutes: 10,
      hours: ALL_DAY,
      rates: [{ name: "All day", daysOfWeek: EVERY_DAY, startTime: "00:00", endTime: "24:00", pricePerHour: 400 }],
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const link = await call("POST", `/admin/booking-settings/${company.venueId}/link`);
    company.token = link.data.bookingUrl.split("/book/")[1];
    const page = await ctx.api("GET", `/public/book/${company.token}`);
    company.courtKey = page.data?.courts?.[0]?.key;
    return company;
  };

  /** A player books 2 days ahead at the company's venue → the reply data + invoiceId. */
  const bookOnline = async (company, hours = 48) => {
    playerNo += 1;
    const player = await ctx.signInPlayer({ email: `xen${playerNo}@example.com`, name: `Xen Player${playerNo}` });
    const s = at(hours);
    const res = await ctx.api("POST", `/public/book/${company.token}/bookings`, {
      player: player.token,
      body: {
        courtKey: company.courtKey,
        date: s.slice(0, 10),
        startTime: s.slice(11, 16),
        durationMinutes: 60,
        payMethod: "Online",
      },
    });
    return { res, invoiceId: res.data?.checkoutUrl?.split("/").pop() };
  };

  before(async () => {
    xendit = fakeXendit({ secrets: [KEYS.a.secretKey, KEYS.b.secretKey] });
    await new Promise((resolve) => xendit.server.listen(0, "127.0.0.1", resolve));
    ctx = await startTestApp({
      env: {
        // No .env keys: only companies' own accounts take payments
        XENDIT_SECRET_KEY: "",
        XENDIT_CALLBACK_TOKEN: "",
        PAYMENT_SANDBOX: "",
        XENDIT_API_URL: `http://127.0.0.1:${xendit.server.address().port}`,
        API_PUBLIC_URL: "https://api.test",
        RATE_LIMIT_PUBLIC_BOOK_POINTS: "1000",
      },
    });
    ({ moment } = await ctx.importFromBack("server/src/utils/dateUtils.js"));
    co.a = await setUp("Alpha Pickle");
    co.b = await setUp("Bravo Pickle");
  });
  after(async () => {
    await ctx?.stop();
    await new Promise((resolve) => xendit?.server.close(resolve));
  });

  it("connects a company's keys (checked with Xendit first) and never returns them", async () => {
    const before = await as(co.a)("GET", "/admin/company-payments");
    assert.equal(before.status, 200);
    assert.equal(before.data.payment.connected, false);
    assert.equal(before.data.payment.source, "none");

    const wrong = await as(co.a)("PUT", "/admin/company-payments", {
      secretKey: "xnd_development_not_a_real_key_000000",
      callbackToken: "whatever-token-123",
    });
    assert.equal(wrong.status, 400);

    for (const key of ["a", "b"]) {
      const saved = await as(co[key])("PUT", "/admin/company-payments", KEYS[key]);
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      assert.equal(saved.data.payment.connected, true);
      assert.equal(saved.data.payment.mode, "test");
      assert.match(saved.data.payment.webhookUrl, /^https:\/\/api\.test\/api\/v1\/webhooks\/xendit\/[\w-]{20,}$/);
      co[key].webhookKey = webhookKeyOf(saved.data.payment.webhookUrl);
      const body = JSON.stringify((await as(co[key])("GET", "/admin/company-payments")).body);
      assert.ok(!body.includes(KEYS[key].secretKey) && !body.includes(KEYS[key].callbackToken));
    }
    // Stored encrypted
    const [[row]] = await ctx.sql.query(`SELECT xenditSecretKeyEnc FROM companies WHERE companyId = ?`, [
      co.a.companyId,
    ]);
    assert.ok(row.xenditSecretKeyEnc && !row.xenditSecretKeyEnc.includes(KEYS.a.secretKey));
    assert.notEqual(co.a.webhookKey, co.b.webhookKey);
    // Not audited in plain text either
    const [[audit]] = await ctx.sql.query(
      `SELECT COUNT(*) AS n FROM audit_trail WHERE metadata LIKE ? OR metadata LIKE ?`,
      [`%${KEYS.a.secretKey}%`, `%${KEYS.a.callbackToken}%`]
    );
    assert.equal(Number(audit.n), 0);
  });

  it("opens each company's checkout in its own Xendit account, and its own webhook settles it", async () => {
    const a = await bookOnline(co.a);
    assert.equal(a.res.status, 201, JSON.stringify(a.res.body));
    assert.equal(xendit.invoices.get(a.invoiceId).account, KEYS.a.secretKey);
    const b = await bookOnline(co.b);
    assert.equal(xendit.invoices.get(b.invoiceId).account, KEYS.b.secretKey);

    xendit.pay(a.invoiceId);
    // Company A's URL with B's token: refused, nothing changes
    const wrongToken = await webhook(co.a.webhookKey, KEYS.b.callbackToken, { id: a.invoiceId, status: "PAID" });
    assert.equal(wrongToken.status, 401);
    // Company B's URL for A's invoice: B's key can't read it — ignored
    const otherAccount = await webhook(co.b.webhookKey, KEYS.b.callbackToken, { id: a.invoiceId, status: "PAID" });
    assert.equal(otherAccount.status, 200);
    assert.notEqual(otherAccount.data.outcome, "CONFIRMED");
    assert.equal((await bookingRow(a.res.data.bookingCode)).status, "Pending");

    const ok = await webhook(co.a.webhookKey, KEYS.a.callbackToken, { id: a.invoiceId, status: "PAID" });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.data.outcome, "CONFIRMED");
    const paid = await bookingRow(a.res.data.bookingCode);
    assert.equal(paid.status, "Confirmed");
    assert.equal(paid.paymentStatus, "Paid");
    co.a.paidBooking = paid;
  });

  it("refuses a company's invoice that names another company's booking", async () => {
    const victim = await bookOnline(co.a, 72);
    // Company B makes (and pays) an invoice in its own Xendit naming A's booking
    xendit.invoices.set("inv_forged", {
      id: "inv_forged",
      external_id: `booking-${victim.res.data.bookingCode}`,
      amount: 400,
      currency: "PHP",
      status: "PAID",
      account: KEYS.b.secretKey,
    });
    const forged = await webhook(co.b.webhookKey, KEYS.b.callbackToken, { id: "inv_forged", status: "PAID" });
    assert.equal(forged.status, 200);
    assert.equal(forged.data.outcome, "WRONG_COMPANY");
    const row = await bookingRow(victim.res.data.bookingCode);
    assert.equal(row.status, "Pending");
    assert.equal(row.paymentStatus, "Unpaid");
    const [[count]] = await ctx.sql.query(`SELECT COUNT(*) AS n FROM payments WHERE providerRef = 'inv_forged'`);
    assert.equal(Number(count.n), 0);
  });

  it("refunds from the account the booking was paid into", async () => {
    const res = await as(co.a)("POST", `/admin/bookings/${co.a.paidBooking.bookingId}/cancel`, {
      reason: "Rain",
      refund: true,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const refunds = [...xendit.refunds.values()];
    assert.equal(refunds.length, 1);
    assert.equal(refunds[0].account, KEYS.a.secretKey);
  });

  it("a company without Xendit can't take online bookings or pay links", async () => {
    const disconnected = await as(co.b)("DELETE", "/admin/company-payments");
    assert.equal(disconnected.status, 200);
    assert.equal(disconnected.data.payment.connected, false);

    const page = await ctx.api("GET", `/public/book/${co.b.token}`);
    assert.equal(page.data.payOnline, false);
    const refused = await bookOnline(co.b, 96);
    assert.equal(refused.res.status, 409, JSON.stringify(refused.res.body));

    const s = at(100);
    const courtId = (await as(co.b)("GET", `/admin/courts?venueId=${co.b.venueId}`)).data.courts[0].courtId;
    const desk = await as(co.b)("POST", "/admin/bookings", {
      courtId,
      date: s.slice(0, 10),
      startTime: s.slice(11, 16),
      durationMinutes: 60,
      playerName: "Desk Player",
      email: "desk@example.com",
      payment: "Hold",
    });
    assert.equal(desk.status, 409);
    // Company A still takes payments
    assert.equal((await ctx.api("GET", `/public/book/${co.a.token}`)).data.payOnline, true);
  });
});
