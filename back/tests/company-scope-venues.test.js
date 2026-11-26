// PLAN-008 — the company rule for the venue / setup Admin modules: a company's staff
// see and change only their own company's venues, courts, closures, booking settings,
// clips and Dashboard. Another company's record answers 404 (never 403) and stays
// unchanged; another company's IDs can't be used in a body or filter.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

const FORMAT = "YYYY-MM-DD HH:mm:ss";

describe("company scope — venues, courts, closures, booking settings, clips, dashboard (PLAN-008)", () => {
  let ctx;
  let moment;
  let a; // company A's staff (the default company)
  let b; // company B's staff
  const home = {}; // company A's records

  const as = (who) => (method, url, body) => ctx.api(method, url, { token: who.token, body });
  const at = (hoursFromNow) =>
    moment().tz("Asia/Manila").startOf("hour").add(hoursFromNow, "hours").format(FORMAT);

  before(async () => {
    ctx = await startTestApp();
    ({ moment } = await ctx.importFromBack("server/src/utils/dateUtils.js"));
    a = await ctx.createStaff("Company A", { access: "write" });
    const companyB = await ctx.createCompany("Company B");
    b = await ctx.createStaff("Company B", { access: "write", company: companyB });
    b.owner = companyB.owner;

    const callA = as(a);
    home.venueId = (await callA("POST", "/admin/venues", { name: "Shared Name Courts" })).data.venueId;
    const court = await callA("POST", "/admin/courts", {
      venueId: home.venueId,
      name: "Court 1",
      cameraRtspUrl: "rtsp://u:p@10.0.30.1:554/stream1",
    });
    assert.equal(court.status, 201, JSON.stringify(court.body));
    home.courtId = court.data.courtId;
    const closure = await callA("POST", "/admin/closures", {
      venueId: home.venueId,
      startAt: at(48),
      endAt: at(50),
      reason: "Resurfacing",
    });
    assert.equal(closure.status, 201, JSON.stringify(closure.body));
    home.closureId = closure.data.closureId;
    // A clip saved at A's court (as a box would have made it)
    home.clipId = crypto.randomUUID();
    const now = at(0);
    await ctx.sql.query(
      `INSERT INTO clips (clipId, venueId, courtId, source, requestedAt, durationSeconds, shareToken,
                          status, dateCreated, dateUpdated)
       VALUES (?, ?, ?, 'QR', ?, 60, ?, 'Ready', ?, ?)`,
      [home.clipId, home.venueId, home.courtId, now, crypto.randomBytes(16).toString("hex"), now, now]
    );
    await ctx.pairBox(a.token, home.venueId, "Box A");
  });
  after(async () => {
    await ctx?.stop();
  });

  it("venues: B never lists, reads, edits or deletes A's venue; names are per company", async () => {
    const callB = as(b);
    const list = await callB("GET", "/admin/venues?pageSize=100");
    assert.equal(list.status, 200);
    assert.ok(!list.data.venues.some((v) => v.venueId === home.venueId));
    assert.equal((await callB("GET", `/admin/venues/${home.venueId}`)).status, 404);
    assert.equal(
      (await callB("PUT", `/admin/venues/${home.venueId}`, { name: "Taken over", clipRetentionDays: 7 }))
        .status,
      404
    );
    assert.equal((await callB("DELETE", `/admin/venues/${home.venueId}`)).status, 404);
    const [[row]] = await ctx.sql.query(`SELECT name, status FROM venues WHERE venueId = ?`, [home.venueId]);
    assert.deepEqual({ ...row }, { name: "Shared Name Courts", status: "Active" });

    // The same name is fine in another company
    const own = await callB("POST", "/admin/venues", { name: "Shared Name Courts" });
    assert.equal(own.status, 201, JSON.stringify(own.body));
    b.venueId = own.data.venueId;
    const [[company]] = await ctx.sql.query(`SELECT companyId FROM venues WHERE venueId = ?`, [b.venueId]);
    const [[staff]] = await ctx.sql.query(`SELECT companyId FROM users WHERE accountId = ?`, [b.accountId]);
    assert.equal(company.companyId, staff.companyId);

    // …and A doesn't see B's
    const listA = await as(a)("GET", "/admin/venues?pageSize=100");
    assert.ok(!listA.data.venues.some((v) => v.venueId === b.venueId));
    assert.equal((await as(a)("GET", `/admin/venues/${b.venueId}`)).status, 404);
  });

  it("courts: B can't see, change, preview, rotate, connect or delete A's court, or add one to A's venue", async () => {
    const callB = as(b);
    const list = await callB("GET", "/admin/courts?pageSize=100");
    assert.ok(!list.data.courts.some((c) => c.courtId === home.courtId));
    const filtered = await callB("GET", `/admin/courts?venueId=${home.venueId}`);
    assert.equal(filtered.data.courts.length, 0);
    const options = await callB("GET", "/admin/courts/options");
    assert.ok(!options.data.venues.some((v) => v.venueId === home.venueId));

    assert.equal((await callB("GET", `/admin/courts/${home.courtId}`)).status, 404);
    assert.equal((await callB("PUT", `/admin/courts/${home.courtId}`, { name: "Mine now" })).status, 404);
    assert.equal((await callB("POST", `/admin/courts/${home.courtId}/preview`)).status, 404);
    assert.equal((await callB("POST", `/admin/courts/${home.courtId}/rotate-qr`)).status, 404);
    assert.equal((await callB("DELETE", `/admin/courts/${home.courtId}/google-drive`)).status, 404);
    assert.equal((await callB("DELETE", `/admin/courts/${home.courtId}`)).status, 404);
    const intoA = await callB("POST", "/admin/courts", { venueId: home.venueId, name: "Sneaky" });
    assert.equal(intoA.status, 400);

    const [[row]] = await ctx.sql.query(
      `SELECT name, status, previewWantedUntil FROM courts WHERE courtId = ?`,
      [home.courtId]
    );
    assert.equal(row.name, "Court 1");
    assert.equal(row.status, "Active");
    assert.equal(row.previewWantedUntil, null);
    const [[{ n }]] = await ctx.sql.query(`SELECT COUNT(*) AS n FROM courts WHERE venueId = ?`, [home.venueId]);
    assert.equal(n, 1);

    // A still works on its own court
    assert.equal((await as(a)("GET", `/admin/courts/${home.courtId}`)).status, 200);
  });

  it("closures: B can't list, read, add to, change or remove A's", async () => {
    const callB = as(b);
    const list = await callB("GET", `/admin/closures?venueId=${home.venueId}&when=all`);
    assert.equal(list.status, 200);
    assert.equal(list.data.closures.length, 0);
    assert.equal((await callB("GET", `/admin/closures/${home.closureId}`)).status, 404);
    assert.equal(
      (
        await callB("PUT", `/admin/closures/${home.closureId}`, {
          startAt: at(60),
          endAt: at(61),
          reason: "Moved",
        })
      ).status,
      404
    );
    assert.equal((await callB("DELETE", `/admin/closures/${home.closureId}`)).status, 404);
    const add = await callB("POST", "/admin/closures", {
      venueId: home.venueId,
      startAt: at(70),
      endAt: at(71),
      reason: "Not yours",
    });
    assert.equal(add.status, 404);
    const [[row]] = await ctx.sql.query(`SELECT reason, status FROM court_closures WHERE closureId = ?`, [
      home.closureId,
    ]);
    assert.deepEqual({ ...row }, { reason: "Resurfacing", status: "Active" });
    const [[{ n }]] = await ctx.sql.query(`SELECT COUNT(*) AS n FROM court_closures WHERE venueId = ?`, [
      home.venueId,
    ]);
    assert.equal(n, 1);
  });

  it("booking settings: B can't read, save, or turn on/off A's links", async () => {
    const callB = as(b);
    assert.equal((await callB("GET", `/admin/booking-settings/${home.venueId}`)).status, 404);
    const save = await callB("PUT", `/admin/booking-settings/${home.venueId}`, {
      deskHoldMinutes: 30,
      onlineHoldMinutes: 15,
      cancelCutoffHours: 24,
      checkInEarlyMinutes: 10,
      hours: [],
      rates: [],
    });
    assert.equal(save.status, 404);
    for (const [method, path] of [
      ["POST", "link"],
      ["DELETE", "link"],
      ["POST", "display-link"],
      ["DELETE", "display-link"],
    ]) {
      assert.equal((await callB(method, `/admin/booking-settings/${home.venueId}/${path}`)).status, 404);
    }
    const [[row]] = await ctx.sql.query(`SELECT bookingToken, displayToken FROM venues WHERE venueId = ?`, [
      home.venueId,
    ]);
    assert.equal(row.bookingToken, null);
    assert.equal(row.displayToken, null);
    assert.equal((await as(a)("GET", `/admin/booking-settings/${home.venueId}`)).status, 200);
  });

  it("clips: B never lists, filters to or reads A's clip", async () => {
    const callB = as(b);
    const list = await callB("GET", "/admin/clips?pageSize=100");
    assert.equal(list.status, 200);
    assert.ok(!list.data.clips.some((c) => c.clipId === home.clipId));
    const filtered = await callB("GET", `/admin/clips?venueId=${home.venueId}`);
    assert.equal(filtered.data.clips.length, 0);
    const options = await callB("GET", "/admin/clips/options");
    assert.ok(!options.data.venues.some((v) => v.venueId === home.venueId));
    assert.ok(!options.data.courts.some((c) => c.courtId === home.courtId));
    assert.equal((await callB("GET", `/admin/clips/${home.clipId}`)).status, 404);

    const mine = await as(a)("GET", `/admin/clips/${home.clipId}`);
    assert.equal(mine.status, 200);
  });

  it("dashboard: B's board, boxes, figures, users and activity are B's only", async () => {
    const callB = as(b);
    const venues = await callB("GET", "/admin/dashboard/venues");
    assert.equal(venues.status, 200, JSON.stringify(venues.body));
    assert.ok(!venues.data.venues.courts.some((c) => c.courtId === home.courtId));
    assert.equal(venues.data.venues.boxes.total, 0);
    assert.equal(venues.data.venues.clipsToday, 0);

    const alerts = await callB("GET", "/admin/dashboard/alerts");
    assert.equal(alerts.status, 200);
    assert.equal(alerts.data.boxes.length, 0);

    const stats = await callB("GET", "/admin/dashboard/stats");
    assert.equal(stats.status, 200);
    // B's staff member only (its Owner is hidden)
    assert.equal(stats.data.stats.totalUsers, 1);
    const [[{ companyId: bCompany }]] = await ctx.sql.query(
      `SELECT companyId FROM users WHERE accountId = ?`,
      [b.accountId]
    );
    const [[{ n }]] = await ctx.sql.query(
      `SELECT COUNT(*) AS n FROM audit_trail WHERE companyId = ? AND dateCreated >= ?`,
      [bCompany, moment().tz("Asia/Manila").subtract(13, "days").format("YYYY-MM-DD 00:00:00")]
    );
    assert.equal(stats.data.stats.auditEvents, Number(n));

    const insights = await callB("GET", "/admin/dashboard/insights?days=7");
    assert.equal(insights.status, 200);
    assert.equal(insights.data.insights.gamesPlayed, 0);

    // A sees its own court and box
    const own = await as(a)("GET", "/admin/dashboard/venues");
    assert.ok(own.data.venues.courts.some((c) => c.courtId === home.courtId));
    assert.equal((await as(a)("GET", "/admin/dashboard/alerts")).data.boxes.length >= 1, true);
  });
});
