// CR-041 — a booked game ended early can record the rest of the booked time:
// Resume on the game's page, the booking code at the court QR again, or staff's
// Check in. Each resume is a new game (its own video) on the same booking.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

const FORMAT = "YYYY-MM-DD HH:mm:ss";
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const ALL_DAY = EVERY_DAY.map((dayOfWeek) => ({ dayOfWeek, opensAt: "00:00", closesAt: "24:00" }));

describe("resume a booked game ended early (CR-041)", () => {
  let ctx;
  let admin;
  let moment;
  let venueId;
  let courtNo = 0;

  const call = (method, url, body) => ctx.api(method, url, { token: admin.token, body });
  const pub = (method, url, body) => ctx.api(method, url, { body });

  const at = (hoursFromNow) =>
    moment().tz("Asia/Manila").startOf("hour").add(hoursFromNow, "hours").format(FORMAT);

  const newCourt = async () => {
    courtNo += 1;
    const res = await call("POST", "/admin/courts", {
      venueId,
      name: `Court ${courtNo}`,
      cameraRtspUrl: `rtsp://u:p@10.0.5.${courtNo}:554/stream1`,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return { courtId: res.data.courtId, qrToken: res.data.qrToken };
  };

  /** A paid desk booking from the start of this hour, two hours long. */
  const book = async (courtId) => {
    const s = at(0);
    const res = await call("POST", "/admin/bookings", {
      courtId,
      date: s.slice(0, 10),
      startTime: s.slice(11, 16),
      durationMinutes: 120,
      playerName: "Carlo Cruz",
      email: "carlo@example.com",
      payment: "Cash",
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const detail = await call("GET", `/admin/bookings/${res.data.bookingId}`);
    const manageToken = detail.data.booking.manageUrl.split("/booking/")[1];
    return { bookingId: res.data.bookingId, bookingCode: res.data.bookingCode, manageToken };
  };

  const bookingRow = async (bookingId) =>
    (await ctx.sql.query(`SELECT status, sessionId FROM bookings WHERE bookingId = ?`, [bookingId]))[0][0];

  const gameRow = async (sessionId) =>
    (
      await ctx.sql.query(
        `SELECT status, startAt, endAt, paymentStatus, maxCaptures, bookingId, shareToken
         FROM recording_sessions WHERE sessionId = ?`,
        [sessionId]
      )
    )[0][0];

  const gamesOf = async (bookingId) =>
    (await ctx.sql.query(`SELECT sessionId FROM recording_sessions WHERE bookingId = ?`, [bookingId]))[0];

  /** Check in from the booking's page and press End game → the ended game's share token. */
  const playAndEnd = async (b) => {
    const res = await pub("POST", `/public/bookings/${b.manageToken}/check-in`);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    // It has been recording a few minutes (a game always lasts at least 1 s)
    const started = moment().tz("Asia/Manila").subtract(5, "minutes").format(FORMAT);
    await ctx.sql.query(`UPDATE recording_sessions SET startAt = ? WHERE shareToken = ?`, [
      started,
      res.data.shareToken,
    ]);
    const ended = await pub("POST", `/public/sessions/${res.data.shareToken}/end`);
    assert.equal(ended.status, 200, JSON.stringify(ended.body));
    return res.data.shareToken;
  };

  before(async () => {
    ctx = await startTestApp({
      env: {
        RATE_LIMIT_PUBLIC_CHECKIN_POINTS: "1000",
        RATE_LIMIT_COURT_CHECKIN_POINTS: "1000",
        RATE_LIMIT_PUBLIC_CONTROL_POINTS: "1000",
      },
    });
    admin = await ctx.createStaff("Admin", { access: "write" });
    ({ moment } = await ctx.importFromBack("server/src/utils/dateUtils.js"));
    venueId = (await call("POST", "/admin/venues", { name: "Resume Courts" })).data.venueId;
    const saved = await call("PUT", `/admin/booking-settings/${venueId}`, {
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
    const box = (await ctx.pairBox(admin.token, venueId, "Box Resume")).data.token;
    const beat = await ctx.api("POST", "/device/heartbeat", {
      body: { cameras: [] },
      headers: { Authorization: `Device ${box}` },
    });
    assert.equal(beat.status, 200, JSON.stringify(beat.body));
  });
  after(() => ctx?.stop());

  it("a recording game offers no resume, and Resume on it is refused", async () => {
    const { courtId } = await newCourt();
    const b = await book(courtId);
    const res = await pub("POST", `/public/bookings/${b.manageToken}/check-in`);
    assert.equal(res.status, 201);

    const page = await pub("GET", `/public/sessions/${res.data.shareToken}`);
    assert.equal(page.data.session.resume, null);

    const resume = await pub("POST", `/public/sessions/${res.data.shareToken}/resume`);
    assert.equal(resume.status, 409);
    assert.equal(resume.body.message, "The game is still recording");
    assert.equal((await gamesOf(b.bookingId)).length, 1);
  });

  it("Resume on the ended game's page starts a new game until the booked end", async () => {
    const { courtId } = await newCourt();
    const b = await book(courtId);
    const first = await playAndEnd(b);
    const firstId = (await bookingRow(b.bookingId)).sessionId;

    const page = await pub("GET", `/public/sessions/${first}`);
    assert.equal(page.status, 200);
    assert.deepEqual(page.data.session.resume, {
      canResume: true,
      until: at(2),
      continuedShareUrl: null,
    });

    const resume = await pub("POST", `/public/sessions/${first}/resume`);
    assert.equal(resume.status, 201, JSON.stringify(resume.body));
    assert.equal(resume.body.message, "Recording resumed");
    assert.notEqual(resume.data.shareToken, first);
    assert.match(resume.data.shareUrl, /\/session\/[\w-]{16,}$/);

    const r = await bookingRow(b.bookingId);
    assert.equal(r.status, "CheckedIn");
    assert.notEqual(r.sessionId, firstId);
    const game = await gameRow(r.sessionId);
    const old = await gameRow(firstId);
    assert.ok(["Recording", "Scheduled"].includes(game.status), game.status);
    assert.equal(game.endAt, at(2));
    assert.ok(game.startAt >= old.endAt, `${game.startAt} < ${old.endAt}`);
    assert.equal(game.bookingId, b.bookingId);
    assert.equal(game.paymentStatus, "Free");
    assert.equal(Number(game.maxCaptures), 5);
    assert.equal(game.shareToken, resume.data.shareToken);
    // The first game is untouched
    assert.notEqual(old.status, "Cancelled");

    // A double tap (or another phone) lands on the same new game
    const again = await pub("POST", `/public/sessions/${first}/resume`);
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.data.shareToken, resume.data.shareToken);
    assert.equal((await gamesOf(b.bookingId)).length, 2);

    // The first page points at the new game; the new one offers nothing while it records
    const before = await pub("GET", `/public/sessions/${first}`);
    assert.equal(before.data.session.resume.canResume, false);
    assert.equal(before.data.session.resume.continuedShareUrl, resume.data.shareUrl);
    const now = await pub("GET", `/public/sessions/${resume.data.shareToken}`);
    assert.equal(now.data.session.resume, null);
  });

  it("the booking code at the court QR resumes a booking marked Completed", async () => {
    const { courtId, qrToken } = await newCourt();
    const b = await book(courtId);
    await playAndEnd(b);
    // What the booking maintenance job does a minute later
    await ctx.sql.query(`UPDATE bookings SET status = 'Completed' WHERE bookingId = ?`, [b.bookingId]);

    const res = await pub("POST", `/public/courts/${qrToken}/check-in`, { bookingCode: b.bookingCode });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.message, "Recording resumed — the camera is recording");
    assert.equal((await bookingRow(b.bookingId)).status, "CheckedIn");
    assert.equal((await gamesOf(b.bookingId)).length, 2);
  });

  it("staff's Check in resumes an ended-early booking", async () => {
    const { courtId } = await newCourt();
    const b = await book(courtId);
    await playAndEnd(b);

    const res = await call("POST", `/admin/bookings/${b.bookingId}/check-in`);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.message, "Recording resumed for the rest of the booking");
    assert.equal((await gamesOf(b.bookingId)).length, 2);
  });

  it("nothing to resume once less than a minute of the booking is left", async () => {
    const { courtId, qrToken } = await newCourt();
    const b = await book(courtId);
    const first = await playAndEnd(b);
    const soon = moment().tz("Asia/Manila").add(30, "seconds").format(FORMAT);
    await ctx.sql.query(`UPDATE bookings SET endAt = ? WHERE bookingId = ?`, [soon, b.bookingId]);

    const page = await pub("GET", `/public/sessions/${first}`);
    assert.equal(page.data.session.resume, null);

    const resume = await pub("POST", `/public/sessions/${first}/resume`);
    assert.equal(resume.status, 409);
    assert.equal(resume.body.message, "This booking's time is over");

    const qr = await pub("POST", `/public/courts/${qrToken}/check-in`, { bookingCode: b.bookingCode });
    assert.equal(qr.status, 409);
    assert.equal((await gamesOf(b.bookingId)).length, 1);
  });

  it("a bad or cancelled game's link is a 404 and starts nothing", async () => {
    const missing = await pub("POST", `/public/sessions/${"x".repeat(32)}/resume`);
    assert.equal(missing.status, 404);

    const { courtId } = await newCourt();
    const b = await book(courtId);
    const first = await playAndEnd(b);
    await ctx.sql.query(`UPDATE recording_sessions SET status = 'Cancelled' WHERE shareToken = ?`, [first]);
    const cancelled = await pub("POST", `/public/sessions/${first}/resume`);
    assert.equal(cancelled.status, 404);
    assert.equal((await gamesOf(b.bookingId)).length, 1);
    assert.equal((await bookingRow(b.bookingId)).status, "CheckedIn");
  });
});
