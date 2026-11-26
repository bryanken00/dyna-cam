// CR-030 — a way in for players: the public list of venues taking online
// bookings and the venue's booking link on a court's QR page. ("Find my
// booking" by code + phone or email was removed by CR-045.)

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

const FORMAT = "YYYY-MM-DD HH:mm:ss";
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const ALL_DAY = EVERY_DAY.map((dayOfWeek) => ({ dayOfWeek, opensAt: "00:00", closesAt: "24:00" }));

describe("player booking entry points (CR-030)", () => {
  let ctx;
  let admin;
  let moment;
  let home;

  const call = (method, url, body) => ctx.api(method, url, { token: admin.token, body });
  const pub = (method, url, body) => ctx.api(method, url, { body });
  // PLAN-006: booking online needs a player signed in with Google — the body's
  // email / playerName say which player books (their account gives both)
  const bookAsPlayer = async (url, { email = "bea@example.com", playerName = "Bea Santos", ...body }) => {
    const player = await ctx.signInPlayer({ email, name: playerName });
    return ctx.api("POST", url, { player: player.token, body });
  };

  const settings = (hours = ALL_DAY) => ({
    maxBookingMinutes: 180,
    bookingDaysAhead: 14,
    deskHoldMinutes: 30,
    onlineHoldMinutes: 15,
    cancelCutoffHours: 24,
    checkInEarlyMinutes: 10,
    hours,
    rates: [
      {
        name: "All day",
        daysOfWeek: EVERY_DAY,
        startTime: "00:00",
        endTime: "24:00",
        pricePerHour: 350,
      },
    ],
  });

  /** A venue with courts and hours; online booking on unless `link: false` → { venueId, token, courtIds } */
  const setupVenue = async (name, { courts = ["Court A"], link = true, hours } = {}) => {
    const venueId = (await call("POST", "/admin/venues", { name })).data.venueId;
    const courtIds = [];
    for (const courtName of courts) {
      const court = await call("POST", "/admin/courts", { venueId, name: courtName });
      assert.equal(court.status, 201, JSON.stringify(court.body));
      courtIds.push(court.data.courtId);
    }
    const saved = await call("PUT", `/admin/booking-settings/${venueId}`, settings(hours));
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    let token = null;
    if (link) {
      const res = await call("POST", `/admin/booking-settings/${venueId}/link`);
      token = res.data.bookingUrl.split("/book/")[1];
    }
    return { venueId, token, courtIds };
  };

  const venues = async () => {
    const res = await pub("GET", "/public/venues");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.data.venues;
  };

  /** A desk-paid booking made online, `hoursAhead` from now → { bookingCode, manageToken } */
  const book = async (
    token,
    { phone = "0917 123 4567", email = "Bea@Example.com", hoursAhead = 30 } = {}
  ) => {
    const { courts } = (await pub("GET", `/public/book/${token}`)).data;
    const start = moment()
      .tz("Asia/Manila")
      .startOf("hour")
      .add(hoursAhead, "hours")
      .format(FORMAT);
    const res = await bookAsPlayer(`/public/book/${token}/bookings`, {
      courtKey: courts[0].key,
      date: start.slice(0, 10),
      startTime: start.slice(11, 16),
      durationMinutes: 60,
      playerName: "Bea Santos",
      phone,
      email,
          });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.data;
  };

  const find = (bookingCode, contact) =>
    pub("POST", "/public/bookings/find", { bookingCode, contact });

  before(async () => {
    ctx = await startTestApp({
      env: { RATE_LIMIT_PUBLIC_BOOK_POINTS: "1000", RATE_LIMIT_PUBLIC_FIND_POINTS: "1000" },
    });
    admin = await ctx.createStaff("Admin", { access: "write" });
    ({ moment } = await ctx.importFromBack("server/src/utils/dateUtils.js"));
    home = await setupVenue("Entry Courts", { courts: ["Court A", "Court B"] });
  });
  after(() => ctx?.stop());

  describe("GET /public/venues", () => {
    it("lists venues taking online bookings, with their link, courts and today's hours", async () => {
      const listed = (await venues()).find((v) => v.name === "Entry Courts");
      assert.ok(listed, "the venue is listed");
      assert.equal(listed.bookingToken, home.token);
      assert.equal(listed.courtCount, 2);
      assert.deepEqual(listed.todayHours, { opensAt: "00:00", closesAt: "24:00" });
      // No business IDs anywhere
      const body = JSON.stringify(await pub("GET", "/public/venues"));
      for (const id of [home.venueId, ...home.courtIds]) assert.ok(!body.includes(id));
    });

    it("says closed today when the venue doesn't open today", async () => {
      const today = moment().tz("Asia/Manila").day();
      const hours = ALL_DAY.filter((h) => h.dayOfWeek !== today);
      await setupVenue("Closed Today Courts", { hours });
      const listed = (await venues()).find((v) => v.name === "Closed Today Courts");
      assert.equal(listed.todayHours, null);
    });

    it("leaves out venues with booking off, Inactive, or no active court", async () => {
      await setupVenue("No Link Courts", { link: false });

      const off = await setupVenue("Turned Off Courts");
      assert.equal(
        (await call("DELETE", `/admin/booking-settings/${off.venueId}/link`)).status,
        200
      );

      const inactive = await setupVenue("Inactive Courts");
      const venueRow = (await call("GET", `/admin/venues/${inactive.venueId}`)).data.venue;
      const deactivated = await call("PUT", `/admin/venues/${inactive.venueId}`, {
        name: venueRow.name,
        clipRetentionDays: venueRow.clipRetentionDays,
        clipPrice: venueRow.clipPrice,
        status: "Inactive",
      });
      assert.equal(deactivated.status, 200, JSON.stringify(deactivated.body));

      const courtless = await setupVenue("Courtless Courts");
      assert.equal((await call("DELETE", `/admin/courts/${courtless.courtIds[0]}`)).status, 200);

      const names = (await venues()).map((v) => v.name);
      for (const name of [
        "No Link Courts",
        "Turned Off Courts",
        "Inactive Courts",
        "Courtless Courts",
      ]) {
        assert.ok(!names.includes(name), `${name} is not listed`);
      }
    });
  });

  describe("POST /public/bookings/find", () => {
    it("CR-045: is gone — players find their bookings in My games", async () => {
      const made = await book(home.token);
      const res = await find(made.bookingCode, "bea@example.com");
      assert.equal(res.status, 404);
      assert.equal(res.data, undefined, "no booking link handed out");
    });
  });

  describe("GET /public/courts/:qrToken", () => {
    const qrTokenOf = async (courtId) => {
      const [row] = await ctx.db.query(`SELECT qrToken FROM courts WHERE courtId = ?`, [courtId]);
      return row.qrToken;
    };

    it("gives the venue's booking link when it takes online bookings, null when not", async () => {
      const on = await pub("GET", `/public/courts/${await qrTokenOf(home.courtIds[0])}`);
      assert.equal(on.status, 200, JSON.stringify(on.body));
      assert.equal(on.data.court.bookingToken, home.token);

      const offVenue = await setupVenue("Walk-in Only Courts", { link: false });
      const off = await pub("GET", `/public/courts/${await qrTokenOf(offVenue.courtIds[0])}`);
      assert.equal(off.status, 200, JSON.stringify(off.body));
      assert.equal(off.data.court.bookingToken, null);
    });
  });
});
