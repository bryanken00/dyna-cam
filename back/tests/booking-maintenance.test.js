// PLAN-003 Phase E — the booking job: unpaid holds expire, bookings nobody
// checked in become no-shows, checked-in bookings become played once their
// game ends. One pass is called directly (with the real clock or a fixed one).

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

const FORMAT = "YYYY-MM-DD HH:mm:ss";
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const ALL_DAY = EVERY_DAY.map((dayOfWeek) => ({ dayOfWeek, opensAt: "00:00", closesAt: "24:00" }));

describe("booking maintenance job (PLAN-003 Phase E)", () => {
  let ctx;
  let admin;
  let moment;
  let runBookingMaintenance;
  let venueId;
  let courtNo = 0;

  const call = (method, url, body) => ctx.api(method, url, { token: admin.token, body });
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
    return res.data.courtId;
  };

  const book = async (courtId, hoursFromNow, payment = "Cash") => {
    const s = at(hoursFromNow);
    const res = await call("POST", "/admin/bookings", {
      courtId,
      date: s.slice(0, 10),
      startTime: s.slice(11, 16),
      durationMinutes: 60,
      playerName: "Dina Lim",
      payment,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.data.bookingId;
  };

  const status = async (bookingId) =>
    (await ctx.sql.query(`SELECT status FROM bookings WHERE bookingId = ?`, [bookingId]))[0][0].status;

  /** Move a booking's window (the API won't book the past). */
  const shift = (bookingId, fromHours, toHours) =>
    ctx.sql.query(`UPDATE bookings SET startAt = ?, endAt = ? WHERE bookingId = ?`, [
      at(fromHours),
      at(toHours),
      bookingId,
    ]);

  before(async () => {
    ctx = await startTestApp();
    admin = await ctx.createStaff("Admin", { access: "write" });
    ({ moment } = await ctx.importFromBack("server/src/utils/dateUtils.js"));
    ({ runBookingMaintenance } = await ctx.importFromBack("server/src/jobs/bookingMaintenance.js"));
    venueId = (await call("POST", "/admin/venues", { name: "Job Courts" })).data.venueId;
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
  });
  after(() => ctx?.stop());

  /** The job, run on the app's own database connection. */
  const runJob = async (options) => {
    const { db } = await ctx.importFromBack("server/config/express.js");
    return runBookingMaintenance(db, options);
  };

  it("expires holds that ran out and leaves live ones", async () => {
    const courtId = await newCourt();
    const stale = await book(courtId, 20, "Hold");
    const live = await book(courtId, 22, "Hold");
    await ctx.sql.query(`UPDATE bookings SET holdExpiresAt = ? WHERE bookingId = ?`, [at(-1), stale]);

    const result = await runJob();
    assert.ok(result.expired >= 1);
    assert.equal(await status(stale), "Expired");
    assert.equal(await status(live), "Pending");
  });

  it("marks bookings nobody checked in as no-shows once they're over", async () => {
    const courtId = await newCourt();
    const over = await book(courtId, 30);
    const now = await book(courtId, 0);
    const later = await book(courtId, 32);
    await shift(over, -3, -2);

    await runJob();
    assert.equal(await status(over), "NoShow");
    // Still within its time: they might still come
    assert.equal(await status(now), "Confirmed");
    assert.equal(await status(later), "Confirmed");
  });

  it("marks a checked-in booking played once its game ends", async () => {
    const courtId = await newCourt();
    const bookingId = await book(courtId, 0);
    const checkIn = await call("POST", `/admin/bookings/${bookingId}/check-in`);
    assert.equal(checkIn.status, 201, JSON.stringify(checkIn.body));

    await runJob();
    assert.equal(await status(bookingId), "CheckedIn");

    // The game ends (End game / its time is up)
    await ctx.sql.query(`UPDATE recording_sessions SET status = 'Processing' WHERE sessionId = ?`, [
      checkIn.data.sessionId,
    ]);
    const result = await runJob();
    assert.ok(result.completed >= 1);
    assert.equal(await status(bookingId), "Completed");
  });

  it("goes by the clock it's given, and a second pass changes nothing", async () => {
    const courtId = await newCourt();
    const bookingId = await book(courtId, 40);
    // Two hours after the booking ends
    const result = await runJob({ now: at(43) });
    assert.ok(result.noShows >= 1);
    assert.equal(await status(bookingId), "NoShow");

    const again = await runJob({ now: at(43) });
    assert.deepEqual(again, { expired: 0, noShows: 0, completed: 0 });
  });

  it("never touches cancelled or deleted bookings", async () => {
    const courtId = await newCourt();
    const cancelled = await book(courtId, 50);
    await call("POST", `/admin/bookings/${cancelled}/cancel`, { reason: "x" });
    const deleted = await book(courtId, 52, "Hold");
    await call("DELETE", `/admin/bookings/${deleted}`);

    await runJob({ now: at(60) });
    assert.equal(await status(cancelled), "Cancelled");
    assert.equal(await status(deleted), "Deleted");
  });
});
