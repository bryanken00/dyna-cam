// PLAN-003 Phase D — checking a booking in starts its recorded game: from the
// booking's own page, from the court's QR with the booking code, or by staff.
// The game runs only for the booked time, is free and allows 5 saves.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

const FORMAT = "YYYY-MM-DD HH:mm:ss";
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const ALL_DAY = EVERY_DAY.map((dayOfWeek) => ({ dayOfWeek, opensAt: "00:00", closesAt: "24:00" }));

describe("booking check-in (PLAN-003 Phase D)", () => {
  let ctx;
  let admin;
  let viewer;
  let moment;
  const home = {};
  let courtNo = 0;

  const call = (method, url, body, who = admin) => ctx.api(method, url, { token: who.token, body });
  const pub = (method, url, body) => ctx.api(method, url, { body });

  const at = (hoursFromNow) =>
    moment().tz("Asia/Manila").startOf("hour").add(hoursFromNow, "hours").format(FORMAT);

  /** A venue with all-day hours and a rate; online = its recorder box reports in. */
  const setupVenue = async (name, { online = true, checkInEarlyMinutes = 10 } = {}) => {
    const venueId = (await call("POST", "/admin/venues", { name })).data.venueId;
    const saved = await call("PUT", `/admin/booking-settings/${venueId}`, {
      maxBookingMinutes: 180,
      bookingDaysAhead: 14,
      deskHoldMinutes: 30,
      onlineHoldMinutes: 15,
      cancelCutoffHours: 24,
      checkInEarlyMinutes,
      hours: ALL_DAY,
      rates: [{ name: "All day", daysOfWeek: EVERY_DAY, startTime: "00:00", endTime: "24:00", pricePerHour: 300 }],
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    if (online) {
      const box = (await ctx.pairBox(admin.token, venueId, `Box ${name}`)).data.token;
      const beat = await ctx.api("POST", "/device/heartbeat", {
        body: { cameras: [] },
        headers: { Authorization: `Device ${box}` },
      });
      assert.equal(beat.status, 200, JSON.stringify(beat.body));
    }
    return venueId;
  };

  const newCourt = async (venueId = home.venueId) => {
    courtNo += 1;
    const res = await call("POST", "/admin/courts", {
      venueId,
      name: `Court ${courtNo}`,
      cameraRtspUrl: `rtsp://u:p@10.0.4.${courtNo}:554/stream1`,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return { courtId: res.data.courtId, qrToken: res.data.qrToken };
  };

  /** A paid desk booking → { bookingId, bookingCode, manageToken } */
  const book = async (courtId, hoursFromNow, body = {}) => {
    const s = at(hoursFromNow);
    const res = await call("POST", "/admin/bookings", {
      courtId,
      date: s.slice(0, 10),
      startTime: s.slice(11, 16),
      durationMinutes: 60,
      playerName: "Carlo Cruz",
      email: "carlo@example.com",
      payment: "Cash",
      ...body,
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
        `SELECT status, startAt, endAt, paymentStatus, maxCaptures, bookingId, openEnded
         FROM recording_sessions WHERE sessionId = ?`,
        [sessionId]
      )
    )[0][0];

  before(async () => {
    ctx = await startTestApp({ env: { RATE_LIMIT_PUBLIC_CHECKIN_POINTS: "1000", RATE_LIMIT_COURT_CHECKIN_POINTS: "1000" } });
    admin = await ctx.createStaff("Admin", { access: "write" });
    viewer = await ctx.createStaff("Viewer", { access: "read" });
    ({ moment } = await ctx.importFromBack("server/src/utils/dateUtils.js"));
    home.venueId = await setupVenue("Check-in Courts");
  });
  after(() => ctx?.stop());

  it("checks in from the booking's page: a free game for the booked time, with 5 saves", async () => {
    const { courtId } = await newCourt();
    const b = await book(courtId, 0);
    const res = await pub("POST", `/public/bookings/${b.manageToken}/check-in`);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.match(res.data.shareUrl, /\/session\/[\w-]{16,}$/);

    const r = await bookingRow(b.bookingId);
    assert.equal(r.status, "CheckedIn");
    const game = await gameRow(r.sessionId);
    assert.equal(game.status, "Recording");
    assert.equal(game.endAt, at(1));
    assert.equal(game.paymentStatus, "Free");
    assert.equal(Number(game.maxCaptures), 5);
    assert.equal(game.bookingId, b.bookingId);
    assert.equal(Number(game.openEnded), 0);

    // Again → the same game
    const again = await pub("POST", `/public/bookings/${b.manageToken}/check-in`);
    assert.equal(again.status, 200);
    assert.equal(again.data.shareToken, res.data.shareToken);

    const page = await pub("GET", `/public/bookings/${b.manageToken}`);
    assert.equal(page.data.booking.status, "CheckedIn");
    assert.equal(page.data.booking.gameShareToken, res.data.shareToken);
    assert.equal(page.data.booking.actions.checkIn, false);

    // Admin → Sessions says where it came from
    const session = await call("GET", `/admin/sessions/${r.sessionId}`);
    assert.equal(session.data.session.startedBy, `Booking ${b.bookingCode}`);
  });

  it("CR-045: nothing starts from the court QR any more; its page still opens for old signs", async () => {
    const { courtId, qrToken } = await newCourt();
    const b = await book(courtId, 0);

    const court = await pub("GET", `/public/courts/${qrToken}`);
    assert.equal(court.status, 200, JSON.stringify(court.body));
    // The page never shows who or which code
    assert.ok(!JSON.stringify(court.body).includes(b.bookingCode));
    assert.ok(!JSON.stringify(court.body).includes("Carlo"));

    // The code check-in is gone: 404, and the booking is untouched
    const res = await pub("POST", `/public/courts/${qrToken}/check-in`, { bookingCode: b.bookingCode });
    assert.equal(res.status, 404);
    assert.equal((await bookingRow(b.bookingId)).status, "Confirmed");

    // The booking's own page still checks it in
    const own = await pub("POST", `/public/bookings/${b.manageToken}/check-in`);
    assert.equal(own.status, 201, JSON.stringify(own.body));
    assert.equal((await bookingRow(b.bookingId)).status, "CheckedIn");
  });

  it("starts an early check-in at the booked time", async () => {
    const venueId = await setupVenue("Early Courts", { checkInEarlyMinutes: 60 });
    const { courtId } = await newCourt(venueId);
    const b = await book(courtId, 1);
    const res = await pub("POST", `/public/bookings/${b.manageToken}/check-in`);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const game = await gameRow((await bookingRow(b.bookingId)).sessionId);
    assert.equal(game.status, "Scheduled");
    assert.equal(game.startAt, at(1));
    assert.equal(game.endAt, at(2));
  });

  it("refuses too early, unpaid, cancelled and over bookings", async () => {
    const { courtId } = await newCourt();
    const later = await book(courtId, 3);
    const early = await pub("POST", `/public/bookings/${later.manageToken}/check-in`);
    assert.equal(early.status, 409);
    assert.match(early.body.message, /opens at/);
    assert.equal((await pub("GET", `/public/bookings/${later.manageToken}`)).data.booking.actions.checkIn, false);

    // Unpaid hold that (somehow) reaches its time
    const held = await book(courtId, 6, { payment: "Hold" });
    await ctx.sql.query(
      `UPDATE bookings SET startAt = ?, endAt = ?, holdExpiresAt = ? WHERE bookingId = ?`,
      [at(0), at(1), at(2), held.bookingId]
    );
    const unpaid = await pub("POST", `/public/bookings/${held.manageToken}/check-in`);
    assert.equal(unpaid.status, 409);
    assert.match(unpaid.body.message, /isn't paid/);

    const cancelled = await book(courtId, 8);
    await call("POST", `/admin/bookings/${cancelled.bookingId}/cancel`, { reason: "x" });
    assert.equal((await pub("POST", `/public/bookings/${cancelled.manageToken}/check-in`)).status, 409);

    const over = await book(courtId, 10);
    await ctx.sql.query(`UPDATE bookings SET startAt = ?, endAt = ? WHERE bookingId = ?`, [
      at(-3),
      at(-2),
      over.bookingId,
    ]);
    const late = await pub("POST", `/public/bookings/${over.manageToken}/check-in`);
    assert.equal(late.status, 409);
  });

  it("won't record a player's check-in while the recorder is offline, but staff can", async () => {
    const venueId = await setupVenue("Offline Courts", { online: false });
    const { courtId } = await newCourt(venueId);
    const b = await book(courtId, 0);
    const offline = await pub("POST", `/public/bookings/${b.manageToken}/check-in`);
    assert.equal(offline.status, 503);
    assert.equal(offline.body.code, "CAMERA_OFFLINE");
    assert.equal((await bookingRow(b.bookingId)).status, "Confirmed");

    assert.equal((await call("POST", `/admin/bookings/${b.bookingId}/check-in`, undefined, viewer)).status, 403);
    const staff = await call("POST", `/admin/bookings/${b.bookingId}/check-in`);
    assert.equal(staff.status, 201, JSON.stringify(staff.body));
    assert.equal((await bookingRow(b.bookingId)).status, "CheckedIn");
  });

  it("treats a deleted booking as missing", async () => {
    const { courtId } = await newCourt();
    const b = await book(courtId, 12, { payment: "Hold" });
    assert.equal((await call("DELETE", `/admin/bookings/${b.bookingId}`)).status, 200);
    assert.equal((await call("POST", `/admin/bookings/${b.bookingId}/check-in`)).status, 404);
    assert.equal((await pub("POST", `/public/bookings/${b.manageToken}/check-in`)).status, 404);
    assert.equal((await bookingRow(b.bookingId)).status, "Deleted");
  });

  it("the court QR shows a booking only from its check-in time (CR-034: no free-until)", async () => {
    const { courtId, qrToken } = await newCourt();
    await book(courtId, 2);
    const court = await pub("GET", `/public/courts/${qrToken}`);
    assert.equal(court.data.court.booking, null);
    assert.equal(court.data.court.freeUntil, undefined);
  });
});
