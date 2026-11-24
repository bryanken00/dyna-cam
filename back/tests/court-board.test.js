// CR-038 — a venue's TV court board: a public link (venues.displayToken) staff
// turn on from the venue page, showing today's courts as booked / in play /
// closed — never a name, a booking code, a closure's reason or a business ID.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

const FORMAT = "YYYY-MM-DD HH:mm:ss";
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const ALL_DAY = EVERY_DAY.map((dayOfWeek) => ({ dayOfWeek, opensAt: "00:00", closesAt: "24:00" }));

describe("TV court board (CR-038)", () => {
  let ctx;
  let admin;
  let viewer;
  let moment;
  const home = {};

  const call = (method, url, body, who = admin) => ctx.api(method, url, { token: who.token, body });
  const pub = (method, url) => ctx.api(method, url);
  const tokenOf = (displayUrl) => displayUrl.split("/board/")[1];

  /** Today, `hoursFromNow` hours from the current hour, as a Manila timestamp. */
  const at = (hoursFromNow) =>
    moment().tz("Asia/Manila").startOf("hour").add(hoursFromNow, "hours").format(FORMAT);

  before(async () => {
    ctx = await startTestApp();
    admin = await ctx.createStaff("Admin", { access: "write" });
    viewer = await ctx.createStaff("Viewer", { access: "read" });
    ({ moment } = await ctx.importFromBack("server/src/utils/dateUtils.js"));

    home.venueId = (await call("POST", "/admin/venues", { name: "Board Courts" })).data.venueId;
    const court = await call("POST", "/admin/courts", {
      venueId: home.venueId,
      name: "Court A",
      cameraRtspUrl: "rtsp://u:p@10.0.9.1:554/stream1",
    });
    home.courtId = court.data.courtId;
    const saved = await call("PUT", `/admin/booking-settings/${home.venueId}`, {
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

  it("is off until staff turn it on; only write access can", async () => {
    const settings = await call("GET", `/admin/booking-settings/${home.venueId}`);
    assert.equal(settings.status, 200, JSON.stringify(settings.body));
    assert.equal(settings.data.settings.displayUrl, null);
    assert.equal((await pub("GET", "/public/board/AAAAAAAAAAAAAAAAAAAAAA")).status, 404);

    const refused = await call("POST", `/admin/booking-settings/${home.venueId}/display-link`, undefined, viewer);
    assert.equal(refused.status, 403);

    const issued = await call("POST", `/admin/booking-settings/${home.venueId}/display-link`);
    assert.equal(issued.status, 200, JSON.stringify(issued.body));
    assert.match(issued.data.displayUrl, /\/board\/[A-Za-z0-9_-]{16,64}$/);
    home.token = tokenOf(issued.data.displayUrl);
  });

  it("shows today's courts, bookings, games and closures — without names, codes, reasons or IDs", async () => {
    // Late in the day the next hours run into tomorrow; keep everything today
    const hour = Number(moment().tz("Asia/Manila").format("H"));
    if (hour >= 21) return;
    const s = at(1);
    const booked = await call("POST", "/admin/bookings", {
      courtId: home.courtId,
      date: s.slice(0, 10),
      startTime: s.slice(11, 16),
      durationMinutes: 60,
      playerName: "Secret Player",
      phone: "0917 123 4567",
      email: "secret@example.com",
      payment: "Cash",
    });
    assert.equal(booked.status, 201, JSON.stringify(booked.body));
    const closure = await call("POST", "/admin/closures", {
      venueId: home.venueId,
      startAt: at(2),
      endAt: at(3),
      reason: "Private tournament",
    });
    assert.equal(closure.status, 201, JSON.stringify(closure.body));

    const res = await pub("GET", `/public/board/${home.token}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const board = res.data;
    assert.equal(board.venue.name, "Board Courts");
    assert.equal(board.date, moment().tz("Asia/Manila").format("YYYY-MM-DD"));
    assert.equal(board.courts.length, 1);
    assert.equal(board.courts[0].name, "Court A");
    assert.match(board.courts[0].key, /^[a-f0-9]{16}$/);

    const [b] = board.bookings;
    assert.deepEqual(Object.keys(b).sort(), ["courtKey", "endAt", "startAt", "status"]);
    assert.equal(b.courtKey, board.courts[0].key);
    assert.equal(b.status, "Confirmed");
    assert.equal(b.startAt, at(1));
    const [c] = board.closures;
    assert.deepEqual(c, { courtKey: null, startAt: at(2), endAt: at(3) });

    // Nothing private, anywhere in the reply
    const text = JSON.stringify(res.body);
    for (const secret of [
      "Secret Player",
      "secret@example.com",
      "0917",
      booked.data.bookingCode,
      booked.data.bookingId,
      home.courtId,
      home.venueId,
      "Private tournament",
    ]) {
      assert.ok(!text.includes(secret), `board leaks ${secret}`);
    }
  });

  it("shows a staff game as a game on its court", async () => {
    const court = await call("POST", "/admin/courts", {
      venueId: home.venueId,
      name: "Court B",
      cameraRtspUrl: "rtsp://u:p@10.0.9.2:554/stream1",
    });
    const game = await call("POST", "/admin/sessions", {
      courtId: court.data.courtId,
      startNow: true,
      durationMinutes: 30,
      playerName: "Walk In Name",
    });
    assert.equal(game.status, 201, JSON.stringify(game.body));
    const res = await pub("GET", `/public/board/${home.token}`);
    const courtB = res.data.courts.find((x) => x.name === "Court B");
    const g = res.data.games.find((x) => x.courtKey === courtB.key);
    assert.ok(g, JSON.stringify(res.data.games));
    assert.equal(g.status, "Recording");
    assert.ok(!JSON.stringify(res.body).includes("Walk In Name"));
  });

  it("a new link retires the old one; turning it off retires both", async () => {
    const old = home.token;
    const issued = await call("POST", `/admin/booking-settings/${home.venueId}/display-link`);
    const fresh = tokenOf(issued.data.displayUrl);
    assert.equal((await pub("GET", `/public/board/${old}`)).status, 404);
    assert.equal((await pub("GET", `/public/board/${fresh}`)).status, 200);

    const settings = await call("GET", `/admin/booking-settings/${home.venueId}`);
    assert.ok(settings.data.settings.displayUrl.endsWith(`/board/${fresh}`));

    const off = await call("DELETE", `/admin/booking-settings/${home.venueId}/display-link`);
    assert.equal(off.status, 200);
    assert.equal((await pub("GET", `/public/board/${fresh}`)).status, 404);
  });

  it("a deleted venue's board stops working, and its link can't be issued", async () => {
    const venueId = (await call("POST", "/admin/venues", { name: "Gone Courts" })).data.venueId;
    const issued = await call("POST", `/admin/booking-settings/${venueId}/display-link`);
    const token = tokenOf(issued.data.displayUrl);
    assert.equal((await pub("GET", `/public/board/${token}`)).status, 200);
    assert.equal((await call("DELETE", `/admin/venues/${venueId}`)).status, 200);
    assert.equal((await pub("GET", `/public/board/${token}`)).status, 404);
    assert.equal((await call("POST", `/admin/booking-settings/${venueId}/display-link`)).status, 404);
  });

  it("rejects a malformed link", async () => {
    assert.equal((await pub("GET", "/public/board/not a token")).status, 400);
  });
});
