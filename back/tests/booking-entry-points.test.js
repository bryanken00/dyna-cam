// CR-030 — a way in for players: the public list of venues taking online
// bookings, "Find my booking" by code + phone or email, and the venue's booking
// link on a court's QR page.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

const FORMAT = "YYYY-MM-DD HH:mm:ss";
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const ALL_DAY = EVERY_DAY.map((dayOfWeek) => ({ dayOfWeek, opensAt: "00:00", closesAt: "24:00" }));
const NO_MATCH = /No booking matches/;

describe("player booking entry points (CR-030)", () => {
  let ctx;
  let admin;
  let moment;
  let home;

  const call = (method, url, body) => ctx.api(method, url, { token: admin.token, body });
  const pub = (method, url, body) => ctx.api(method, url, { body });

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
    const res = await pub("POST", `/public/book/${token}/bookings`, {
      courtKey: courts[0].key,
      date: start.slice(0, 10),
      startTime: start.slice(11, 16),
      durationMinutes: 60,
      playerName: "Bea Santos",
      phone,
      email,
      payMethod: "Desk",
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
    it("finds a booking by its code and email (any case) or phone (any format)", async () => {
      const made = await book(home.token);
      const spaced = `${made.bookingCode.slice(0, 3)} ${made.bookingCode.slice(3)}`.toLowerCase();

      for (const [code, contact] of [
        [made.bookingCode, "bea@example.com"],
        [spaced, "BEA@EXAMPLE.COM"],
        [made.bookingCode, "0917 123 4567"],
        [made.bookingCode, "09171234567"],
        [made.bookingCode, "+63 917 123 4567"],
      ]) {
        const res = await find(code, contact);
        assert.equal(res.status, 200, `${code} / ${contact}: ${JSON.stringify(res.body)}`);
        assert.equal(res.data.manageToken, made.manageToken);
        assert.ok(res.data.manageUrl.endsWith(`/booking/${made.manageToken}`), res.data.manageUrl);
      }
    });

    it("answers every miss with the same 404", async () => {
      const made = await book(home.token, {
        phone: "0918 765 4321",
        email: "carlo@example.com",
        hoursAhead: 32,
      });
      const other = made.bookingCode === "ZZZZZZ" ? "YYYYYY" : "ZZZZZZ";
      for (const [code, contact] of [
        [made.bookingCode, "someone@example.com"],
        [made.bookingCode, "0917 000 0000"],
        [other, "carlo@example.com"],
      ]) {
        const res = await find(code, contact);
        assert.equal(res.status, 404, `${code} / ${contact}`);
        assert.match(res.body.message, NO_MATCH);
      }
    });

    it("refuses a contact that is neither a phone number nor an email", async () => {
      const res = await find("ABC123", "hello");
      assert.equal(res.status, 400);
    });

    it("doesn't find a deleted booking, and leaves it as it was", async () => {
      const made = await book(home.token, {
        phone: "0919 222 3333",
        email: "dee@example.com",
        hoursAhead: 34,
      });
      const { db } = ctx;
      await db.query(`UPDATE bookings SET status = 'Deleted' WHERE bookingCode = ?`, [
        made.bookingCode,
      ]);
      const res = await find(made.bookingCode, "dee@example.com");
      assert.equal(res.status, 404);
      assert.match(res.body.message, NO_MATCH);
      const [row] = await db.query(`SELECT status FROM bookings WHERE bookingCode = ?`, [
        made.bookingCode,
      ]);
      assert.equal(row.status, "Deleted");
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
