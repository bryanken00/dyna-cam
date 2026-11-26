// CR-043 — a venue's weekly schedule opens for online booking one week at a time:
// staff confirm next week before players can book it, the desk can always book,
// and the Dashboard lists venues whose next week isn't confirmed yet.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const ALL_DAY = EVERY_DAY.map((dayOfWeek) => ({ dayOfWeek, opensAt: "00:00", closesAt: "24:00" }));
const DATE = "YYYY-MM-DD";

describe("weekly schedule confirmation (CR-043)", () => {
  let ctx;
  let admin;
  let moment;
  let weeks;

  const call = (method, url, body, token = admin.token) => ctx.api(method, url, { token, body });
  const pub = (method, url, body) => ctx.api(method, url, { body });
  // PLAN-006: booking online needs a player signed in with Google — the body's
  // email / playerName say which player books (their account gives both)
  const bookAsPlayer = async (url, { email = "bea@example.com", playerName = "Bea Santos", ...body }) => {
    const player = await ctx.signInPlayer({ email, name: playerName });
    return ctx.api("POST", url, { player: player.token, body });
  };

  const today = () => moment().tz("Asia/Manila").format(DATE);
  const thisSunday = () => moment.tz(today(), DATE, "Asia/Manila").isoWeekday(7).format(DATE);
  const nextMonday = () =>
    moment.tz(today(), DATE, "Asia/Manila").isoWeekday(1).add(7, "days").format(DATE);
  const nextSunday = () =>
    moment.tz(today(), DATE, "Asia/Manila").isoWeekday(7).add(7, "days").format(DATE);

  const setConfirmed = (venueId, date) =>
    ctx.sql.query(`UPDATE venues SET scheduleConfirmedUntil = ? WHERE venueId = ?`, [
      date,
      venueId,
    ]);
  const confirmedOf = async (venueId) => {
    const [[row]] = await ctx.sql.query(
      `SELECT DATE_FORMAT(scheduleConfirmedUntil, '%Y-%m-%d') AS d FROM venues WHERE venueId = ?`,
      [venueId]
    );
    return row.d;
  };

  /** A venue with one court, hours, a rate and online booking on. */
  const setupVenue = async (name, overrides = {}) => {
    const venueId = (await call("POST", "/admin/venues", { name })).data.venueId;
    const court = await call("POST", "/admin/courts", { venueId, name: "Court A" });
    assert.equal(court.status, 201, JSON.stringify(court.body));
    const saved = await call("PUT", `/admin/booking-settings/${venueId}`, {
      maxBookingMinutes: 180,
      bookingDaysAhead: 14,
      deskHoldMinutes: 30,
      onlineHoldMinutes: 15,
      cancelCutoffHours: 24,
      checkInEarlyMinutes: 10,
      hours: ALL_DAY,
      rates: [
        { name: "All day", daysOfWeek: EVERY_DAY, startTime: "00:00", endTime: "24:00", pricePerHour: 300 },
      ],
      ...overrides,
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const link = await call("POST", `/admin/booking-settings/${venueId}/link`);
    const token = link.data.bookingUrl.split("/book/")[1];
    const courtKey = (await pub("GET", `/public/book/${token}`)).data.courts[0].key;
    return { venueId, courtId: court.data.courtId, token, courtKey };
  };

  const bookOnline = (venue, date) =>
    bookAsPlayer(`/public/book/${venue.token}/bookings`, {
      courtKey: venue.courtKey,
      date,
      startTime: "10:00",
      durationMinutes: 60,
      playerName: "Bea Santos",
      phone: "0917 123 4567",
      email: "bea@example.com",
      payMethod: "Desk",
    });
  const reminders = (token = admin.token) =>
    call("GET", "/admin/booking-settings/schedule-reminders", undefined, token);

  before(async () => {
    ctx = await startTestApp({ env: { RATE_LIMIT_PUBLIC_BOOK_POINTS: "1000" } });
    admin = await ctx.createStaff("Admin", { access: "write" });
    ({ moment } = await ctx.importFromBack("server/src/utils/dateUtils.js"));
    weeks = await ctx.importFromBack("server/src/utils/scheduleWeeks.js");
  });
  after(() => ctx?.stop());

  describe("week maths", () => {
    it("confirms through next week's Sunday, from any day of this week", () => {
      assert.equal(weeks.confirmTarget("2026-11-23"), "2026-12-06"); // Monday
      assert.equal(weeks.confirmTarget("2026-11-29"), "2026-12-06"); // Sunday
      assert.equal(weeks.confirmTarget("2026-11-30"), "2026-12-13"); // the next Monday
    });

    it("caps the player's last date by the confirmed week and the days-ahead rule", () => {
      const venue = { bookingDaysAhead: 14, scheduleConfirmedUntil: "2026-12-06" };
      assert.equal(weeks.playerLastDate(venue, "2026-11-25"), "2026-12-06");
      assert.equal(weeks.playerLastDate({ ...venue, bookingDaysAhead: 3 }, "2026-11-25"), "2026-11-28");
      // Never confirmed: nothing open (the day before today)
      assert.equal(
        weeks.playerLastDate({ ...venue, scheduleConfirmedUntil: null }, "2026-11-25"),
        "2026-11-24"
      );
    });

    it("is due early in the week, a warning under 3 days, and closed once a week starts unconfirmed", () => {
      const through = "2026-11-29"; // this week's Sunday, next week not confirmed
      const monday = weeks.scheduleStatus(through, "2026-11-23 09:00:00");
      assert.equal(monday.level, "due");
      assert.equal(monday.nextWeekStart, "2026-11-30");
      assert.equal(monday.nextWeekEnd, "2026-12-06");
      assert.equal(monday.daysLeft, 7);
      assert.equal(weeks.scheduleStatus(through, "2026-11-26 23:00:00").level, "due"); // 73 h
      assert.equal(weeks.scheduleStatus(through, "2026-11-27 00:30:00").level, "soon"); // 71.5 h
      assert.equal(weeks.scheduleStatus(through, "2026-11-29 23:59:00").level, "soon");
      assert.equal(weeks.scheduleStatus("2026-12-06", "2026-11-27 09:00:00").level, "ok");
      assert.equal(weeks.scheduleStatus("2026-11-22", "2026-11-25 09:00:00").level, "closed");
      assert.equal(weeks.scheduleStatus(null, "2026-11-25 09:00:00").level, "closed");
    });
  });

  it("a new booking link confirms this week and next", async () => {
    const venue = await setupVenue("Fresh Courts");
    assert.equal(await confirmedOf(venue.venueId), nextSunday());
    const res = await call("GET", `/admin/booking-settings/${venue.venueId}`);
    assert.equal(res.status, 200);
    assert.equal(res.data.settings.schedule.confirmedUntil, nextSunday());
    assert.equal(res.data.settings.schedule.level, "ok");
  });

  it("keeps next week closed online until it's confirmed — the desk can still book it", async () => {
    const venue = await setupVenue("Weekly Courts");
    await setConfirmed(venue.venueId, thisSunday());

    // The booking page stops at this Sunday
    const page = await pub("GET", `/public/book/${venue.token}`);
    assert.equal(page.data.lastDate, thisSunday());
    const avail = await pub(
      "GET",
      `/public/book/${venue.token}/availability?date=${nextMonday()}&durationMinutes=60`
    );
    assert.equal(avail.status, 400);
    assert.match(avail.body.message, /aren't open yet/);

    const refused = await bookOnline(venue, nextMonday());
    assert.equal(refused.status, 400, JSON.stringify(refused.body));
    assert.match(refused.body.message, /aren't open yet/);

    // Staff at the desk aren't limited by it
    const desk = await call("POST", "/admin/bookings", {
      courtId: venue.courtId,
      date: nextMonday(),
      startTime: "12:00",
      durationMinutes: 60,
      playerName: "Desk Player",
      payment: "Free",
    });
    assert.equal(desk.status, 201, JSON.stringify(desk.body));

    // The Dashboard lists it, due or (from Friday) a warning
    const listed = (await reminders()).data.reminders.find((r) => r.venueId === venue.venueId);
    assert.ok(listed, "the venue is on the reminders list");
    assert.ok(["due", "soon"].includes(listed.level), listed.level);
    assert.equal(listed.venueName, "Weekly Courts");
    assert.equal(listed.nextWeekStart, nextMonday());

    // Confirm → next week opens, the reminder goes
    const confirmed = await call("POST", `/admin/booking-settings/${venue.venueId}/confirm-week`);
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    assert.equal(confirmed.data.schedule.confirmedUntil, nextSunday());
    assert.equal(confirmed.data.schedule.level, "ok");
    assert.equal(await confirmedOf(venue.venueId), nextSunday());
    assert.ok(!(await reminders()).data.reminders.some((r) => r.venueId === venue.venueId));
    assert.equal((await pub("GET", `/public/book/${venue.token}`)).data.lastDate, nextSunday());
    const booked = await bookOnline(venue, nextMonday());
    assert.equal(booked.status, 201, JSON.stringify(booked.body));

    // Confirming again changes nothing
    const again = await call("POST", `/admin/booking-settings/${venue.venueId}/confirm-week`);
    assert.equal(again.status, 200);
    assert.match(again.body.message, /already confirmed/);
    assert.equal(await confirmedOf(venue.venueId), nextSunday());
  });

  it("closes online booking now when this week wasn't confirmed, and Confirm opens it again", async () => {
    const venue = await setupVenue("Lapsed Courts");
    const lastSunday = moment.tz(thisSunday(), DATE, "Asia/Manila").subtract(7, "days").format(DATE);
    await setConfirmed(venue.venueId, lastSunday);

    const page = await pub("GET", `/public/book/${venue.token}`);
    assert.ok(page.data.lastDate < page.data.today, "no date is open");
    const listed = (await reminders()).data.reminders.find((r) => r.venueId === venue.venueId);
    assert.equal(listed.level, "closed");
    // The most urgent comes first
    assert.equal((await reminders()).data.reminders[0].level, "closed");

    await call("POST", `/admin/booking-settings/${venue.venueId}/confirm-week`);
    assert.equal(await confirmedOf(venue.venueId), nextSunday());
  });

  it("still says 'days ahead' when that rule comes before the confirmed week", async () => {
    const venue = await setupVenue("Short Window Courts", { bookingDaysAhead: 1 });
    const inThreeDays = moment.tz(today(), DATE, "Asia/Manila").add(3, "days").format(DATE);
    const res = await bookOnline(venue, inThreeDays);
    assert.equal(res.status, 400);
    assert.match(res.body.message, /1 days ahead/);
  });

  it("leaves out venues with online booking off", async () => {
    const venue = await setupVenue("Offline Courts");
    await setConfirmed(venue.venueId, thisSunday());
    await call("DELETE", `/admin/booking-settings/${venue.venueId}/link`);
    assert.ok(!(await reminders()).data.reminders.some((r) => r.venueId === venue.venueId));
  });

  it("returns 404 for a Deleted venue and leaves it unchanged", async () => {
    const venue = await setupVenue("Gone Courts");
    await setConfirmed(venue.venueId, thisSunday());
    assert.equal((await call("DELETE", `/admin/venues/${venue.venueId}`)).status, 200);

    const res = await call("POST", `/admin/booking-settings/${venue.venueId}/confirm-week`);
    assert.equal(res.status, 404);
    assert.equal(await confirmedOf(venue.venueId), thisSunday());
    assert.ok(!(await reminders()).data.reminders.some((r) => r.venueId === venue.venueId));
  });

  it("needs the bookings permission: read to see reminders, write to confirm", async () => {
    const venue = await setupVenue("Permission Courts");
    await setConfirmed(venue.venueId, thisSunday());
    const nobody = await ctx.createStaff("No Access");
    assert.equal((await reminders(nobody.token)).status, 403);

    const reader = await ctx.createStaff("Reader", { access: "read" });
    assert.equal((await reminders(reader.token)).status, 200);
    const res = await call(
      "POST",
      `/admin/booking-settings/${venue.venueId}/confirm-week`,
      undefined,
      reader.token
    );
    assert.equal(res.status, 403);
    assert.equal(await confirmedOf(venue.venueId), thisSunday());
  });

  describe("Undo confirmation", () => {
    const undo = (venueId, token = admin.token) =>
      call("POST", `/admin/booking-settings/${venueId}/unconfirm-week`, undefined, token);
    const deskBooking = (venue, date, startTime = "12:00") =>
      call("POST", "/admin/bookings", {
        courtId: venue.courtId,
        date,
        startTime,
        durationMinutes: 60,
        playerName: "Desk Player",
        payment: "Free",
      });

    it("takes next week back while nobody has booked it", async () => {
      const venue = await setupVenue("Undo Courts");
      const before = await call("GET", `/admin/booking-settings/${venue.venueId}`);
      assert.equal(before.data.settings.schedule.nextWeekBookings, 0);

      const res = await undo(venue.venueId);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.data.schedule.confirmedUntil, thisSunday());
      assert.notEqual(res.data.schedule.level, "ok");
      assert.equal(await confirmedOf(venue.venueId), thisSunday());

      // Players can't book next week online again, and the Dashboard asks for it
      assert.equal((await pub("GET", `/public/book/${venue.token}`)).data.lastDate, thisSunday());
      const refused = await bookOnline(venue, nextMonday());
      assert.equal(refused.status, 400);
      assert.match(refused.body.message, /aren't open yet/);
      assert.ok((await reminders()).data.reminders.some((r) => r.venueId === venue.venueId));

      // Confirm again works as before
      await call("POST", `/admin/booking-settings/${venue.venueId}/confirm-week`);
      assert.equal(await confirmedOf(venue.venueId), nextSunday());
    });

    it("keeps the confirmation once next week has a booking (desk or online)", async () => {
      const venue = await setupVenue("Booked Courts");
      const desk = await deskBooking(venue, nextMonday());
      assert.equal(desk.status, 201, JSON.stringify(desk.body));

      const settings = await call("GET", `/admin/booking-settings/${venue.venueId}`);
      assert.equal(settings.data.settings.schedule.nextWeekBookings, 1);
      const res = await undo(venue.venueId);
      assert.equal(res.status, 409);
      assert.match(res.body.message, /1 booking/);
      assert.equal(await confirmedOf(venue.venueId), nextSunday());

      const online = await setupVenue("Booked Online Courts");
      assert.equal((await bookOnline(online, nextMonday())).status, 201);
      assert.equal((await undo(online.venueId)).status, 409);
      assert.equal(await confirmedOf(online.venueId), nextSunday());
    });

    it("has nothing to undo when next week isn't confirmed", async () => {
      const venue = await setupVenue("Unconfirmed Courts");
      await setConfirmed(venue.venueId, thisSunday());
      const res = await undo(venue.venueId);
      assert.equal(res.status, 409);
      assert.match(res.body.message, /isn't confirmed/);
      assert.equal(await confirmedOf(venue.venueId), thisSunday());
    });

    it("returns 404 for a Deleted venue and leaves it unchanged", async () => {
      const venue = await setupVenue("Gone Undo Courts");
      assert.equal((await call("DELETE", `/admin/venues/${venue.venueId}`)).status, 200);
      assert.equal((await undo(venue.venueId)).status, 404);
      assert.equal(await confirmedOf(venue.venueId), nextSunday());
    });

    it("needs bookings write", async () => {
      const venue = await setupVenue("Read Only Undo Courts");
      const reader = await ctx.createStaff("Undo Reader", { access: "read" });
      assert.equal((await undo(venue.venueId, reader.token)).status, 403);
      assert.equal(await confirmedOf(venue.venueId), nextSunday());
    });
  });
});
