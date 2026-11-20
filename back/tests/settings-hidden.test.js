// CR-021 — the Settings page was removed (nothing read its values): its
// permission is no longer offered in Roles / user permissions, and a new
// database doesn't seed it. The row is kept (Inactive), not deleted.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

describe("Settings hidden (CR-021)", () => {
  let ctx;

  before(async () => {
    ctx = await startTestApp();
  });
  after(() => ctx?.stop());

  it("doesn't offer a Settings permission", async () => {
    const owner = await ctx.owner();
    const res = await ctx.api("GET", "/admin/permissions", { token: owner.token });
    assert.equal(res.status, 200);
    const modules = res.data.permissions.map((p) => p.module);
    assert.ok(!modules.includes("settings"), modules.join(", "));
    assert.ok(modules.includes("audit_trail"), "the others are still there");
  });

  it("doesn't seed it on a new database", async () => {
    const [rows] = await ctx.sql.query(
      `SELECT status FROM permissions WHERE module = 'settings' AND submodule IS NULL`
    );
    assert.ok(rows.every((row) => row.status === "Inactive"), JSON.stringify(rows));
  });
});
