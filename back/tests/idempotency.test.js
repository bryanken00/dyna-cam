// Idempotency cache (review finding F3): auth responses contain tokens and must
// never be written to idempotency_keys; ordinary writes are still cached; and
// expired rows are cleaned up.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { OWNER_PASSWORD, startTestApp } from "./helpers/testApp.js";

describe("idempotency cache", () => {
  let ctx;
  let owner;

  // The cache insert is fire-and-forget, so give it a moment before counting
  const cachedRows = async () => {
    await sleep(200);
    const [rows] = await ctx.sql.query(
      `SELECT CAST(responseBody AS CHAR) AS body FROM idempotency_keys`
    );
    return rows;
  };
  const withKey = (key, extra = {}) => ({ headers: { "Idempotency-Key": key }, ...extra });

  before(async () => {
    ctx = await startTestApp();
    owner = await ctx.owner();
    await ctx.sql.query(`DELETE FROM idempotency_keys`);
  });

  after(() => ctx?.stop());

  it("does not cache a login, and a repeated key is a fresh login", async () => {
    const body = { email: owner.email, password: OWNER_PASSWORD };
    const first = await ctx.api("POST", "/admin/auth/login", withKey("login-1", { body }));
    assert.equal(first.status, 200);
    assert.equal((await cachedRows()).length, 0);

    const second = await ctx.api("POST", "/admin/auth/login", withKey("login-1", { body }));
    assert.equal(second.status, 200);
    assert.notEqual(second.data.refreshToken.token, first.data.refreshToken.token);
  });

  it("does not cache a token refresh", async () => {
    const response = await ctx.api(
      "POST",
      "/admin/auth/refresh",
      withKey("refresh-1", { body: { refreshToken: owner.refreshToken } })
    );
    assert.equal(response.status, 200);
    assert.equal((await cachedRows()).length, 0);
    owner.token = response.data.token;
  });

  it("still caches and replays an ordinary write", async () => {
    const request = withKey("role-1", { token: owner.token, body: { roleName: "Cashier" } });
    const first = await ctx.api("POST", "/admin/roles", request);
    assert.equal(first.status, 201);

    const rows = await cachedRows();
    assert.equal(rows.length, 1);
    assert.doesNotMatch(rows[0].body, /token/i);

    const replay = await ctx.api("POST", "/admin/roles", request);
    assert.equal(replay.status, 201);
    assert.equal(replay.data.roleId, first.data.roleId);
    const [[count]] = await ctx.sql.query(
      `SELECT COUNT(*) AS n FROM roles WHERE roleName = 'Cashier'`
    );
    assert.equal(count.n, 1);
  });

  it("removes expired rows as soon as the cleanup is scheduled, and keeps live ones", async () => {
    await ctx.sql.query(
      `INSERT INTO idempotency_keys (idempotencyKey, requestHash, responseCode, responseBody, dateCreated, expiresAt)
       VALUES ('expired-key', 'hash', 200, '{}', '2020-01-01 00:00:00', '2020-01-02 00:00:00')`
    );
    const { scheduleIdempotencyCleanup } = await ctx.importFromBack(
      "server/src/middlewares/idempotency.middleware.js"
    );

    const stop = scheduleIdempotencyCleanup(ctx.db, 60_000);
    await sleep(200);
    stop();

    const [rows] = await ctx.sql.query(`SELECT idempotencyKey FROM idempotency_keys`);
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].idempotencyKey, "expired-key");
  });
});
