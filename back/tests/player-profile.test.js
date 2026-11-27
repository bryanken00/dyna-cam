// PLAN-009 phase B — a player's sport profile (level, DUPR, shown unverified),
// following venues, Book again, and what a venue's courts and facilities are
// like (Discover's filters): staff set court surface / indoor and the venue's
// amenities in Admin; the public venue list carries them with the venue's key
// and its followers, never a business ID.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const ALL_DAY = EVERY_DAY.map((dayOfWeek) => ({ dayOfWeek, opensAt: "00:00", closesAt: "24:00" }));
const SETTINGS = {
  maxBookingMinutes: 180,
  bookingDaysAhead: 14,
  deskHoldMinutes: 30,
  onlineHoldMinutes: 15,
  cancelCutoffHours: 24,
  checkInEarlyMinutes: 10,
  hours: ALL_DAY,
  rates: [{ name: "All day", daysOfWeek: EVERY_DAY, startTime: "00:00", endTime: "24:00", pricePerHour: 300 }],
};

describe("player profile, follows and venue facts (PLAN-009 phase B)", () => {
  let ctx;
  let admin;
  let moment;
  let ana;
  let ben;
  const home = {};

  const call = (method, url, body, who = admin) => ctx.api(method, url, { token: who.token, body });
  const as = (player, method, url, body) => ctx.api(method, url, { player: player.token, body });

  /** A venue taking online bookings with one court → { venueId, courtId, token }. */
  const openVenue = async (name, court = {}, venue = {}) => {
    const made = await call("POST", "/admin/venues", { name, ...venue });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const c = await call("POST", "/admin/courts", { venueId: made.data.venueId, name: "Court 1", ...court });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    assert.equal((await call("PUT", `/admin/booking-settings/${made.data.venueId}`, SETTINGS)).status, 200);
    const link = await call("POST", `/admin/booking-settings/${made.data.venueId}/link`);
    return { venueId: made.data.venueId, courtId: c.data.courtId, token: link.data.bookingUrl.split("/book/")[1] };
  };

  const listed = async (name) => (await ctx.api("GET", "/public/venues")).data.venues.find((v) => v.name === name);

  before(async () => {
    ctx = await startTestApp();
    admin = await ctx.createStaff("Admin", { access: "write" });
    ({ moment } = await ctx.importFromBack("server/src/utils/dateUtils.js"));
    Object.assign(
      home,
      await openVenue(
        "Profile Courts",
        { surface: "Synthetic", isIndoor: true },
        { amenities: ["Lights", "Parking", "Restrooms"] }
      )
    );
    ana = await ctx.signInPlayer({ email: "ana.profile@example.test", name: "Ana Profile" });
    ben = await ctx.signInPlayer({ email: "ben.profile@example.test", name: "Ben Profile" });
  });
  after(async () => {
    await ctx?.stop();
  });

  describe("venue facts in Admin", () => {
    it("keeps the venue's amenities in a fixed order, and a full edit can clear them", async () => {
      const got = await call("GET", `/admin/venues/${home.venueId}`);
      assert.deepEqual(got.data.venue.amenities, ["Parking", "Restrooms", "Lights"]);

      const other = await call("POST", "/admin/venues", { name: "Amenity Edit", amenities: ["Food"] });
      const venueId = other.data.venueId;
      const cleared = await call("PUT", `/admin/venues/${venueId}`, { name: "Amenity Edit", clipRetentionDays: 7 });
      assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
      assert.deepEqual((await call("GET", `/admin/venues/${venueId}`)).data.venue.amenities, []);
    });

    it("refuses an amenity that isn't on the list", async () => {
      const res = await call("POST", "/admin/venues", { name: "Bad Amenity", amenities: ["Sauna"] });
      assert.equal(res.status, 400);
    });

    it("keeps a court's surface and indoor flag on an edit that leaves them out, and clears them on ''", async () => {
      const read = async () => (await call("GET", `/admin/courts/${home.courtId}`)).data.court;
      assert.equal((await read()).surface, "Synthetic");
      assert.equal((await read()).isIndoor, true);

      assert.equal((await call("PUT", `/admin/courts/${home.courtId}`, { name: "Court 1" })).status, 200);
      assert.equal((await read()).surface, "Synthetic");
      assert.equal((await read()).isIndoor, true);

      const other = await openVenue("Surface Edit", { surface: "Wood", isIndoor: false });
      const id = other.courtId;
      assert.equal((await call("PUT", `/admin/courts/${id}`, { name: "Court 1", surface: "", isIndoor: null })).status, 200);
      const court = (await call("GET", `/admin/courts/${id}`)).data.court;
      assert.equal(court.surface, null);
      assert.equal(court.isIndoor, null);

      assert.equal((await call("PUT", `/admin/courts/${id}`, { name: "Court 1", surface: "Grass" })).status, 400);
    });
  });

  describe("the public venue list", () => {
    it("carries the venue's key, amenities, court facts and followers — no business IDs", async () => {
      const v = await listed("Profile Courts");
      assert.match(v.key, /^[0-9a-f]{16}$/);
      assert.deepEqual(v.amenities, ["Parking", "Restrooms", "Lights"]);
      assert.deepEqual(v.surfaces, ["Synthetic"]);
      assert.equal(v.indoorCourts, 1);
      assert.equal(v.outdoorCourts, 0);
      assert.equal(v.followers, 0);
      const body = JSON.stringify((await ctx.api("GET", "/public/venues")).body);
      assert.ok(!body.includes(home.venueId) && !body.includes(home.courtId));
    });
  });

  describe("sport profile", () => {
    it("starts empty and unverified", async () => {
      const res = await as(ana, "GET", "/player/sports");
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(res.data.sports, [
        { sport: "Pickleball", skillLevel: null, duprId: null, duprRating: null, duprVerified: false },
      ]);
    });

    it("saves a level and a typed-in DUPR, still unverified, and only for that player", async () => {
      const saved = await as(ana, "PUT", "/player/sports", {
        sport: "Pickleball",
        skillLevel: "High Intermediate",
        duprId: "ab12cd",
        duprRating: "3.5124",
      });
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      assert.deepEqual(saved.data.sports[0], {
        sport: "Pickleball",
        skillLevel: "High Intermediate",
        duprId: "AB12CD",
        duprRating: 3.512,
        duprVerified: false,
      });
      assert.equal((await as(ben, "GET", "/player/sports")).data.sports[0].skillLevel, null);

      // Clearing: omitted / "" answers are "not said"
      const cleared = await as(ana, "PUT", "/player/sports", { sport: "Pickleball", skillLevel: "Beginner", duprId: "" });
      assert.deepEqual(cleared.data.sports[0], {
        sport: "Pickleball",
        skillLevel: "Beginner",
        duprId: null,
        duprRating: null,
        duprVerified: false,
      });
    });

    it("refuses a rating outside DUPR's range, an unknown level and a signed-out caller", async () => {
      assert.equal((await as(ana, "PUT", "/player/sports", { sport: "Pickleball", duprRating: 9 })).status, 400);
      assert.equal((await as(ana, "PUT", "/player/sports", { sport: "Pickleball", skillLevel: "Pro" })).status, 400);
      assert.equal((await as(ana, "PUT", "/player/sports", { sport: "Tennis" })).status, 400);
      assert.equal((await ctx.api("GET", "/player/sports")).status, 401);
    });
  });

  describe("following venues", () => {
    it("follows and unfollows by the venue's key; followers count only Active follows", async () => {
      const { key } = await listed("Profile Courts");
      assert.equal((await as(ana, "POST", `/player/follows/${key}`)).status, 200);
      assert.equal((await as(ana, "POST", `/player/follows/${key}`)).status, 200); // twice = still one
      assert.equal((await as(ben, "POST", `/player/follows/${key}`)).status, 200);
      assert.equal((await listed("Profile Courts")).followers, 2);

      const mine = await as(ana, "GET", "/player/follows");
      assert.deepEqual(
        mine.data.venues.map((v) => [v.key, v.name, v.bookingToken]),
        [[key, "Profile Courts", home.token]]
      );

      assert.equal((await as(ben, "DELETE", `/player/follows/${key}`)).status, 200);
      assert.equal((await listed("Profile Courts")).followers, 1);
      assert.equal((await as(ben, "GET", "/player/follows")).data.venues.length, 0);
      assert.equal((await as(ana, "GET", "/player/follows")).data.venues.length, 1);
    });

    it("answers 404 for an unknown or Deleted venue's key and leaves nothing behind", async () => {
      const { venueKey } = await ctx.importFromBack("server/src/utils/venueFacts.js");
      assert.equal((await as(ana, "POST", `/player/follows/${"0".repeat(16)}`)).status, 404);
      assert.equal((await as(ana, "POST", "/player/follows/not-a-key")).status, 400);

      const gone = await openVenue("Gone Courts");
      assert.equal((await call("DELETE", `/admin/venues/${gone.venueId}`)).status, 200);
      assert.equal((await as(ana, "POST", `/player/follows/${venueKey(gone.venueId)}`)).status, 404);
      const [rows] = await ctx.sql.query(`SELECT COUNT(*) AS n FROM venue_follows WHERE venueId = ?`, [gone.venueId]);
      assert.equal(rows[0].n, 0);
    });

    it("drops a followed venue from the list once it's Deleted", async () => {
      const brief = await openVenue("Brief Courts");
      const { key } = await listed("Brief Courts");
      assert.equal((await as(ben, "POST", `/player/follows/${key}`)).status, 200);
      assert.equal((await call("DELETE", `/admin/venues/${brief.venueId}`)).status, 200);
      assert.ok(!(await as(ben, "GET", "/player/follows")).data.venues.some((v) => v.key === key));
    });
  });

  describe("Book again", () => {
    it("lists the venues the player booked, most recent first, and nobody else's", async () => {
      const page = await ctx.api("GET", `/public/book/${home.token}`);
      const courtKey = page.data.courts[0].key;
      const date = moment().tz("Asia/Manila").add(2, "days").format("YYYY-MM-DD");
      const booked = await ctx.api("POST", `/public/book/${home.token}/bookings`, {
        player: ana.token,
        body: { date, slots: [{ courtKey, startTime: "10:00" }] },
      });
      assert.equal(booked.status, 201, JSON.stringify(booked.body));

      const recent = await as(ana, "GET", "/player/recent-venues");
      assert.equal(recent.status, 200);
      assert.deepEqual(recent.data.venues.map((v) => v.name), ["Profile Courts"]);
      assert.equal(recent.data.venues[0].bookingToken, home.token);
      assert.deepEqual((await as(ben, "GET", "/player/recent-venues")).data.venues, []);
    });
  });
});
