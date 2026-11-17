// CR-001 — without a Google OAuth client on the server, Drive is "not set up":
// the court says so and connecting is refused. (Its own file: the settings are
// read per process.)

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

describe("Google Drive not set up", () => {
  let ctx;
  let admin;

  before(async () => {
    ctx = await startTestApp({
      env: { GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", GOOGLE_REDIRECT_URI: "" },
    });
    admin = await ctx.createStaff("Admin", { access: "write" });
  });
  after(() => ctx?.stop());

  it("says so on the court and refuses to connect", async () => {
    const venueId = (
      await ctx.api("POST", "/admin/venues", { token: admin.token, body: { name: "Plain" } })
    ).data.venueId;
    const courtId = (
      await ctx.api("POST", "/admin/courts", {
        token: admin.token,
        body: { venueId, name: "Court 1" },
      })
    ).data.courtId;
    const shown = await ctx.api("GET", `/admin/courts/${courtId}`, { token: admin.token });
    assert.equal(shown.data.court.googleDrive.configured, false);
    const res = await ctx.api("POST", `/admin/courts/${courtId}/google-drive/connect`, {
      token: admin.token,
    });
    assert.equal(res.status, 409);
  });
});
