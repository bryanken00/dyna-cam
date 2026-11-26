// CR-047 / PLAN-007 — a player taps hours on one or more courts and pays once:
// neighbouring hours on a court join into one booking, several make an order
// paid in one checkout, and each booking can still be cancelled (and refunded)
// on its own. The hour that's running can be booked in its first half.

import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

const FORMAT = "YYYY-MM-DD HH:mm:ss";
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const ALL_DAY = EVERY_DAY.map((dayOfWeek) => ({ dayOfWeek, opensAt: "00:00", closesAt: "24:00" }));
const SENDGRID_KEY = "SG.test-key";

const fakeSendgrid = () => {
  const state = { messages: [] };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      state.messages.push(JSON.parse(Buffer.concat(chunks).toString()));
      res.writeHead(202, { "X-Message-Id": `msg-${state.messages.length}` }).end();
    });
  });
  return { server, state };
};

describe("booking orders (CR-047)", () => {
  let ctx;
  let admin;
  let moment;
  let sendgrid;
  let settleInvoice;
  const home = {};
  let playerNo = 0;

  const call = (method, url, body) => ctx.api(method, url, { token: admin.token, body });
  const day = (daysAhead) => moment().tz("Asia/Manila").add(daysAhead, "days").format("YYYY-MM-DD");
  const nowLocal = () => moment().tz("Asia/Manila");

  /** A signed-in player of their own → their token. */
  const newPlayer = async () => {
    playerNo += 1;
    const p = await ctx.signInPlayer({ email: `orders${playerNo}@example.test`, name: `Order Player${playerNo}` });
    return p;
  };

  const book = (player, body) =>
    ctx.api("POST", `/public/book/${home.token}/bookings`, { player: player.token, body });

  const rows = async (bookingCodes) =>
    (
      await ctx.sql.query(
        `SELECT bookingId, bookingCode, courtId, startAt, endAt, price, status, paymentStatus, orderId,
                checkoutId, holdExpiresAt, manageToken
         FROM bookings WHERE bookingCode IN (?) ORDER BY startAt, courtId`,
        [bookingCodes]
      )
    )[0];

  /** Pay an order's (or a booking's) checkout in the test checkout, then settle it. */
  const payCheckout = async (checkoutUrl) => {
    const checkoutId = checkoutUrl.split("/").pop();
    const paid = await ctx.api("POST", `/public/payment-sandbox/${checkoutId}/pay`);
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    return settleInvoice(ctx.db, checkoutId);
  };

  before(async () => {
    sendgrid = fakeSendgrid();
    await new Promise((resolve) => sendgrid.server.listen(0, "127.0.0.1", resolve));
    ctx = await startTestApp({
      env: {
        SENDGRID_API_KEY: SENDGRID_KEY,
        SENDGRID_API_URL: `http://127.0.0.1:${sendgrid.server.address().port}`,
        APP_URL: "http://web.test",
        RATE_LIMIT_PUBLIC_BOOK_POINTS: "1000",
        RATE_LIMIT_PUBLIC_CHECKIN_POINTS: "1000",
      },
    });
    admin = await ctx.createStaff("Admin", { access: "write" });
    ({ moment } = await ctx.importFromBack("server/src/utils/dateUtils.js"));
    ({ settleInvoice } = await ctx.importFromBack("server/src/utils/bookingPayments.js"));

    home.venueId = (await call("POST", "/admin/venues", { name: "Order Courts" })).data.venueId;
    for (const name of ["Court A", "Court B"]) {
      const court = await call("POST", "/admin/courts", {
        venueId: home.venueId,
        name,
        cameraRtspUrl: `rtsp://u:p@10.0.7.${name.endsWith("A") ? 1 : 2}:554/stream1`,
      });
      assert.equal(court.status, 201, JSON.stringify(court.body));
    }
    const saved = await call("PUT", `/admin/booking-settings/${home.venueId}`, {
      maxBookingMinutes: 180,
      bookingDaysAhead: 14,
      deskHoldMinutes: 30,
      onlineHoldMinutes: 15,
      cancelCutoffHours: 24,
      checkInEarlyMinutes: 10,
      hours: ALL_DAY,
      rates: [{ name: "All day", daysOfWeek: EVERY_DAY, startTime: "00:00", endTime: "24:00", pricePerHour: 300 }],
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const link = await call("POST", `/admin/booking-settings/${home.venueId}/link`);
    home.token = link.data.bookingUrl.split("/book/")[1];
    const page = await ctx.api("GET", `/public/book/${home.token}`);
    home.courts = Object.fromEntries(page.data.courts.map((c) => [c.name, c.key]));
    // Checking in needs the venue's recorder box online
    const box = (await ctx.pairBox(admin.token, home.venueId, "Box Orders")).data.token;
    await ctx.api("POST", "/device/heartbeat", { body: { cameras: [] }, headers: { Authorization: `Device ${box}` } });
  });
  after(async () => {
    await ctx?.stop();
    await new Promise((resolve) => sendgrid?.server.close(resolve));
  });

  it("joins neighbouring hours on a court, splits a gap, and makes one checkout for all", async () => {
    const player = await newPlayer();
    const date = day(3);
    const res = await book(player, {
      date,
      slots: [
        { courtKey: home.courts["Court A"], startTime: "11:00" },
        { courtKey: home.courts["Court A"], startTime: "10:00" },
        { courtKey: home.courts["Court A"], startTime: "14:00" },
        { courtKey: home.courts["Court B"], startTime: "10:00" },
      ],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.data.bookings.length, 3);
    assert.equal(res.data.total, 1200);
    assert.ok(res.data.checkoutUrl);

    const made = await rows(res.data.bookings.map((b) => b.bookingCode));
    const shape = made.map((b) => `${b.startAt.slice(11, 16)}-${b.endAt.slice(11, 16)}`).sort();
    assert.deepEqual(shape, ["10:00-11:00", "10:00-12:00", "14:00-15:00"]);
    // One order, one checkout, one hold
    assert.equal(new Set(made.map((b) => b.orderId)).size, 1);
    assert.ok(made[0].orderId);
    assert.equal(new Set(made.map((b) => b.checkoutId)).size, 1);
    assert.equal(new Set(made.map((b) => b.holdExpiresAt)).size, 1);
    const checkout = await ctx.api("GET", `/public/payment-sandbox/${res.data.checkoutUrl.split("/").pop()}`);
    assert.equal(checkout.data.checkout.amount, 1200);
  });

  it("paying the order confirms every booking, one payment each, with one combined email", async () => {
    const player = await newPlayer();
    const before = sendgrid.state.messages.length;
    const res = await book(player, {
      date: day(4),
      slots: [
        { courtKey: home.courts["Court A"], startTime: "18:00" },
        { courtKey: home.courts["Court B"], startTime: "18:00" },
      ],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const settled = await payCheckout(res.data.checkoutUrl);
    assert.equal(settled.outcome, "CONFIRMED");

    const made = await rows(res.data.bookings.map((b) => b.bookingCode));
    assert.deepEqual(made.map((b) => [b.status, b.paymentStatus]), [["Confirmed", "Paid"], ["Confirmed", "Paid"]]);
    const [payments] = await ctx.sql.query(
      `SELECT bookingId, amount, providerRef, status FROM payments WHERE bookingId IN (?)`,
      [made.map((b) => b.bookingId)]
    );
    assert.equal(payments.length, 2);
    assert.deepEqual(payments.map((p) => Number(p.amount)), [300, 300]);
    assert.equal(new Set(payments.map((p) => p.providerRef)).size, 1, "one invoice paid both");

    const mails = sendgrid.state.messages.slice(before);
    assert.equal(mails.length, 1, "one combined confirmation");
    assert.match(mails[0].subject, /^Booked: 2 games at Order Courts/);
    const html = mails[0].content.find((c) => c.type === "text/html").value;
    assert.ok(html.includes("Court A") && html.includes("Court B"));
    // Admin: each shows the other as paid together
    const detail = await call("GET", `/admin/bookings/${made[0].bookingId}`);
    assert.equal(detail.data.booking.paidTogether.length, 1);
    assert.equal(detail.data.booking.paidTogether[0].bookingId, made[1].bookingId);
    // Settling again records nothing twice
    assert.equal((await settleInvoice(ctx.db, res.data.checkoutUrl.split("/").pop())).outcome, "ALREADY_RECORDED");
  });

  it("cancelling one booking of a paid order refunds only its share; the others stay", async () => {
    const player = await newPlayer();
    const res = await book(player, {
      date: day(5),
      slots: [
        { courtKey: home.courts["Court A"], startTime: "08:00" },
        { courtKey: home.courts["Court A"], startTime: "09:00" },
        { courtKey: home.courts["Court B"], startTime: "08:00" },
      ],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    await payCheckout(res.data.checkoutUrl);
    const made = await rows(res.data.bookings.map((b) => b.bookingCode));
    const courtB = made.find((b) => b.endAt.slice(11, 16) === "09:00");
    const cancel = await ctx.api("POST", `/public/bookings/${courtB.manageToken}/cancel`);
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
    assert.equal(cancel.data.refunded, 300);

    const after = await rows(made.map((b) => b.bookingCode));
    const kept = after.find((b) => b.bookingId !== courtB.bookingId);
    assert.equal(after.find((b) => b.bookingId === courtB.bookingId).status, "Cancelled");
    assert.equal(kept.status, "Confirmed");
    assert.equal(kept.paymentStatus, "Paid");
    assert.equal(Number(kept.price), 600);
    const [[payment]] = await ctx.sql.query(`SELECT status FROM payments WHERE bookingId = ?`, [kept.bookingId]);
    assert.equal(payment.status, "Paid");
  });

  it("refuses the whole pick when one hour is taken, naming it — nothing is held", async () => {
    const first = await newPlayer();
    const date = day(6);
    assert.equal(
      (await book(first, { date, slots: [{ courtKey: home.courts["Court B"], startTime: "10:00" }] })).status,
      201
    );
    const second = await newPlayer();
    const res = await book(second, {
      date,
      slots: [
        { courtKey: home.courts["Court A"], startTime: "16:00" },
        { courtKey: home.courts["Court B"], startTime: "10:00" },
      ],
    });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.match(res.body.message, /^Court B at 10 AM:/);
    const [[count]] = await ctx.sql.query(
      `SELECT COUNT(*) AS n FROM bookings WHERE venueId = ? AND startAt = ?`,
      [home.venueId, `${date} 16:00:00`]
    );
    assert.equal(count.n, 0);
  });

  it("no longest booking: four neighbouring hours are one game", async () => {
    const player = await newPlayer();
    const res = await book(player, {
      date: day(7),
      slots: ["08:00", "09:00", "10:00", "11:00"].map((startTime) => ({
        courtKey: home.courts["Court A"],
        startTime,
      })),
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.data.bookings.length, 1);
    assert.equal(Number(res.data.total), 1200);
    const [[row]] = await ctx.sql.query(
      `SELECT startAt, endAt FROM bookings WHERE manageToken = ?`,
      [res.data.manageToken]
    );
    assert.equal(moment(row.endAt).diff(moment(row.startAt), "minutes"), 240);
  });

  it("an unpaid order: cancelling one closes the checkout; Pay opens a new one for the rest", async () => {
    const player = await newPlayer();
    const res = await book(player, {
      date: day(8),
      slots: [
        { courtKey: home.courts["Court A"], startTime: "12:00" },
        { courtKey: home.courts["Court B"], startTime: "12:00" },
      ],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const made = await rows(res.data.bookings.map((b) => b.bookingCode));
    const [gone, rest] = made;
    assert.equal((await ctx.api("POST", `/public/bookings/${gone.manageToken}/cancel`)).status, 200);
    const pay = await ctx.api("POST", `/public/bookings/${rest.manageToken}/pay`);
    assert.equal(pay.status, 200, JSON.stringify(pay.body));
    assert.notEqual(pay.data.checkoutUrl, res.data.checkoutUrl);
    const checkout = await ctx.api("GET", `/public/payment-sandbox/${pay.data.checkoutUrl.split("/").pop()}`);
    assert.equal(checkout.data.checkout.amount, 300);
    assert.equal((await payCheckout(pay.data.checkoutUrl)).outcome, "CONFIRMED");
    assert.equal((await rows([rest.bookingCode]))[0].status, "Confirmed");
  });

  it("the running hour: bookable in its first half, full price, ends on the hour", async () => {
    const { runningHourBookable } = await ctx.importFromBack("server/src/utils/bookings.js");
    assert.equal(runningHourBookable("2026-12-01 10:00:00", "2026-12-01 10:24:00"), true);
    assert.equal(runningHourBookable("2026-12-01 10:00:00", "2026-12-01 10:30:00"), false);
    assert.equal(runningHourBookable("2026-12-01 10:00:00", "2026-12-01 09:59:00"), false);

    const now = nowLocal();
    const date = now.format("YYYY-MM-DD");
    const hour = now.clone().startOf("hour");
    const startTime = hour.format("HH:mm");
    const firstHalf = now.minute() < 30;

    const avail = await ctx.api(
      "GET",
      `/public/book/${home.token}/availability?date=${date}&durationMinutes=60`
    );
    assert.equal(avail.status, 200, JSON.stringify(avail.body));
    const slot = avail.data.courts
      .find((c) => c.key === home.courts["Court A"])
      .slots.find((s) => s.startTime === startTime);
    assert.equal(Boolean(slot?.available), firstHalf);
    if (firstHalf) assert.equal(slot.now, true);

    const player = await newPlayer();
    const res = await book(player, { date, slots: [{ courtKey: home.courts["Court A"], startTime }] });
    if (!firstHalf) {
      assert.equal(res.status, 400);
      assert.match(res.body.message, /more than half over/);
      return;
    }
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const [b] = await rows([res.data.bookingCode]);
    assert.equal(b.startAt, hour.format(FORMAT));
    assert.equal(b.endAt, hour.clone().add(1, "hour").format(FORMAT));
    assert.equal(Number(b.price), 300);
    assert.ok(b.holdExpiresAt <= b.endAt, "the hold never runs past its end");
    await payCheckout(res.data.checkoutUrl);
    const checkIn = await ctx.api("POST", `/public/bookings/${b.manageToken}/check-in`);
    assert.equal(checkIn.status, 201, JSON.stringify(checkIn.body));
  });
});
