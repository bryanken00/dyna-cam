// The upload routes are rate-limited (review finding F2). This lives in its own
// file because the limit comes from the environment, which is read once per
// process — and each test file runs in its own process.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PNG, startTestApp } from "./helpers/testApp.js";

describe("upload rate limit", () => {
  let ctx;
  let owner;

  before(async () => {
    ctx = await startTestApp({ env: { RATE_LIMIT_UPLOAD_POINTS: "2" } });
    owner = await ctx.owner();
  });

  after(() => ctx?.stop());

  it("returns 429 once the limit for the window is used up", async () => {
    const statuses = [];
    for (let i = 0; i < 3; i++) {
      const response = await ctx.api("POST", "/upload/image", {
        token: owner.token,
        form: [["file", PNG, "image/png", "picture.png"]],
      });
      statuses.push(response.status);
    }
    assert.deepEqual(statuses, [200, 200, 429]);
  });
});
