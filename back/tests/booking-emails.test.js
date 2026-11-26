// PLAN-003 Phase G — the player's booking emails: confirmed, pay at the desk,
// reminder, cancelled / released, moved, game started, a payment refunded —
// each sent once, none without an email address, and Admin's Resend. SendGrid
// is a fake server here, so nothing leaves the machine.

import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

const FORMAT = "YYYY-MM-DD HH:mm:ss";
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const ALL_DAY = EVERY_DAY.map((dayOfWeek) => ({ dayOfWeek, opensAt: "00:00", closesAt: "24:00" }));
const SENDGRID_KEY = "SG.test-key";

/** A fake SendGrid Web API v3: POST /v3/mail/send. */
const fakeSendgrid = () => {
  const state = { messages: [] };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (req.headers.authorization !== `Bearer ${SENDGRID_KEY}`) {
        res.writeHead(401).end();
        return;
      }
      state.messages.push(JSON.parse(Buffer.concat(chunks).toString()));
      res.writeHead(202, { "X-Message-Id": `msg-${state.messages.length}` }).end();
    });
  });
  return { server, state };
};

describe("booking emails (PLAN-003 Phase G)", () => {
  let ctx;
  let admin;
  let moment;
  let sendgrid;
  let runBookingMaintenance;
  let settleInvoice;
  const home = {};
  let courtNo = 0;
  let playerNo = 0;

  const call = (method, url, body) => ctx.api(method, url, { token: admin.token, body });

  const at = (hoursFromNow) =>
    moment().tz("Asia/Manila").startOf("hour").add(hoursFromNow, "hours").format(FORMAT);
  const slot = (hoursFromNow) => {
    const s = at(hoursFromNow);
    return { date: s.slice(0, 10), startTime: s.slice(11, 16) };
  };
  const now = () => moment().tz("Asia/Manila").format(FORMAT);

  /** Every email sent to this address: [{ subject, html, text }] */
  const mailsTo = (email) =>
    sendgrid.state.messages
      .filter((m) => m.personalizations[0].to.some((t) => t.email === email))
      .map((m) => ({
        subject: m.subject,
        text: m.content.find((c) => c.type === "text/plain").value,
        html: m.content.find((c) => c.type === "text/html").value,
      }));

  const bookingRow = async (bookingId) =>
    (await ctx.sql.query(`SELECT * FROM bookings WHERE bookingId = ?`, [bookingId]))[0][0];

  const newCourt = async () => {
    courtNo += 1;
    const res = await call("POST", "/admin/courts", {
      venueId: home.venueId,
      name: `Court ${courtNo}`,
      cameraRtspUrl: `rtsp://u:p@10.0.5.${courtNo}:554/stream1`,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.data.courtId;
  };

  /** A desk booking for a fresh player email → { bookingId, bookingCode, email, courtId } */
  const book = async (hoursFromNow, body = {}) => {
    playerNo += 1;
    const email = body.email === undefined ? `player${playerNo}@example.test` : body.email;
    const courtId = body.courtId || (await newCourt());
    const res = await call("POST", "/admin/bookings", {
      courtId,
      ...slot(hoursFromNow),
      durationMinutes: 60,
      playerName: "Bea Santos",
      // CR-046: no cash — a pay link, paid online below (unless a test picks how it's paid)
      payment: "Hold",
      ...body,
      email,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    if (!body.payment) {
      await ctx.payBooking(res.data.bookingId);
      // Paid straight away: drop its pay-link email, so a test counts what follows
      sendgrid.state.messages = sendgrid.state.messages.filter(
        (m) =>
          !(m.subject.startsWith("Pay by") && m.personalizations[0].to.some((t) => t.email === email))
      );
    }
    return { ...res.data, email, courtId };
  };

  before(async () => {
    sendgrid = fakeSendgrid();
    await new Promise((resolve) => sendgrid.server.listen(0, "127.0.0.1", resolve));
    ctx = await startTestApp({
      env: {
        SENDGRID_API_KEY: SENDGRID_KEY,
        SENDGRID_API_URL: `http://127.0.0.1:${sendgrid.server.address().port}`,
        APP_URL: "http://web.test",
        BOOKING_REMINDER_MINUTES: "120",
        RATE_LIMIT_PUBLIC_BOOK_POINTS: "1000",
      },
    });
    admin = await ctx.createStaff("Admin", { access: "write" });
    ({ moment } = await ctx.importFromBack("server/src/utils/dateUtils.js"));
    ({ runBookingMaintenance } = await ctx.importFromBack("server/src/jobs/bookingMaintenance.js"));
    ({ settleInvoice } = await ctx.importFromBack("server/src/utils/bookingPayments.js"));

    home.venueId = (await call("POST", "/admin/venues", { name: "Email Courts" })).data.venueId;
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
          pricePerHour: 500,
        },
      ],
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
  });
  after(async () => {
    await ctx?.stop();
    await new Promise((resolve) => sendgrid?.server.close(resolve));
  });

  it("a desk booking paid online sends the confirmation once, with the player's link and how to start recording", async () => {
    const b = await book(30);
    const [mail, ...more] = mailsTo(b.email);
    assert.equal(more.length, 0);
    assert.match(mail.subject, /^Booked: Court \d+ at Email Courts/);
    // CR-045: no booking code, no court QR — the booking's page starts the camera
    assert.ok(!mail.html.includes(b.bookingCode));
    assert.doesNotMatch(mail.text, /booking code|QR sign/i);
    assert.match(mail.text, /I'm at the court — start recording/);
    const row = await bookingRow(b.bookingId);
    assert.ok(mail.html.includes(`http://web.test/booking/${row.manageToken}`));
    assert.match(mail.text, /Paid ₱500 online/);
    assert.ok(row.confirmationSentAt);

    // A booking without an email gets nothing
    const before = sendgrid.state.messages.length;
    await book(31, { email: "" });
    assert.equal(sendgrid.state.messages.length, before);
  });

  it("a desk pay link sends the pay-by email (online, no counter); paying online sends the confirmation", async () => {
    const b = await book(32, { payment: "Hold" });
    const [hold] = mailsTo(b.email);
    assert.match(hold.subject, /^Pay by/);
    assert.match(hold.text, /Pay ₱500 online by/);
    assert.doesNotMatch(hold.text, /front desk/);

    // CR-046: no cash at the counter
    assert.equal((await call("POST", `/admin/bookings/${b.bookingId}/payments`, {})).status, 404);
    await ctx.payBooking(b.bookingId);
    const mails = mailsTo(b.email);
    assert.equal(mails.length, 2);
    assert.match(mails[1].subject, /^Booked:/);
  });

  it("a player's online booking sends nothing until it's paid, then the confirmation", async () => {
    const link = await call("POST", `/admin/booking-settings/${home.venueId}/link`);
    const token = link.data.bookingUrl.split("/book/")[1];
    const courtKey = (await ctx.api("GET", `/public/book/${token}`)).data.courts[0].key;
    const ana = await ctx.signInPlayer({ email: "online.ana@example.test", name: "Online Ana" });
    const res = await ctx.api("POST", `/public/book/${token}/bookings`, {
      player: ana.token,
      body: { courtKey, ...slot(33), durationMinutes: 60 },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(res.data.checkoutUrl, "sent to pay");
    assert.equal(mailsTo("online.ana@example.test").length, 0);
    const row = (await ctx.sql.query(`SELECT bookingId FROM bookings WHERE bookingCode = ?`, [res.data.bookingCode]))[0][0];
    await ctx.payBooking(row.bookingId);
    const [mail] = mailsTo("online.ana@example.test");
    assert.match(mail.subject, /^Booked:/);
    assert.ok(mail.html.includes(res.data.manageUrl));
  });

  it("a verified online payment sends the confirmation once; one it can't keep sends a refund email", async () => {
    const b = await book(34, { payment: "Hold" });
    const invoice = (id) => ({
      id,
      externalId: `booking-${b.bookingCode}`,
      status: "PAID",
      paid: true,
      amount: 500,
    });
    assert.equal(
      (await settleInvoice(ctx.db, "inv_a", { invoice: invoice("inv_a") })).outcome,
      "CONFIRMED"
    );
    assert.equal(
      (await settleInvoice(ctx.db, "inv_a", { invoice: invoice("inv_a") })).outcome,
      "ALREADY_RECORDED"
    );
    let mails = mailsTo(b.email);
    assert.equal(mails.length, 2); // pay-by, then confirmed
    assert.match(mails[1].text, /Paid ₱500 online/);

    // Paid twice: the second payment goes back (Xendit is off here, so the refund fails)
    const second = await settleInvoice(ctx.db, "inv_b", { invoice: invoice("inv_b") });
    assert.equal(second.outcome, "REFUND_FAILED");
    mails = mailsTo(b.email);
    assert.equal(mails.length, 3);
    assert.match(mails[2].subject, /being refunded/);
    assert.match(mails[2].text, /already paid/);
    assert.match(mails[2].text, /couldn't refund ₱500 automatically/);
  });

  it("sends the reminder once, before the start — not to cancelled bookings, not right after confirming", async () => {
    const b = await book(1); // starts within the next 2 hours
    // Confirmed just now — the confirmation already says everything
    await runBookingMaintenance(ctx.db);
    assert.equal(mailsTo(b.email).length, 1);

    // Confirmed days ago → reminded, once
    await ctx.sql.query(`UPDATE bookings SET confirmationSentAt = ? WHERE bookingId = ?`, [
      at(-48),
      b.bookingId,
    ]);
    const first = await runBookingMaintenance(ctx.db);
    assert.ok(first.reminders >= 1);
    const second = await runBookingMaintenance(ctx.db);
    assert.equal(second.reminders, 0);
    const mails = mailsTo(b.email);
    assert.equal(mails.length, 2);
    assert.match(mails[1].subject, /^Reminder:/);
    assert.match(mails[1].text, /starts in (1 hour|\d+ minutes)/);
    assert.ok((await bookingRow(b.bookingId)).reminderSentAt);

    // Cancelled → no reminder
    const gone = await book(1);
    await ctx.sql.query(`UPDATE bookings SET confirmationSentAt = ? WHERE bookingId = ?`, [
      at(-48),
      gone.bookingId,
    ]);
    await call("POST", `/admin/bookings/${gone.bookingId}/cancel`, {
      reason: "Rain",
      refund: true,
    });
    await runBookingMaintenance(ctx.db);
    assert.ok(!mailsTo(gone.email).some((m) => /^Reminder:/.test(m.subject)));

    // Too far ahead → not yet
    const later = await book(20);
    await ctx.sql.query(`UPDATE bookings SET confirmationSentAt = ? WHERE bookingId = ?`, [
      at(-48),
      later.bookingId,
    ]);
    await runBookingMaintenance(ctx.db);
    assert.equal(mailsTo(later.email).length, 1);
  });

  it("staff cancel sends one cancellation saying what happens to the money", async () => {
    const b = await book(36);
    const res = await call("POST", `/admin/bookings/${b.bookingId}/cancel`, {
      reason: "Asked to",
      refund: true,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(
      (await call("POST", `/admin/bookings/${b.bookingId}/cancel`, { reason: "Again" })).status,
      409
    );
    const mails = mailsTo(b.email);
    assert.equal(mails.length, 2);
    assert.match(mails[1].subject, /^Your booking was cancelled/);
    assert.match(mails[1].text, /the venue cancelled your booking/);
    assert.match(mails[1].text, /₱500 is being refunded to the account you paid with/);
    // Staff's own reason stays internal
    assert.ok(!mails[1].text.includes("Asked to"));
    assert.ok((await bookingRow(b.bookingId)).cancelledEmailSentAt);
  });

  it("a closure that cancels bookings emails each player why", async () => {
    const b = await book(38);
    const res = await call("POST", "/admin/closures", {
      venueId: home.venueId,
      courtId: b.courtId,
      startAt: at(37),
      endAt: at(40),
      reason: "Resurfacing",
      cancelConflicts: true,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const mails = mailsTo(b.email);
    assert.equal(mails.length, 2);
    assert.match(mails[1].text, /closed the court then \(Resurfacing\)/);
  });

  it("a hold that ran out sends 'your court was released' once; an old one sends nothing", async () => {
    const b = await book(40, { payment: "Hold" });
    await ctx.sql.query(`UPDATE bookings SET holdExpiresAt = ? WHERE bookingId = ?`, [
      moment().tz("Asia/Manila").subtract(5, "minutes").format(FORMAT),
      b.bookingId,
    ]);
    const first = await runBookingMaintenance(ctx.db);
    assert.ok(first.expired >= 1);
    assert.ok(first.released >= 1);
    await runBookingMaintenance(ctx.db);
    const mails = mailsTo(b.email);
    assert.equal(mails.length, 2);
    assert.match(mails[1].subject, /^Your court was released/);

    const old = await book(41, { payment: "Hold" });
    await ctx.sql.query(`UPDATE bookings SET holdExpiresAt = ? WHERE bookingId = ?`, [
      at(-3),
      old.bookingId,
    ]);
    await runBookingMaintenance(ctx.db);
    assert.equal((await bookingRow(old.bookingId)).status, "Expired");
    assert.equal(mailsTo(old.email).length, 1);
  });

  it("a move emails the new time and the old one", async () => {
    const b = await book(42);
    const res = await call("PUT", `/admin/bookings/${b.bookingId}/move`, {
      courtId: b.courtId,
      ...slot(43),
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const mails = mailsTo(b.email);
    assert.equal(mails.length, 2);
    assert.match(mails[1].subject, /^Booking moved/);
    const oldTime = moment.tz(at(42), FORMAT, "Asia/Manila").format("h:mm A");
    assert.ok(mails[1].text.includes(`It was Court`));
    assert.ok(mails[1].text.includes(oldTime));
  });

  it("check-in emails the game page once", async () => {
    const b = await book(0);
    const first = await call("POST", `/admin/bookings/${b.bookingId}/check-in`);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal((await call("POST", `/admin/bookings/${b.bookingId}/check-in`)).status, 200);
    const mails = mailsTo(b.email);
    assert.equal(mails.length, 2);
    assert.match(mails[1].subject, /is recording$/);
    assert.ok(mails[1].html.includes(first.data.shareUrl));
  });

  it("Resend sends the email that fits the booking now", async () => {
    const confirmed = await book(44);
    const res = await call("POST", `/admin/bookings/${confirmed.bookingId}/resend`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.data.kind, "Confirmed");
    assert.equal(mailsTo(confirmed.email).length, 2);

    const held = await book(45, { payment: "Hold" });
    assert.equal(
      (await call("POST", `/admin/bookings/${held.bookingId}/resend`)).data.kind,
      "PayAtDesk"
    );

    const noEmail = await book(46, { email: "" });
    assert.equal((await call("POST", `/admin/bookings/${noEmail.bookingId}/resend`)).status, 409);

    const cancelled = await book(47);
    await call("POST", `/admin/bookings/${cancelled.bookingId}/cancel`, { reason: "x" });
    assert.equal((await call("POST", `/admin/bookings/${cancelled.bookingId}/resend`)).status, 409);

    // Deleted → 404 and unchanged
    const deleted = await book(48, { payment: "Hold" });
    assert.equal((await call("DELETE", `/admin/bookings/${deleted.bookingId}`)).status, 200);
    const sentBefore = mailsTo(deleted.email).length;
    assert.equal((await call("POST", `/admin/bookings/${deleted.bookingId}/resend`)).status, 404);
    assert.equal(mailsTo(deleted.email).length, sentBefore);
    assert.equal((await bookingRow(deleted.bookingId)).status, "Deleted");

    // Without SendGrid: nothing sent, and Admin is told
    const saved = process.env.SENDGRID_API_KEY;
    process.env.SENDGRID_API_KEY = "";
    try {
      const count = sendgrid.state.messages.length;
      const unsent = await book(49);
      assert.equal(sendgrid.state.messages.length, count);
      assert.equal((await bookingRow(unsent.bookingId)).confirmationSentAt, null);
      assert.equal((await call("POST", `/admin/bookings/${unsent.bookingId}/resend`)).status, 503);
      const job = await runBookingMaintenance(ctx.db);
      assert.equal(job.reminders, 0);
    } finally {
      process.env.SENDGRID_API_KEY = saved;
    }
  });

  it("the reminder job never mails a booking twice when two processes run it at once", async () => {
    const b = await book(1);
    await ctx.sql.query(`UPDATE bookings SET confirmationSentAt = ? WHERE bookingId = ?`, [
      at(-48),
      b.bookingId,
    ]);
    await Promise.all([
      runBookingMaintenance(ctx.db),
      runBookingMaintenance(ctx.db, { now: now() }),
    ]);
    assert.equal(mailsTo(b.email).filter((m) => /^Reminder:/.test(m.subject)).length, 1);
  });
});
