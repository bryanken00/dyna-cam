// PLAN-009 phase F — clubs and coaching: a venue's clubs (open to join, or with approval),
// sessions only a club's members may join, and clinics (coached Open Play sessions).
// Company-scoped; the public pages carry no business IDs.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const ALL_DAY = EVERY_DAY.map((dayOfWeek) => ({ dayOfWeek, opensAt: "00:00", closesAt: "24:00" }));

describe("clubs and coaching (PLAN-009 phase F)", () => {
  let ctx;
  let admin;
  let moment;
  let n = 0;
  const home = {};

  const call = (method, url, body) => ctx.api(method, url, { token: admin.token, body: body ?? undefined });
  const as = (p, method, url, body) => ctx.api(method, url, { player: p.token, body: body ?? undefined });
  const day = (d) => moment().tz("Asia/Manila").add(d, "days").format("YYYY-MM-DD");
  const player = () => {
    n += 1;
    return ctx.signInPlayer({ email: `club${n}@example.test`, name: `Club${n} Member` });
  };
  const session = (over = {}) =>
    call("POST", "/admin/open-play/sessions", {
      venueId: home.venueId,
      title: "Club Night",
      date: day(3),
      startTime: "18:00",
      endTime: "20:00",
      courtIds: [home.courtId],
      capacity: 8,
      pricePerHead: 0,
      ...over,
    });

  before(async () => {
    ctx = await startTestApp();
    admin = await ctx.createStaff("Admin", { access: "write" });
    ({ moment } = await ctx.importFromBack("server/src/utils/dateUtils.js"));
    home.venueId = (await call("POST", "/admin/venues", { name: "Club Courts" })).data.venueId;
    home.courtId = (await call("POST", "/admin/courts", { venueId: home.venueId, name: "Court 1" })).data.courtId;
    home.otherVenueId = (await call("POST", "/admin/venues", { name: "Other Courts" })).data.venueId;
    await call("PUT", `/admin/booking-settings/${home.venueId}`, {
      maxBookingMinutes: 180,
      bookingDaysAhead: 14,
      deskHoldMinutes: 30,
      onlineHoldMinutes: 15,
      cancelCutoffHours: 24,
      checkInEarlyMinutes: 10,
      hours: ALL_DAY,
      rates: [{ name: "All day", daysOfWeek: EVERY_DAY, startTime: "00:00", endTime: "24:00", pricePerHour: 300 }],
    });
  });
  after(async () => {
    await ctx?.stop();
  });

  it("adds clubs and lists them publicly with no business IDs", async () => {
    const open = await call("POST", "/admin/clubs", { venueId: home.venueId, name: "Dink Society", joinPolicy: "Open" });
    assert.equal(open.status, 201, JSON.stringify(open.body));
    home.openClub = { id: open.data.clubId, token: open.data.shareUrl.split("/clubs/")[1] };
    const closed = await call("POST", "/admin/clubs", { venueId: home.venueId, name: "Elite Squad", joinPolicy: "Approval" });
    home.closedClub = { id: closed.data.clubId, token: closed.data.shareUrl.split("/clubs/")[1] };
    const list = await ctx.api("GET", "/public/clubs");
    assert.deepEqual(list.data.clubs.map((c) => c.name).sort(), ["Dink Society", "Elite Squad"]);
    const text = JSON.stringify(list.body);
    assert.ok(!text.includes(home.openClub.id) && !text.includes(home.venueId));
  });

  it("joins an open club at once, asks to join an approval club, and staff approve", async () => {
    const ana = await player();
    home.ana = ana;
    assert.equal((await as(ana, "POST", `/player/clubs/${home.openClub.token}/join`)).data.status, "Active");
    assert.equal((await as(ana, "POST", `/player/clubs/${home.closedClub.token}/join`)).data.status, "Pending");
    const mine = await as(ana, "GET", "/player/clubs");
    assert.deepEqual(mine.data.clubs.map((c) => [c.name, c.status]), [
      ["Dink Society", "Active"],
      ["Elite Squad", "Pending"],
    ]);
    const detail = await call("GET", `/admin/clubs/${home.closedClub.id}`);
    const pending = detail.data.members[0];
    assert.equal(pending.status, "Pending");
    assert.equal((await call("PUT", `/admin/clubs/members/${pending.clubMemberId}`, { status: "Active" })).status, 200);
    assert.equal((await as(ana, "GET", "/player/clubs")).data.clubs.every((c) => c.status === "Active"), true);
  });

  it("leaves and rejoins: an approval club asks again", async () => {
    assert.equal((await as(home.ana, "POST", `/player/clubs/${home.closedClub.token}/leave`)).status, 200);
    assert.equal((await as(home.ana, "POST", `/player/clubs/${home.closedClub.token}/join`)).data.status, "Pending");
  });

  it("limits a session to a club's members", async () => {
    const made = await session({ clubId: home.openClub.id });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const token = made.data.shareUrl.split("/open-play/")[1];
    const outsider = await player();
    const refused = await as(outsider, "POST", `/player/play/sessions/${token}/join`);
    assert.equal(refused.status, 403);
    assert.match(refused.body.message, /Dink Society/);
    assert.equal((await as(home.ana, "POST", `/player/play/sessions/${token}/join`)).status, 201);
    const page = await ctx.api("GET", `/public/open-play/${token}`);
    assert.deepEqual(page.data.session.club, { key: home.openClub.token, name: "Dink Society" });
    const clubPage = await ctx.api("GET", `/public/clubs/${home.openClub.token}`);
    assert.equal(clubPage.data.club.sessions[0].key, token);
    assert.deepEqual(clubPage.data.club.people.map((p) => p.firstName), ["Club1"]);
  });

  it("refuses a club of another venue", async () => {
    const other = await call("POST", "/admin/clubs", { venueId: home.otherVenueId, name: "Elsewhere Club" });
    const res = await session({ clubId: other.data.clubId, date: day(4) });
    assert.equal(res.status, 400);
  });

  it("lists clinics with their coach", async () => {
    const res = await session({ kind: "Clinic", title: "Third Shot Clinic", coachName: "Coach Rina", date: day(5) });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const list = await ctx.api("GET", `/public/open-play?from=${day(0)}&days=7&kind=Clinic`);
    assert.deepEqual(list.data.sessions.map((s) => [s.title, s.coachName, s.kind]), [["Third Shot Clinic", "Coach Rina", "Clinic"]]);
  });

  it("is a 404 for another company's staff, and for a Deleted club", async () => {
    const other = (await ctx.createCompany("Club Rivals")).owner;
    assert.equal((await ctx.api("GET", `/admin/clubs/${home.openClub.id}`, { token: other.token })).status, 404);
    const detail = await call("GET", `/admin/clubs/${home.openClub.id}`);
    const member = detail.data.members[0];
    const res = await ctx.api("PUT", `/admin/clubs/members/${member.clubMemberId}`, { token: other.token, body: { status: "Removed" } });
    assert.equal(res.status, 404);
    assert.equal((await ctx.api("GET", "/admin/clubs", { token: other.token })).data.clubs.length, 0);

    assert.equal((await call("DELETE", `/admin/clubs/${home.closedClub.id}`)).status, 200);
    assert.equal((await call("GET", `/admin/clubs/${home.closedClub.id}`)).status, 404);
    assert.equal((await ctx.api("GET", `/public/clubs/${home.closedClub.token}`)).status, 404);
    assert.equal((await as(home.ana, "POST", `/player/clubs/${home.closedClub.token}/join`)).status, 404);
  });
});
