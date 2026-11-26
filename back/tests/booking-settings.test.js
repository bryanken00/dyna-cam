// PLAN-003 Phase A — a venue's booking setup (rules, opening hours, rates,
// online link), closures, the price quote and the court timeline.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

const FORMAT = "YYYY-MM-DD HH:mm:ss";

const SETTINGS = {
  maxBookingMinutes: 180,
  bookingDaysAhead: 14,
  deskHoldMinutes: 30,
  onlineHoldMinutes: 15,
  cancelCutoffHours: 24,
  checkInEarlyMinutes: 10,
};

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

describe("booking settings and closures (PLAN-003 Phase A)", () => {
  let ctx;
  let admin; // staff with write access to everything
  let viewer; // staff with read access to everything
  let nobody; // staff with no permissions
  let moment;
  let quoteFromRates;
  let findConflict;
  const home = {};
  let courtNo = 0;

  const call = (method, url, body, who = admin) => ctx.api(method, url, { token: who.token, body });

  const newVenue = async (name) => {
    const res = await call("POST", "/admin/venues", { name });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.data.venueId;
  };

  const newCourt = async (venueId = home.venueId, withCamera = false) => {
    courtNo += 1;
    const res = await call("POST", "/admin/courts", {
      venueId,
      name: `Court ${courtNo}`,
      ...(withCamera ? { cameraRtspUrl: `rtsp://u:p@10.0.2.${courtNo}:554/stream1` } : {}),
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.data.courtId;
  };

  const getSettings = (venueId = home.venueId, who = admin) =>
    call("GET", `/admin/booking-settings/${venueId}`, undefined, who);

  const putSettings = (body, venueId = home.venueId, who = admin) =>
    call("PUT", `/admin/booking-settings/${venueId}`, { ...SETTINGS, hours: [], rates: [], ...body }, who);

  /** Manila "now" shifted, on the hour. */
  const at = (hoursFromNow) =>
    moment().tz("Asia/Manila").startOf("hour").add(hoursFromNow, "hours").format(FORMAT);

  /** A booking row straight into the table — the API can't make one until Phase B. */
  const insertBooking = async ({ courtId, venueId = home.venueId, startAt, endAt, status, holdExpiresAt = null }) => {
    const [[{ id }]] = await ctx.sql.query(`SELECT UUID() AS id`);
    const code = `T${String(Math.random()).slice(2, 7)}`;
    await ctx.sql.query(
      `INSERT INTO bookings
         (bookingId, venueId, courtId, startAt, endAt, playerName, price, paymentStatus,
          payMethod, source, bookingCode, manageToken, holdExpiresAt, status, dateCreated,
          dateUpdated)
       VALUES (?, ?, ?, ?, ?, 'Test Player', 400, 'Paid', 'Desk', 'Desk', ?, ?, ?, ?, ?, ?)`,
      [id, venueId, courtId, startAt, endAt, code, `manage-${id}`, holdExpiresAt, status, at(0), at(0)]
    );
    return id;
  };

  before(async () => {
    ctx = await startTestApp();
    admin = await ctx.createStaff("Admin", { access: "write" });
    viewer = await ctx.createStaff("Viewer", { access: "read" });
    nobody = await ctx.createStaff("Nobody");
    ({ moment } = await ctx.importFromBack("server/src/utils/dateUtils.js"));
    ({ quoteFromRates } = await ctx.importFromBack("server/src/utils/bookingPrice.js"));
    ({ findConflict } = await ctx.importFromBack("server/src/utils/courtTimeline.js"));
    home.venueId = await newVenue("Booking Courts");
    home.courtId = await newCourt();
  });
  after(() => ctx?.stop());

  describe("settings", () => {
    it("starts with online booking off, the default rules and no hours or rates", async () => {
      const res = await getSettings();
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const { settings, courts } = res.data;
      assert.equal(settings.bookingEnabled, false);
      assert.equal(settings.bookingUrl, null);
      // CR-047: no longest booking — a booking runs up to the venue's opening hours
      assert.equal(settings.maxBookingMinutes, undefined);
      assert.equal(settings.deskHoldMinutes, 30);
      assert.deepEqual(settings.hours, []);
      assert.deepEqual(settings.rates, []);
      assert.ok(courts.some((c) => c.courtId === home.courtId));
    });

    it("saves the rules, hours and rates, then edits and removes them", async () => {
      const saved = await putSettings({
        maxBookingMinutes: 120,
        hours: [
          { dayOfWeek: 1, opensAt: "06:00", closesAt: "22:00" },
          { dayOfWeek: 6, opensAt: "07:00", closesAt: "24:00" },
        ],
        rates: [
          { name: "Off-peak", daysOfWeek: [1, 2, 3, 4, 5], startTime: "06:00", endTime: "17:00", pricePerHour: 300 },
          { name: "Peak", daysOfWeek: [1, 2, 3, 4, 5], startTime: "17:00", endTime: "22:00", pricePerHour: 450 },
          { name: "Court special", courtId: home.courtId, daysOfWeek: [6], startTime: "07:00", endTime: "24:00", pricePerHour: 500 },
        ],
      });
      assert.equal(saved.status, 200, JSON.stringify(saved.body));

      let { settings } = (await getSettings()).data;
      // An old client's Longest booking is ignored
      assert.equal(settings.maxBookingMinutes, undefined);
      assert.deepEqual(settings.hours, [
        { dayOfWeek: 1, opensAt: "06:00", closesAt: "22:00" },
        { dayOfWeek: 6, opensAt: "07:00", closesAt: "24:00" },
      ]);
      assert.equal(settings.rates.length, 3);
      const peak = settings.rates.find((r) => r.name === "Peak");
      assert.deepEqual(peak.daysOfWeek, [1, 2, 3, 4, 5]);
      assert.equal(peak.pricePerHour, 450);
      const special = settings.rates.find((r) => r.name === "Court special");
      assert.equal(special.courtId, home.courtId);
      assert.ok(special.courtName);

      // Keep Peak (new price), drop the others, close Saturday
      const again = await putSettings({
        hours: [{ dayOfWeek: 1, opensAt: "08:00", closesAt: "22:00" }],
        rates: [{ ...peak, pricePerHour: 480 }],
      });
      assert.equal(again.status, 200, JSON.stringify(again.body));

      ({ settings } = (await getSettings()).data);
      assert.deepEqual(settings.hours, [{ dayOfWeek: 1, opensAt: "08:00", closesAt: "22:00" }]);
      assert.equal(settings.rates.length, 1);
      assert.equal(settings.rates[0].rateId, peak.rateId);
      assert.equal(settings.rates[0].pricePerHour, 480);

      // Removed rows are soft-deleted, not gone
      const [[{ deleted }]] = await ctx.sql.query(
        `SELECT COUNT(*) AS deleted FROM court_rates WHERE venueId = ? AND status = 'Deleted'`,
        [home.venueId]
      );
      assert.equal(Number(deleted), 2);
    });

    it("refuses bad hours, overlapping rates and foreign courts", async () => {
      const notOnTheHour = await putSettings({
        hours: [{ dayOfWeek: 2, opensAt: "06:30", closesAt: "22:00" }],
      });
      assert.equal(notOnTheHour.status, 400);

      const backwards = await putSettings({
        hours: [{ dayOfWeek: 2, opensAt: "22:00", closesAt: "06:00" }],
      });
      assert.equal(backwards.status, 400);

      const twice = await putSettings({
        hours: [
          { dayOfWeek: 2, opensAt: "06:00", closesAt: "12:00" },
          { dayOfWeek: 2, opensAt: "13:00", closesAt: "20:00" },
        ],
      });
      assert.equal(twice.status, 400);

      const overlap = await putSettings({
        rates: [
          { name: "A", daysOfWeek: [1, 2], startTime: "06:00", endTime: "18:00", pricePerHour: 300 },
          { name: "B", daysOfWeek: [2, 3], startTime: "17:00", endTime: "22:00", pricePerHour: 450 },
        ],
      });
      assert.equal(overlap.status, 400);

      // A court's own rate may overlap a venue-wide one (it wins)
      const override = await putSettings({
        rates: [
          { name: "All courts", daysOfWeek: EVERY_DAY, startTime: "06:00", endTime: "22:00", pricePerHour: 300 },
          { name: "Show court", courtId: home.courtId, daysOfWeek: EVERY_DAY, startTime: "06:00", endTime: "22:00", pricePerHour: 600 },
        ],
      });
      assert.equal(override.status, 200, JSON.stringify(override.body));

      const elsewhere = await newCourt(await newVenue("Other Courts"));
      const foreign = await putSettings({
        rates: [{ name: "X", courtId: elsewhere, daysOfWeek: [1], startTime: "06:00", endTime: "08:00", pricePerHour: 1 }],
      });
      assert.equal(foreign.status, 400);

      const ghost = await putSettings({
        rates: [{ rateId: "not-a-rate", name: "X", daysOfWeek: [1], startTime: "06:00", endTime: "08:00", pricePerHour: 1 }],
      });
      assert.equal(ghost.status, 409);
    });

    it("issues a booking link, replaces it, and turns it off", async () => {
      const first = await call("POST", `/admin/booking-settings/${home.venueId}/link`);
      assert.equal(first.status, 200, JSON.stringify(first.body));
      assert.match(first.data.bookingUrl, /\/book\/[\w-]{16,}$/);

      const second = await call("POST", `/admin/booking-settings/${home.venueId}/link`);
      assert.notEqual(second.data.bookingUrl, first.data.bookingUrl);

      let { settings } = (await getSettings()).data;
      assert.equal(settings.bookingEnabled, true);
      assert.equal(settings.bookingUrl, second.data.bookingUrl);

      const off = await call("DELETE", `/admin/booking-settings/${home.venueId}/link`);
      assert.equal(off.status, 200);
      ({ settings } = (await getSettings()).data);
      assert.equal(settings.bookingEnabled, false);
      assert.equal(settings.bookingUrl, null);
    });

    it("needs the bookings permission: read to see, write to change", async () => {
      assert.equal((await getSettings(home.venueId, viewer)).status, 200);
      assert.equal((await putSettings({}, home.venueId, viewer)).status, 403);
      assert.equal(
        (await call("POST", `/admin/booking-settings/${home.venueId}/link`, undefined, viewer)).status,
        403
      );
      assert.equal((await getSettings(home.venueId, nobody)).status, 403);
    });

    it("treats a deleted venue as missing and leaves it alone", async () => {
      const venueId = await newVenue("Gone Courts");
      assert.equal((await getSettings(venueId)).status, 200);
      assert.equal((await call("DELETE", `/admin/venues/${venueId}`)).status, 200);

      assert.equal((await getSettings(venueId)).status, 404);
      assert.equal((await putSettings({ maxBookingMinutes: 60 }, venueId)).status, 404);
      assert.equal((await call("POST", `/admin/booking-settings/${venueId}/link`)).status, 404);
      assert.equal((await call("DELETE", `/admin/booking-settings/${venueId}/link`)).status, 404);

      const [[row]] = await ctx.sql.query(
        `SELECT maxBookingMinutes, bookingToken FROM venues WHERE venueId = ?`,
        [venueId]
      );
      assert.equal(row.maxBookingMinutes, 180);
      assert.equal(row.bookingToken, null);
    });
  });

  describe("price quote", () => {
    const rates = [
      { courtId: null, name: "Off-peak", daysOfWeek: [1, 2, 3, 4, 5], startMinutes: 360, endMinutes: 1020, pricePerHour: 300 },
      { courtId: null, name: "Peak", daysOfWeek: [1, 2, 3, 4, 5], startMinutes: 1020, endMinutes: 1320, pricePerHour: 450.5 },
      { courtId: "show", name: "Show court", daysOfWeek: [1], startMinutes: 360, endMinutes: 1440, pricePerHour: 700 },
    ];

    it("adds up each booked hour's rate", () => {
      // 2026-11-23 is a Monday: 16:00 off-peak + 17:00 peak + 18:00 peak
      const q = quoteFromRates(rates, { courtId: "c1", startLocal: "2026-11-23 16:00:00", durationMinutes: 180 });
      assert.equal(q.bookable, true);
      assert.equal(q.price, 1201);
      assert.deepEqual(
        q.hours.map((h) => h.rateName),
        ["Off-peak", "Peak", "Peak"]
      );
    });

    it("uses a court's own rate before the venue's", () => {
      const q = quoteFromRates(rates, { courtId: "show", startLocal: "2026-11-23 18:00:00", durationMinutes: 60 });
      assert.equal(q.price, 700);
    });

    it("refuses an hour with no rate, a start off the hour and a part-hour length", () => {
      // Sunday has no rate
      assert.equal(
        quoteFromRates(rates, { courtId: "c1", startLocal: "2026-11-22 10:00:00", durationMinutes: 60 }).reason,
        "NO_RATE"
      );
      // 21:00 peak, then 22:00 has no rate
      const late = quoteFromRates(rates, { courtId: "c1", startLocal: "2026-11-23 21:00:00", durationMinutes: 120 });
      assert.equal(late.reason, "NO_RATE");
      assert.equal(late.at, "2026-11-23 22:00:00");
      assert.equal(
        quoteFromRates(rates, { courtId: "c1", startLocal: "2026-11-23 16:30:00", durationMinutes: 60 }).reason,
        "NOT_ON_THE_HOUR"
      );
      assert.equal(
        quoteFromRates(rates, { courtId: "c1", startLocal: "2026-11-23 16:00:00", durationMinutes: 90 }).reason,
        "BAD_LENGTH"
      );
    });
  });

  describe("closures", () => {
    it("adds, lists, reads, edits and removes a closure", async () => {
      const created = await call("POST", "/admin/closures", {
        venueId: home.venueId,
        startAt: at(48),
        endAt: at(52),
        reason: "Resurfacing",
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const { closureId } = created.data;

      const list = await call("GET", `/admin/closures?venueId=${home.venueId}`);
      assert.equal(list.status, 200);
      const listed = list.data.closures.find((c) => c.closureId === closureId);
      assert.ok(listed);
      assert.equal(listed.courtId, null); // the whole venue

      const edited = await call("PUT", `/admin/closures/${closureId}`, {
        courtId: home.courtId,
        startAt: at(48),
        endAt: at(50),
        reason: "Net repair",
      });
      assert.equal(edited.status, 200, JSON.stringify(edited.body));
      const one = await call("GET", `/admin/closures/${closureId}`);
      assert.equal(one.data.closure.courtId, home.courtId);
      assert.equal(one.data.closure.reason, "Net repair");
      assert.equal(one.data.closure.endAt, at(50));

      assert.equal((await call("DELETE", `/admin/closures/${closureId}`)).status, 200);
      const upcoming = await call("GET", `/admin/closures?venueId=${home.venueId}`);
      assert.ok(!upcoming.data.closures.some((c) => c.closureId === closureId));
    });

    it("treats a deleted closure as missing and leaves it alone", async () => {
      const { closureId } = (
        await call("POST", "/admin/closures", { venueId: home.venueId, startAt: at(60), endAt: at(61) })
      ).data;
      assert.equal((await call("DELETE", `/admin/closures/${closureId}`)).status, 200);

      assert.equal((await call("GET", `/admin/closures/${closureId}`)).status, 404);
      assert.equal(
        (await call("PUT", `/admin/closures/${closureId}`, { startAt: at(70), endAt: at(71) })).status,
        404
      );
      assert.equal((await call("DELETE", `/admin/closures/${closureId}`)).status, 404);

      const [[row]] = await ctx.sql.query(
        `SELECT startAt, status FROM court_closures WHERE closureId = ?`,
        [closureId]
      );
      assert.equal(row.startAt, at(60));
      assert.equal(row.status, "Deleted");
    });

    it("refuses a backwards or finished window and another venue's court", async () => {
      const backwards = await call("POST", "/admin/closures", {
        venueId: home.venueId,
        startAt: at(10),
        endAt: at(9),
      });
      assert.equal(backwards.status, 400);

      const past = await call("POST", "/admin/closures", {
        venueId: home.venueId,
        startAt: at(-5),
        endAt: at(-2),
      });
      assert.equal(past.status, 400);

      const elsewhere = await newCourt(await newVenue("Far Courts"));
      const foreign = await call("POST", "/admin/closures", {
        venueId: home.venueId,
        courtId: elsewhere,
        startAt: at(10),
        endAt: at(11),
      });
      assert.equal(foreign.status, 400);

      assert.equal(
        (await call("POST", "/admin/closures", { venueId: home.venueId, startAt: at(10), endAt: at(11) }, viewer))
          .status,
        403
      );
    });

    it("lists the bookings in the way, and cancels them only when asked", async () => {
      const courtId = await newCourt();
      const bookingId = await insertBooking({
        courtId,
        startAt: at(30),
        endAt: at(32),
        status: "Confirmed",
      });
      // An expired hold doesn't hold its slot
      const expiredHold = await insertBooking({
        courtId,
        startAt: at(31),
        endAt: at(32),
        status: "Pending",
        holdExpiresAt: at(-1),
      });

      const window = { venueId: home.venueId, courtId, startAt: at(29), endAt: at(33), reason: "Event" };
      const refused = await call("POST", "/admin/closures", window);
      assert.equal(refused.status, 409);
      assert.equal(refused.body.code, "BOOKINGS_IN_THE_WAY");
      assert.equal(refused.body.error.conflicts.length, 1);
      assert.equal(refused.body.error.conflicts[0].playerName, "Test Player");

      const [[still]] = await ctx.sql.query(`SELECT status FROM bookings WHERE bookingId = ?`, [bookingId]);
      assert.equal(still.status, "Confirmed");

      const forced = await call("POST", "/admin/closures", { ...window, cancelConflicts: true });
      assert.equal(forced.status, 201, JSON.stringify(forced.body));

      const [[cancelled]] = await ctx.sql.query(
        `SELECT status, cancelledBy, cancelReason FROM bookings WHERE bookingId = ?`,
        [bookingId]
      );
      assert.equal(cancelled.status, "Cancelled");
      assert.equal(cancelled.cancelledBy, "Staff");
      assert.equal(cancelled.cancelReason, "Court closed: Event");

      const [[untouched]] = await ctx.sql.query(`SELECT status FROM bookings WHERE bookingId = ?`, [
        expiredHold,
      ]);
      assert.equal(untouched.status, "Pending");
    });

    it("can't close a court while a game is on it", async () => {
      const courtId = await newCourt(home.venueId, true);
      const game = await call("POST", "/admin/sessions", { courtId, startNow: true, durationMinutes: 60 });
      assert.equal(game.status, 201, JSON.stringify(game.body));

      const refused = await call("POST", "/admin/closures", {
        venueId: home.venueId,
        startAt: at(0),
        endAt: at(3),
        cancelConflicts: true,
      });
      assert.equal(refused.status, 409);
      assert.match(refused.body.message, /game/);
    });
  });

  describe("court timeline", () => {
    it("finds games, live bookings and closures in the way, earliest first", async () => {
      const courtId = await newCourt(home.venueId, true);
      const window = { courtId, startLocal: at(100), endLocal: at(104) };
      assert.equal(await findConflict(ctx.sql, window), null);

      await insertBooking({ courtId, startAt: at(102), endAt: at(103), status: "Confirmed" });
      let found = await findConflict(ctx.sql, window);
      assert.equal(found.type, "BOOKING");
      assert.equal(found.from, at(102));

      const closure = await call("POST", "/admin/closures", {
        venueId: home.venueId,
        startAt: at(101),
        endAt: at(102),
      });
      assert.equal(closure.status, 201, JSON.stringify(closure.body));
      found = await findConflict(ctx.sql, window);
      assert.equal(found.type, "CLOSURE");
      assert.equal(found.from, at(101));

      // Its own booking doesn't block a move or a check-in
      const bookingId = await insertBooking({ courtId, startAt: at(110), endAt: at(111), status: "Confirmed" });
      assert.equal(
        await findConflict(ctx.sql, {
          courtId,
          startLocal: at(110),
          endLocal: at(111),
          ignoreBookingId: bookingId,
        }),
        null
      );
    });

    it("refuses outside opening hours when asked to", async () => {
      const venueId = await newVenue("Hours Courts");
      const courtId = await newCourt(venueId);
      const start = moment.tz(at(200), FORMAT, "Asia/Manila");
      const day = start.day();
      const saved = await putSettings(
        { hours: [{ dayOfWeek: day, opensAt: "06:00", closesAt: "22:00" }] },
        venueId
      );
      assert.equal(saved.status, 200, JSON.stringify(saved.body));

      const on = (hour, minutes) => {
        const s = start.clone().hours(hour).minutes(0).seconds(0);
        return { courtId, startLocal: s.format(FORMAT), endLocal: s.clone().add(minutes, "minutes").format(FORMAT), checkHours: true };
      };
      assert.equal(await findConflict(ctx.sql, on(6, 120)), null);
      assert.equal(await findConflict(ctx.sql, on(21, 60)), null);
      assert.equal((await findConflict(ctx.sql, on(21, 120))).type, "CLOSED");
      assert.equal((await findConflict(ctx.sql, on(5, 60))).type, "CLOSED");
      // The next day is closed
      const nextDay = { ...on(10, 60) };
      nextDay.startLocal = start.clone().add(1, "day").hours(10).minutes(0).seconds(0).format(FORMAT);
      nextDay.endLocal = start.clone().add(1, "day").hours(11).minutes(0).seconds(0).format(FORMAT);
      assert.equal((await findConflict(ctx.sql, nextDay)).type, "CLOSED");
      // Without checkHours, hours don't matter
      assert.equal(await findConflict(ctx.sql, { ...on(5, 60), checkHours: false }), null);
    });
  });
});
