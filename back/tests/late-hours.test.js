// CR-049 — opening hours past midnight: a day may close the next morning (up to
// 24 hours after it opens). The late hours belong to the evening's day: they're
// listed on its booking page as "24:00", "25:00", … (nextDay), booked on their
// real date and time, priced by the rate for that real time, and the next day
// can't open before they end.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const LATE = EVERY_DAY.map((dayOfWeek) => ({ dayOfWeek, opensAt: "06:00", closesAt: "25:00" }));

describe("opening hours past midnight (CR-049)", () => {
  let ctx;
  let admin;
  let moment;
  let timeline;
  const home = {};
  let playerNo = 0;

  const call = (method, url, body) => ctx.api(method, url, { token: admin.token, body });
  const day = (daysAhead) => moment().tz("Asia/Manila").add(daysAhead, "days").format("YYYY-MM-DD");
  const nextDate = (date) => moment.tz(date, "YYYY-MM-DD", "Asia/Manila").add(1, "day").format("YYYY-MM-DD");
  const weekday = (date) => moment.tz(date, "YYYY-MM-DD", "Asia/Manila").day();

  const settings = (overrides = {}) => ({
    deskHoldMinutes: 30,
    onlineHoldMinutes: 15,
    cancelCutoffHours: 24,
    checkInEarlyMinutes: 10,
    hours: LATE,
    rates: [
      { name: "Day", daysOfWeek: EVERY_DAY, startTime: "06:00", endTime: "24:00", pricePerHour: 300 },
      { name: "Late", daysOfWeek: EVERY_DAY, startTime: "00:00", endTime: "01:00", pricePerHour: 400 },
    ],
    ...overrides,
  });

  const newPlayer = () => {
    playerNo += 1;
    return ctx.signInPlayer({ email: `late${playerNo}@example.test`, name: `Late Player${playerNo}` });
  };

  const availability = (date) => ctx.api("GET", `/public/book/${home.token}/availability?date=${date}`);

  before(async () => {
    ctx = await startTestApp({ env: { RATE_LIMIT_PUBLIC_BOOK_POINTS: "1000" } });
    admin = await ctx.createStaff("Admin", { access: "write" });
    ({ moment } = await ctx.importFromBack("server/src/utils/dateUtils.js"));
    timeline = await ctx.importFromBack("server/src/utils/courtTimeline.js");

    home.venueId = (await call("POST", "/admin/venues", { name: "Late Courts" })).data.venueId;
    home.courtIds = [];
    for (const name of ["Court A", "Court B"]) {
      const court = await call("POST", "/admin/courts", {
        venueId: home.venueId,
        name,
        cameraRtspUrl: `rtsp://u:p@10.0.9.${name.endsWith("A") ? 1 : 2}:554/stream1`,
      });
      assert.equal(court.status, 201, JSON.stringify(court.body));
      home.courtIds.push(court.data.courtId);
    }
    const saved = await call("PUT", `/admin/booking-settings/${home.venueId}`, settings());
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const link = await call("POST", `/admin/booking-settings/${home.venueId}/link`);
    home.token = link.data.bookingUrl.split("/book/")[1];
    const page = await ctx.api("GET", `/public/book/${home.token}`);
    home.courts = Object.fromEntries(page.data.courts.map((c) => [c.name, c.key]));
  });
  after(async () => {
    await ctx?.stop();
  });

  it("saves a day closing the next morning, and refuses overlaps and more than 24 hours", async () => {
    const res = await call("GET", `/admin/booking-settings/${home.venueId}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.data.settings.hours[0], { dayOfWeek: 0, opensAt: "06:00", closesAt: "25:00" });

    // Monday runs to 1 AM Tuesday, so Tuesday can't open at midnight
    const overlap = await call(
      "PUT",
      `/admin/booking-settings/${home.venueId}`,
      settings({
        hours: [
          { dayOfWeek: 1, opensAt: "06:00", closesAt: "25:00" },
          { dayOfWeek: 2, opensAt: "00:00", closesAt: "22:00" },
        ],
      })
    );
    assert.equal(overlap.status, 400);
    assert.match(JSON.stringify(overlap.body), /Tuesday can't open before Monday's hours end/);

    // Sunday's late hours wrap into Monday
    const wrap = await call(
      "PUT",
      `/admin/booking-settings/${home.venueId}`,
      settings({
        hours: [
          { dayOfWeek: 0, opensAt: "06:00", closesAt: "27:00" },
          { dayOfWeek: 1, opensAt: "02:00", closesAt: "22:00" },
        ],
      })
    );
    assert.equal(wrap.status, 400);

    const tooLong = await call(
      "PUT",
      `/admin/booking-settings/${home.venueId}`,
      settings({ hours: [{ dayOfWeek: 3, opensAt: "06:00", closesAt: "31:00" }] })
    );
    assert.equal(tooLong.status, 400);

    // Round the clock is fine: 6 AM to 6 AM, the next day opening at 6 AM
    const roundTheClock = await call(
      "PUT",
      `/admin/booking-settings/${home.venueId}`,
      settings({
        hours: [
          { dayOfWeek: 3, opensAt: "06:00", closesAt: "30:00" },
          { dayOfWeek: 4, opensAt: "06:00", closesAt: "22:00" },
        ],
      })
    );
    assert.equal(roundTheClock.status, 200, JSON.stringify(roundTheClock.body));

    // Back to every day 6 AM – 1 AM for the rest
    assert.equal((await call("PUT", `/admin/booking-settings/${home.venueId}`, settings())).status, 200);
  });

  it("lists the late hour on the evening's day only, priced by its real time", async () => {
    const date = day(5);
    const res = await availability(date);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const slots = res.data.courts[0].slots;
    assert.equal(slots[0].startTime, "06:00");
    const last = slots[slots.length - 1];
    assert.equal(last.startTime, "24:00");
    assert.equal(last.nextDay, true);
    assert.equal(last.price, 400);
    assert.equal(slots.find((s) => s.startTime === "23:00").price, 300);
    assert.equal(res.data.hours.closesAt, "25:00");

    // The next date starts at its own opening — its 12 AM hour was the evening's
    const next = await availability(nextDate(date));
    assert.equal(next.data.courts[0].slots[0].startTime, "06:00");
    assert.ok(!next.data.courts[0].slots.some((s) => s.startTime === "00:00"));
  });

  it("joins 11 PM and 12 AM into one game, booked on its real date and time", async () => {
    const player = await newPlayer();
    const date = day(6);
    const res = await ctx.api("POST", `/public/book/${home.token}/bookings`, {
      player: player.token,
      body: {
        date,
        slots: [
          { courtKey: home.courts["Court A"], startTime: "24:00" },
          { courtKey: home.courts["Court A"], startTime: "23:00" },
        ],
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.data.bookings.length, 1);
    assert.equal(Number(res.data.total), 700);
    const [[row]] = await ctx.sql.query(`SELECT startAt, endAt, price FROM bookings WHERE manageToken = ?`, [
      res.data.manageToken,
    ]);
    assert.equal(moment(row.startAt).format("YYYY-MM-DD HH:mm"), `${date} 23:00`);
    assert.equal(moment(row.endAt).format("YYYY-MM-DD HH:mm"), `${nextDate(date)} 01:00`);
    assert.equal(Number(row.price), 700);

    // Now taken on the evening's page
    const after = await availability(date);
    const late = after.data.courts.find((c) => c.name === "Court A").slots.find((s) => s.startTime === "24:00");
    assert.equal(late.available, false);
    assert.equal(late.reason, "taken");
  });

  it("the desk follows the same hours: 12 AM yes, 1 AM no", async () => {
    const date = nextDate(day(8));
    const desk = (startTime) =>
      call("POST", "/admin/bookings", {
        courtId: home.courtIds[1],
        date,
        startTime,
        durationMinutes: 60,
        playerName: "Late Desk",
        payment: "Free",
      });
    const midnight = await desk("00:00");
    assert.equal(midnight.status, 201, JSON.stringify(midnight.body));
    const oneAm = await desk("01:00");
    assert.equal(oneAm.status, 409);
    assert.match(oneAm.body.message, /opening hours/);
  });

  it("an open hour with no rate can't be booked", async () => {
    // The late rate only on the day after day(10): day(10)'s 12 AM hour isn't priced
    const unpricedDay = weekday(nextDate(day(10)));
    const saved = await call(
      "PUT",
      `/admin/booking-settings/${home.venueId}`,
      settings({
        rates: [
          { name: "Day", daysOfWeek: EVERY_DAY, startTime: "06:00", endTime: "24:00", pricePerHour: 300 },
          {
            name: "Late",
            daysOfWeek: EVERY_DAY.filter((d) => d !== unpricedDay),
            startTime: "00:00",
            endTime: "01:00",
            pricePerHour: 400,
          },
        ],
      })
    );
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const res = await availability(day(10));
    const late = res.data.courts[0].slots.find((s) => s.startTime === "24:00");
    assert.equal(late.available, false);
    assert.equal(late.price, null);
    assert.equal(late.reason, "noPrice");
    assert.equal((await call("PUT", `/admin/booking-settings/${home.venueId}`, settings())).status, 200);
  });

  it("withinHours and the first bookable date follow last night's late hours", () => {
    const hours = new Map(EVERY_DAY.map((d) => [d, { opensAt: 360, closesAt: 1500 }]));
    // 2026-11-26 is a Thursday
    assert.equal(timeline.withinHours(hours, "2026-11-26 23:00:00", "2026-11-27 01:00:00"), true);
    assert.equal(timeline.withinHours(hours, "2026-11-27 00:00:00", "2026-11-27 01:00:00"), true);
    assert.equal(timeline.withinHours(hours, "2026-11-27 01:00:00", "2026-11-27 02:00:00"), false);
    assert.equal(timeline.withinHours(hours, "2026-11-27 05:00:00", "2026-11-27 06:00:00"), false);
    assert.equal(timeline.withinHours(hours, "2026-11-27 06:00:00", "2026-11-27 07:00:00"), true);

    assert.equal(timeline.firstBookableDate(hours, "2026-11-27 00:30:00"), "2026-11-26");
    assert.equal(timeline.firstBookableDate(hours, "2026-11-27 01:00:00"), "2026-11-27");
    assert.equal(timeline.firstBookableDate(new Map(), "2026-11-27 00:30:00"), "2026-11-27");
  });
});
