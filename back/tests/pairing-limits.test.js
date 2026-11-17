// PLAN-002 — guessing a 6-digit pairing key is limited: a few tries per IP per
// minute, and a global pause after too many wrong keys from anywhere.
// Its own file: the limits are read once at startup. The API trusts one proxy
// hop, so X-Forwarded-For stands in for different players' networks.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

describe("pairing limits", () => {
  let ctx;
  const tryKey = (ip, code) =>
    ctx.api("POST", "/pair/app", { body: { code }, headers: { "X-Forwarded-For": ip } });

  before(async () => {
    ctx = await startTestApp({
      env: {
        RATE_LIMIT_PAIR_POINTS: "5",
        RATE_LIMIT_PAIR_HOURLY_POINTS: "20",
        PAIR_MAX_FAILURES: "8",
      },
    });
  });
  after(() => ctx?.stop());

  it("limits tries per IP per minute", async () => {
    const statuses = [];
    for (let i = 0; i < 6; i += 1) {
      statuses.push((await tryKey("203.0.113.10", String(100000 + i))).status);
    }
    assert.deepEqual(statuses, [400, 400, 400, 400, 400, 429]);
  });

  it("pauses all pairing after too many wrong keys from anywhere", async () => {
    // 5 failures so far; three more from other networks reach the cap of 8
    for (const ip of ["203.0.113.21", "203.0.113.22", "203.0.113.23"]) {
      assert.equal((await tryKey(ip, "200000")).status, 400);
    }
    const fresh = await tryKey("203.0.113.99", "300000");
    assert.equal(fresh.status, 429, "a new network is paused too");
    assert.match(fresh.body.message, /paused/);
  });
});
