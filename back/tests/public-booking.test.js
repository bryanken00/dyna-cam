// PLAN-003 Phase C — the player's booking pages: the venue's online booking
// link, availability (no names, no IDs), booking to pay at the desk, the
// booking's own page, and holds that run out.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

const FORMAT = "YYYY-MM-DD HH:mm:ss";
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const ALL_DAY = EVERY_DAY.map((dayOfWeek) => ({ dayOfWeek, opensAt: "00:00", closesAt: "24:00" }));

describe("public booking pages (PLAN-003 Phase C)", () => {
  let ctx;
  let admin;
  let moment;
  const home = {};

  const call = (method, url, body) => ctx.api(method, url, { token: admin.token, body });
  const pub = (method, url, body) => ctx.api(method, url, { body });

  const at = (hoursFromNow) =>
    moment().tz("Asia/Manila").startOf("hour").add(hoursFromNow, "hours").format(FORMAT);
  const slot = (hoursFromNow) => {
    const s = at(hoursFromNow);
    return { date: s.slice(0, 10), startTime: s.slice(11, 16) };
  };

  const settings = (overrides = {}) => ({
    maxBookingMinutes: 180,
    bookingDaysAhead: 14,
    deskHoldMinutes: 30,
    onlineHoldMinutes: 15,
    cancelCutoffHours: 24,
    checkInEarlyMinutes: 10,
    hours: ALL_DAY,
    rates: [{ name: "All day", daysOfWeek: EVERY_DAY, startTime: "00:00", endTime: "24:00", pricePerHour: 350 }],
    ...overrides,
  });

  /** A venue with courts, hours, a rate and online booking on → { venueId, token, courts } */
  const setupVenue = async (name, { courts = ["Court A", "Court B"], ...overrides } = {}) => {
    const venueId = (await call("POST", "/admin/venues", { name })).data.venueId;
    const courtIds = [];
    for (const courtName of courts) {
      const court = await call("POST", "/admin/courts", { venueId, name: courtName });
      assert.equal(court.status, 201, JSON.stringify(court.body));
      courtIds.push(court.data.courtId);
    }
    const saved = await call("PUT", `/admin/booking-settings/${venueId}`, settings(overrides));
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const link = await call("POST", `/admin/booking-settings/${venueId}/link`);
    const token = link.data.bookingUrl.split("/book/")[1];
    return { venueId, token, courtIds };
  };

  const page = (token) => pub("GET", `/public/book/${token}`);
  const availability = (token, date, durationMinutes = 60) =>
    pub("GET", `/public/book/${token}/availability?date=${date}&durationMinutes=${durationMinutes}`);
  // PLAN-006: booking online needs a player signed in with Google — the name and
  // email are the player's, so `email` / `playerName` here pick which player books
  const bookOnline = async (token, courtKey, hoursFromNow, body = {}) => {
    const { email = "bea@example.com", playerName = "Bea Santos", ...rest } = body;
    const player = await ctx.signInPlayer({ email, name: playerName });
    return ctx.api("POST", `/public/book/${token}/bookings`, {
      player: player.token,
      body: {
        courtKey,
        ...slot(hoursFromNow),
        durationMinutes: 60,
        phone: "0917 123 4567",
        payMethod: "Desk",
        ...rest,
      },
    });
  };

  before(async () => {
    ctx = await startTestApp({ env: { RATE_LIMIT_PUBLIC_BOOK_POINTS: "1000" } });
    admin = await ctx.createStaff("Admin", { access: "write" });
    ({ moment } = await ctx.importFromBack("server/src/utils/dateUtils.js"));
    Object.assign(home, await setupVenue("Online Courts"));
  });
  after(() => ctx?.stop());

  it("shows the venue, its courts by key, and the dates players can pick", async () => {
    const res = await page(home.token);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const { venue, courts, today, lastDate, rules, openDays } = res.data;
    assert.equal(venue.name, "Online Courts");
    assert.deepEqual(
      courts.map((c) => c.name),
      ["Court A", "Court B"]
    );
    assert.ok(courts.every((c) => /^[a-f0-9]{16}$/.test(c.key)));
    assert.equal(today, at(0).slice(0, 10));
    // CR-043: today + 14 days, capped by the confirmed week — a new booking link
    // confirms through next week's Sunday, which always comes first
    assert.equal(
      lastDate,
      moment.tz(today, "YYYY-MM-DD", "Asia/Manila").isoWeekday(7).add(7, "days").format("YYYY-MM-DD")
    );
    assert.equal(rules.deskHoldMinutes, 30);
    assert.deepEqual(openDays, EVERY_DAY);
    // No business IDs anywhere
    const body = JSON.stringify(res.body);
    for (const id of [home.venueId, ...home.courtIds]) assert.ok(!body.includes(id));
  });

  it("is gone once online booking is turned off or the link is replaced", async () => {
    const venue = await setupVenue("Switched Off Courts", { courts: ["Only"] });
    const key = (await page(venue.token)).data.courts[0].key;

    await call("POST", `/admin/booking-settings/${venue.venueId}/link`);
    assert.equal((await page(venue.token)).status, 404);
    assert.equal((await availability(venue.token, slot(30).date)).status, 404);
    assert.equal((await bookOnline(venue.token, key, 30)).status, 404);

    assert.equal((await pub("GET", "/public/book/not-a-real-booking-link")).status, 404);
  });

  it("lists free hours with prices, marks taken ones, and never says who booked", async () => {
    const { courts } = (await page(home.token)).data;
    // Fixed times two days ahead, so no slot runs past midnight
    const date = at(48).slice(0, 10);
    const before = await availability(home.token, date, 120);
    assert.equal(before.status, 200, JSON.stringify(before.body));
    const court = before.data.courts.find((c) => c.key === courts[0].key);
    const target = court.slots.find((s) => s.startTime === "10:00");
    assert.equal(target.available, true);
    assert.equal(target.price, 700);
    // A 2-hour booking's last start is 22:00
    assert.equal(court.slots.at(-1).startTime, "22:00");

    const booked = await bookOnline(home.token, courts[0].key, 0, {
      date,
      startTime: "10:00",
      durationMinutes: 120,
    });
    assert.equal(booked.status, 201, JSON.stringify(booked.body));

    const after = await availability(home.token, date, 120);
    const afterCourt = after.data.courts.find((c) => c.key === courts[0].key);
    const free = (start) => afterCourt.slots.find((s) => s.startTime === start).available;
    assert.equal(free("10:00"), false);
    // 9:00–11:00 and 11:00–13:00 overlap it; 8:00–10:00 and 12:00–14:00 don't
    assert.equal(free("09:00"), false);
    assert.equal(free("11:00"), false);
    assert.equal(free("08:00"), true);
    assert.equal(free("12:00"), true);
    // The other court is untouched
    const other = after.data.courts.find((c) => c.key === courts[1].key);
    assert.equal(other.slots.find((s) => s.startTime === "10:00").available, true);

    const text = JSON.stringify(after.body);
    assert.ok(!text.includes("Bea"));
    assert.ok(!text.includes(booked.data.bookingCode));
  });

  it("books to pay at the desk: a hold, its own page, and the desk sees it", async () => {
    const { courts } = (await page(home.token)).data;
    // 10:00 three days ahead: a 2-hour slot that can't run past midnight
    const date = at(72).slice(0, 10);
    const res = await bookOnline(home.token, courts[1].key, 0, {
      date,
      startTime: "10:00",
      durationMinutes: 120,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.match(res.data.manageUrl, /\/booking\/[\w-]{16,}$/);

    const own = await pub("GET", `/public/bookings/${res.data.manageToken}`);
    assert.equal(own.status, 200, JSON.stringify(own.body));
    const b = own.data.booking;
    assert.equal(b.status, "Pending");
    assert.equal(b.bookingCode, res.data.bookingCode);
    assert.equal(b.courtName, "Court B");
    assert.equal(b.price, 700);
    assert.equal(b.durationMinutes, 120);
    assert.equal(b.paymentStatus, "Unpaid");
    assert.equal(
      b.payBy,
      `${date} 09:30:00`
    );

    // The desk sees it, made online, and its link
    const list = await call("GET", `/admin/bookings?venueId=${home.venueId}&search=${res.data.bookingCode}`);
    const listed = list.data.bookings.find((x) => x.bookingCode === res.data.bookingCode);
    assert.equal(listed.source, "Online");
    const detail = await call("GET", `/admin/bookings/${listed.bookingId}`);
    assert.equal(detail.data.booking.manageUrl, res.data.manageUrl);

    // Paid at the desk → confirmed on the player's page
    assert.equal((await call("POST", `/admin/bookings/${listed.bookingId}/payments`, {})).status, 201);
    const paid = await pub("GET", `/public/bookings/${res.data.manageToken}`);
    assert.equal(paid.data.booking.status, "Confirmed");
    assert.equal(paid.data.booking.payBy, null);
  });

  it("refuses the past, beyond the booking window, too long, too soon, and closed hours", async () => {
    const { courts } = (await page(home.token)).data;
    const key = courts[0].key;
    assert.equal((await bookOnline(home.token, key, -26)).status, 400);
    assert.equal((await availability(home.token, at(-26).slice(0, 10))).status, 400);
    assert.equal((await bookOnline(home.token, key, 24 * 16)).status, 400);
    assert.equal((await availability(home.token, at(24 * 16).slice(0, 10))).status, 400);
    assert.equal((await bookOnline(home.token, key, 70, { durationMinutes: 240 })).status, 400);
    // Starts within the pay-at-desk deadline
    assert.equal((await bookOnline(home.token, key, 0)).status, 400);
    assert.equal((await bookOnline(home.token, "0123456789abcdef", 70)).status, 400);
    // PLAN-006: nobody signed in → 401, and nothing is booked
    const anonymous = await pub("POST", `/public/book/${home.token}/bookings`, {
      courtKey: key,
      ...slot(70),
      durationMinutes: 60,
      playerName: "Bea Santos",
      email: "bea@example.com",
      payMethod: "Desk",
    });
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.body.code, "PLAYER_SIGN_IN_REQUIRED");

    const day = moment.tz(at(72), FORMAT, "Asia/Manila");
    const venue = await setupVenue("Morning Courts", {
      courts: ["Early"],
      hours: [{ dayOfWeek: day.day(), opensAt: "06:00", closesAt: "09:00" }],
    });
    const early = (await page(venue.token)).data.courts[0].key;
    const date = day.format("YYYY-MM-DD");
    const avail = await availability(venue.token, date);
    assert.deepEqual(
      avail.data.courts[0].slots.map((s) => s.startTime),
      ["06:00", "07:00", "08:00"]
    );
    const evening = await bookOnline(venue.token, early, 0, {
      date,
      startTime: "20:00",
      playerName: "Late Player",
      email: "late@example.com",
    });
    assert.equal(evening.status, 409);
    assert.match(evening.body.message, /opening hours/);
  });

  it("frees the slot when a hold runs out, and the page says so", async () => {
    const { courts } = (await page(home.token)).data;
    const res = await bookOnline(home.token, courts[0].key, 80);
    assert.equal(res.status, 201);
    // Someone else can't take it while it's held
    const taken = await bookOnline(home.token, courts[0].key, 80, { email: "other@example.com" });
    assert.equal(taken.status, 409);
    assert.ok(!taken.body.message.includes(res.data.bookingCode));

    await ctx.sql.query(`UPDATE bookings SET holdExpiresAt = ? WHERE bookingCode = ?`, [
      at(-1),
      res.data.bookingCode,
    ]);
    const own = await pub("GET", `/public/bookings/${res.data.manageToken}`);
    assert.equal(own.data.booking.status, "Expired");
    assert.equal((await bookOnline(home.token, courts[0].key, 80, { email: "other@example.com" })).status, 201);
  });

  it("treats an unknown or deleted booking link as missing", async () => {
    assert.equal((await pub("GET", "/public/bookings/aaaaaaaaaaaaaaaaaaaaaa")).status, 404);
    assert.equal((await pub("GET", "/public/bookings/bad")).status, 400);

    const { courts } = (await page(home.token)).data;
    const res = await bookOnline(home.token, courts[1].key, 90);
    const list = await call("GET", `/admin/bookings?venueId=${home.venueId}&search=${res.data.bookingCode}`);
    const { bookingId } = list.data.bookings[0];
    assert.equal((await call("DELETE", `/admin/bookings/${bookingId}`)).status, 200);
    assert.equal((await pub("GET", `/public/bookings/${res.data.manageToken}`)).status, 404);
  });
});
