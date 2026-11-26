// PLAN-002 Phase I, PLAN-008 phase F — recorder boxes enrol with their company's own
// enroll key (made in the back office). A company with no key can't enrol boxes: every
// key is refused the same way as a wrong one, and no box is added.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

describe("recorder box enrolment without a company key", () => {
  let ctx;
  let venueId;

  before(async () => {
    ctx = await startTestApp();
    const owner = await ctx.owner();
    venueId = (
      await ctx.api("POST", "/admin/venues", { token: owner.token, body: { name: "Off Courts" } })
    ).data.venueId;
  });
  after(() => ctx?.stop());

  it("refuses every enrolment while the company has no enroll key", async () => {
    const [[company]] = await ctx.sql.query(
      `SELECT c.enrollKeyHash FROM venues v JOIN companies c ON c.companyId = v.companyId WHERE v.venueId = ?`,
      [venueId]
    );
    assert.equal(company.enrollKeyHash, null);
    for (const [i, enrollKey] of ["too-short", "x".repeat(64)].entries()) {
      const res = await ctx.api("POST", "/pair/enroll", {
        body: { enrollKey, venueId },
        headers: { "X-Forwarded-For": `203.0.113.${60 + i}` },
      });
      assert.equal(res.status, 400);
      assert.match(res.body.message, /isn't accepted/);
    }
    const [[count]] = await ctx.sql.query(`SELECT COUNT(*) AS n FROM devices`);
    assert.equal(count.n, 0);
  });
});
