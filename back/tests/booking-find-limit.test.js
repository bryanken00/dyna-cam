// CR-030 — "Find my booking" is rate-limited per IP, so booking codes can't be
// guessed. Its own file: the limit is read when the app loads.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

describe("find my booking rate limit (CR-030)", () => {
  let ctx;

  before(async () => {
    ctx = await startTestApp({ env: { RATE_LIMIT_PUBLIC_FIND_POINTS: "2" } });
  });
  after(() => ctx?.stop());

  it("refuses the third try in a minute", async () => {
    const statuses = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await ctx.api("POST", "/public/bookings/find", {
        body: { bookingCode: "ABC123", contact: "x@example.com" },
      });
      statuses.push(res.status);
    }
    assert.deepEqual(statuses, [404, 404, 429]);
  });
});
