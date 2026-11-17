// PLAN-002 Phase I — without RECORDER_ENROLL_KEY (or with one under 32
// characters) recorder boxes can't enrol: 403 ENROLLMENT_DISABLED.
// Its own file: the key is read per request, but the app's env is set at start.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

describe("recorder box enrolment switched off", () => {
  let ctx;
  let venueId;

  before(async () => {
    ctx = await startTestApp({ env: { RECORDER_ENROLL_KEY: "too-short" } });
    const owner = await ctx.owner();
    venueId = (
      await ctx.api("POST", "/admin/venues", { token: owner.token, body: { name: "Off Courts" } })
    ).data.venueId;
  });
  after(() => ctx?.stop());

  it("refuses every enrolment, even with the configured value", async () => {
    for (const enrollKey of ["too-short", "x".repeat(64)]) {
      const res = await ctx.api("POST", "/pair/enroll", { body: { enrollKey, venueId } });
      assert.equal(res.status, 403);
      assert.equal(res.body.code, "ENROLLMENT_DISABLED");
    }
    const [[count]] = await ctx.sql.query(`SELECT COUNT(*) AS n FROM devices`);
    assert.equal(count.n, 0);
  });
});
