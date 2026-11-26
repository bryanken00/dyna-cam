// CR-050 — a venue's address from the PH address list (PSGC codes + street) and its map
// pin (latitude / longitude); players get a Google Maps "Get directions" link from it.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

// Taytay, Rizal (CALABARZON) — codes from front/src/assets/address
const TAYTAY = {
  regionCode: "04",
  provinceCode: "0458",
  cityMunCode: "045813",
  barangayCode: "045813004",
  street: "12 Rizal Ave",
  address: "12 Rizal Ave, San Juan, Taytay, Rizal",
  latitude: 14.569231,
  longitude: 121.132411,
};

describe("venue address and map pin (CR-050)", () => {
  let ctx;
  let admin;
  const call = (method, url, body) => ctx.api(method, url, { token: admin.token, body });
  const venue = async (venueId) => (await call("GET", `/admin/venues/${venueId}`)).data.venue;

  before(async () => {
    ctx = await startTestApp();
    admin = await ctx.createStaff("Admin", { access: "write" });
  });
  after(async () => {
    await ctx?.stop();
  });

  it("saves and returns the address codes, street and pin", async () => {
    const made = await call("POST", "/admin/venues", { name: "Pinned Courts", ...TAYTAY });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const v = await venue(made.data.venueId);
    assert.equal(v.address, TAYTAY.address);
    assert.equal(v.regionCode, "04");
    assert.equal(v.provinceCode, "0458");
    assert.equal(v.cityMunCode, "045813");
    assert.equal(v.barangayCode, "045813004");
    assert.equal(v.street, "12 Rizal Ave");
    assert.equal(v.latitude, 14.569231);
    assert.equal(v.longitude, 121.132411);

    // Clearing the pin and the street ("" = not set)
    const cleared = await call("PUT", `/admin/venues/${made.data.venueId}`, {
      name: "Pinned Courts",
      clipRetentionDays: 7,
      ...TAYTAY,
      street: "",
      latitude: "",
      longitude: "",
    });
    assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
    const after = await venue(made.data.venueId);
    assert.equal(after.latitude, null);
    assert.equal(after.longitude, null);
    assert.equal(after.street, null);
    assert.equal(after.cityMunCode, "045813");
  });

  it("refuses half a pin, out-of-range coordinates and codes that aren't from the list", async () => {
    const bad = [
      { latitude: 14.5 },
      { longitude: 121.1 },
      { latitude: 91, longitude: 121 },
      { latitude: 14, longitude: 181 },
      { regionCode: "Region IV" },
    ];
    for (const body of bad) {
      const res = await call("POST", "/admin/venues", { name: `Bad ${JSON.stringify(body)}`, ...body });
      assert.equal(res.status, 400, JSON.stringify(body));
    }
  });

  it("gives players Google Maps directions only when the venue has a pin", async () => {
    const pinned = (await call("POST", "/admin/venues", { name: "Directions Courts", ...TAYTAY })).data.venueId;
    const plain = (await call("POST", "/admin/venues", { name: "No Pin Courts", address: "Somewhere" })).data.venueId;
    const tokens = {};
    for (const [key, venueId] of Object.entries({ pinned, plain })) {
      await call("POST", "/admin/courts", { venueId, name: "Court 1" });
      tokens[key] = (await call("POST", `/admin/booking-settings/${venueId}/link`)).data.bookingUrl.split("/book/")[1];
    }

    const page = await ctx.api("GET", `/public/book/${tokens.pinned}`);
    assert.equal(page.status, 200);
    assert.equal(
      page.data.venue.directionsUrl,
      "https://www.google.com/maps/dir/?api=1&destination=14.569231%2C121.132411"
    );
    assert.equal((await ctx.api("GET", `/public/book/${tokens.plain}`)).data.venue.directionsUrl, null);

    const list = await ctx.api("GET", "/public/venues");
    const byName = Object.fromEntries(list.data.venues.map((v) => [v.name, v]));
    assert.match(byName["Directions Courts"].directionsUrl, /destination=14\.569231%2C121\.132411$/);
    assert.equal(byName["No Pin Courts"].directionsUrl, null);
    // "Near me" sorts in the browser from each venue's public pin
    assert.equal(byName["Directions Courts"].latitude, 14.569231);
    assert.equal(byName["Directions Courts"].longitude, 121.132411);
    assert.equal(byName["No Pin Courts"].latitude, null);
  });

  it("puts Get directions in the booking confirmation emails, only with a pin", async () => {
    const { bookingConfirmedEmail, bookingOrderConfirmedEmail } = await ctx.importFromBack(
      "server/src/lib/mailer/templates.js"
    );
    const facts = {
      playerName: "Bea",
      venueName: "Directions Courts",
      courtName: "Court 1",
      day: "Fri, Nov 27, 2026",
      time: "6:00 PM – 7:00 PM",
      price: "₱300",
      manageUrl: "http://web.test/booking/abc",
      paidLine: "Paid ₱300 online",
    };
    const url = "https://www.google.com/maps/dir/?api=1&destination=14.5%2C121.1";
    assert.match(bookingConfirmedEmail({ ...facts, directionsUrl: url }).html, /Get directions/);
    assert.doesNotMatch(bookingConfirmedEmail({ ...facts, directionsUrl: null }).html, /Get directions/);
    const order = bookingOrderConfirmedEmail({
      playerName: "Bea",
      venueName: "Directions Courts",
      directionsUrl: url,
      day: "Fri, Nov 27, 2026",
      paidLine: "Paid ₱600 online",
      items: [{ courtName: "Court 1", time: "6:00 PM – 7:00 PM", manageUrl: "http://web.test/booking/a" }],
    });
    assert.match(order.html, /Get directions/);
  });
});
