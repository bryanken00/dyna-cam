// PLAN-009 — the player app (web-app/) has its own address, PLAYER_APP_URL. The
// player links the API builds (a venue's booking page, a booking's own link — in
// emails and as the Xendit return — and the end of a Google sign-in) go there;
// the game, clip, stream and TV board pages stay on APP_URL. Without
// PLAYER_APP_URL every link stays on APP_URL, as before.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const ALL_DAY = EVERY_DAY.map((dayOfWeek) => ({ dayOfWeek, opensAt: "00:00", closesAt: "24:00" }));
const WEB = "http://web.test";
const PLAY = "http://play.test";

describe("player app address (PLAN-009)", () => {
  let ctx;
  let admin;
  let links;
  let signIn;
  let venueId;

  const call = (method, url, body) => ctx.api(method, url, { token: admin.token, body });

  before(async () => {
    ctx = await startTestApp({ env: { APP_URL: WEB, PLAYER_APP_URL: `${PLAY}/` } });
    admin = await ctx.createStaff("Admin", { access: "write" });
    links = await ctx.importFromBack("server/src/utils/clips.js");
    signIn = await ctx.importFromBack("server/src/utils/googleSignIn.js");

    venueId = (await call("POST", "/admin/venues", { name: "Player App Courts" })).data.venueId;
    const saved = await call("PUT", `/admin/booking-settings/${venueId}`, {
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
  after(async () => {
    await ctx?.stop();
  });

  it("gives staff a booking link on the player app", async () => {
    const link = await call("POST", `/admin/booking-settings/${venueId}/link`);
    assert.equal(link.status, 200, JSON.stringify(link.body));
    assert.match(link.data.bookingUrl, /^http:\/\/play\.test\/book\/[A-Za-z0-9_-]+$/);
  });

  it("sends player links to the player app and the rest to the main app", () => {
    assert.equal(links.bookingPageUrl("abc"), `${PLAY}/book/abc`);
    assert.equal(links.bookingManageUrl("abc"), `${PLAY}/booking/abc`);
    assert.equal(signIn.signedInUrl({ code: "c", next: "/me/games" }), `${PLAY}/signed-in?code=c&next=%2Fme%2Fgames`);

    assert.equal(links.courtBoardUrl("abc"), `${WEB}/board/abc`);
    assert.equal(links.sessionShareUrl("abc"), `${WEB}/session/abc`);
    assert.equal(links.clipShareUrl("abc"), `${WEB}/clip/abc`);
    assert.equal(links.streamSetupUrl("abc"), `${WEB}/stream/abc`);
  });

  it("keeps every link on the main app while PLAYER_APP_URL is empty", () => {
    const saved = process.env.PLAYER_APP_URL;
    try {
      process.env.PLAYER_APP_URL = "";
      assert.equal(links.bookingManageUrl("abc"), `${WEB}/booking/abc`);
      assert.equal(links.bookingPageUrl("abc"), `${WEB}/book/abc`);
      assert.equal(signIn.signedInUrl({ error: "off" }), `${WEB}/signed-in?error=off`);
    } finally {
      process.env.PLAYER_APP_URL = saved;
    }
  });

  it("lets a sign-in return to the profile page", () => {
    assert.equal(signIn.safeReturnPath("/me/profile"), "/me/profile");
    assert.equal(signIn.safeReturnPath("/me/profiles"), signIn.DEFAULT_RETURN_PATH);
  });
});
