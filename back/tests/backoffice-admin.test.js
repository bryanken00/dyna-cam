// PLAN-008 phase E — the back office's own audit trail (every super-admin action,
// company actions mirrored into the company's audit trail as "DGSports") and super
// admins managing each other.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { STAFF_PASSWORD, startTestApp, SUPERADMIN } from "./helpers/testApp.js";

describe("back office: audit trail and super admins (PLAN-008 phase E)", () => {
  let ctx;
  let su;
  let suId;

  const bo = (method, url, body, token = su.token) => ctx.api(method, `/backoffice${url}`, { token, body });
  const activity = async (query = "") => {
    const res = await bo("GET", `/activity${query}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.data.activity;
  };
  // mysql2 hands JSON columns back parsed
  const meta = (row) => (typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata);
  const boLogin = (email, password) =>
    ctx.api("POST", "/backoffice/auth/login", { body: { email, password } });

  before(async () => {
    ctx = await startTestApp();
    su = await ctx.superAdmin();
    suId = su.admin.platformAdminId;
  });
  after(async () => {
    await ctx?.stop();
  });

  it("records sign-ins, failed sign-ins and password changes", async () => {
    assert.equal((await boLogin("nobody@dgsports.test", "Whatever-Passw0rd")).status, 401);
    assert.equal((await boLogin(SUPERADMIN.email, "Wrong-Passw0rd-123")).status, 401);

    const rows = await activity();
    const unknown = rows.find((r) => r.action === "LOGIN_FAILED" && r.admin === null);
    assert.ok(unknown, "an unknown email's failed sign-in");
    assert.equal(meta(unknown).email, "nobody@dgsports.test");
    const wrong = rows.find((r) => r.action === "LOGIN_FAILED" && r.admin?.platformAdminId === suId);
    assert.ok(wrong);
    assert.equal(wrong.admin.email, SUPERADMIN.email);
    assert.ok(rows.some((r) => r.action === "LOGIN" && r.admin?.platformAdminId === suId));

    // The seeded super admin has no forced change; one added in the back office does
    const added = await bo("POST", "/admins", { firstName: "Pat", lastName: "Change", email: "pat@dgsports.test" });
    assert.equal(added.status, 201, JSON.stringify(added.body));
    const temporary = added.data.temporaryPassword || added.data.admin?.temporaryPassword;
    const first = await boLogin("pat@dgsports.test", temporary);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const changed = await bo(
      "PUT",
      "/auth/me/password",
      { currentPassword: temporary, newPassword: "Pat-Chosen-Passw0rd-9" },
      first.data.token
    );
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    const after = await activity();
    assert.ok(after.some((r) => r.action === "PASSWORD_CHANGE" && r.admin?.email === "pat@dgsports.test"));
    // Never a password or token anywhere
    const text = JSON.stringify(after);
    assert.ok(!text.includes(SUPERADMIN.password) && !text.includes(temporary));
    assert.ok(!/"(password|token|refreshToken)"/i.test(text));
  });

  it("records each company action, and the company sees it in its own audit trail as DGSports", async () => {
    const made = await bo("POST", "/companies", {
      name: "Audit Courts",
      owner: { firstName: "Ada", lastName: "Owner", email: "audit-owner@example.test" },
    });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const { companyId } = made.data;
    const firstPassword = made.data.owner.temporaryPassword;

    assert.equal(
      (await bo("PATCH", `/companies/${companyId}`, { name: "Audit Courts Co.", contactPhone: "09171234567" })).status,
      200
    );
    assert.equal((await bo("POST", `/companies/${companyId}/suspend`)).status, 200);
    assert.equal((await bo("POST", `/companies/${companyId}/reactivate`)).status, 200);
    const reset = await bo("POST", `/companies/${companyId}/owner/reset-password`);
    assert.equal(reset.status, 200);
    const resetPassword = reset.data.owner.temporaryPassword;

    const rows = await activity(`?companyId=${companyId}`);
    assert.deepEqual(rows.map((r) => r.action).sort(), [
      "COMPANY_CREATE",
      "COMPANY_REACTIVATE",
      "COMPANY_SUSPEND",
      "COMPANY_UPDATE",
      "OWNER_PASSWORD_RESET",
    ]);
    assert.ok(rows.every((r) => r.company.name === "Audit Courts Co." && r.admin.platformAdminId === suId));
    const update = rows.find((r) => r.action === "COMPANY_UPDATE");
    assert.equal(meta(update).after.name, "Audit Courts Co.");
    const text = JSON.stringify(rows);
    assert.ok(!text.includes(firstPassword) && !text.includes(resetPassword), "temporary passwords never recorded");

    // The company's Owner sees the same five, by "DGSports", in Admin → Audit trail
    const first = await ctx.login("audit-owner@example.test", resetPassword);
    const changed = await ctx.api("PUT", "/admin/auth/me/password", {
      token: first.token,
      body: { currentPassword: resetPassword, newPassword: STAFF_PASSWORD },
    });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    const trail = await ctx.api("GET", "/admin/audit-trail?module=company&pageSize=50", { token: changed.data.token });
    assert.equal(trail.status, 200, JSON.stringify(trail.body));
    const logs = trail.data.logs;
    assert.equal(logs.length, 5);
    assert.ok(logs.every((l) => l.accountId === "dgsports" && l.firstName === "DGSports"));
    assert.ok(logs.some((l) => l.action === "COMPANY_SUSPEND"));
    assert.ok(!JSON.stringify(logs).includes(resetPassword));

    // …and another company's staff don't
    const ownerA = await ctx.owner();
    const elsewhere = await ctx.api("GET", "/admin/audit-trail?module=company&pageSize=50", { token: ownerA.token });
    assert.equal(elsewhere.status, 200);
    assert.ok(!elsewhere.data.logs.some((l) => (l.description || "").includes("Audit Courts")));
  });

  it("filters the activity by company, admin, action and dates", async () => {
    const all = await activity("?pageSize=100");
    assert.ok(all.length > 5);
    const logins = await activity("?action=LOGIN");
    assert.ok(logins.length > 0 && logins.every((r) => r.action === "LOGIN"));
    const mine = await activity(`?platformAdminId=${suId}&pageSize=100`);
    assert.ok(mine.length > 0 && mine.every((r) => r.admin?.platformAdminId === suId));
    assert.equal((await activity("?dateFrom=2999-01-01")).length, 0);
    assert.equal((await activity("?dateTo=2000-01-01")).length, 0);
    const paged = await bo("GET", "/activity?pageSize=2&page=1");
    assert.equal(paged.data.activity.length, 2);
    assert.ok(paged.data.pagination.total > 2);
    assert.ok(paged.data.actions.includes("ADMIN_CREATE"));
    assert.equal((await bo("GET", "/activity?action=NOT_AN_ACTION")).status, 400);
    assert.equal((await bo("GET", "/activity?dateFrom=yesterday")).status, 400);
  });

  it("adds a super admin, who must change the temporary password first", async () => {
    const added = await bo("POST", "/admins", { firstName: "Bea", lastName: "Back", email: "Bea@DGSports.test" });
    assert.equal(added.status, 201, JSON.stringify(added.body));
    assert.equal(added.data.email, "bea@dgsports.test");
    const temp = added.data.temporaryPassword;

    assert.equal(
      (await bo("POST", "/admins", { firstName: "X", lastName: "Y", email: "bea@dgsports.test" })).status,
      409
    );

    const first = await boLogin("bea@dgsports.test", temp);
    assert.equal(first.status, 200);
    assert.equal(first.data.admin.mustChangePassword, true);
    assert.equal((await bo("GET", "/companies", undefined, first.data.token)).status, 403);
    const changed = await ctx.api("PUT", "/backoffice/auth/me/password", {
      token: first.data.token,
      body: { currentPassword: temp, newPassword: "Bea-Chosen-Passw0rd-9" },
    });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.equal((await bo("GET", "/companies", undefined, changed.data.token)).status, 200);

    const list = await bo("GET", "/admins");
    const bea = list.data.admins.find((a) => a.email === "bea@dgsports.test");
    assert.equal(bea.status, "Active");
    assert.ok(bea.lastSignInAt);
    assert.equal(list.data.admins.find((a) => a.platformAdminId === suId).isSelf, true);

    const renamed = await bo("PATCH", `/admins/${bea.platformAdminId}`, { firstName: "Beatrice", lastName: "Back" });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.data.admin.firstName, "Beatrice");

    const rows = await activity("?pageSize=100");
    assert.ok(rows.some((r) => r.action === "ADMIN_CREATE" && meta(r).email === "bea@dgsports.test"));
    assert.ok(rows.some((r) => r.action === "ADMIN_UPDATE"));
    assert.ok(!JSON.stringify(rows).includes(temp));
  });

  it("deactivates another super admin (their token stops), never yourself; reactivates", async () => {
    const added = await bo("POST", "/admins", { firstName: "Cal", lastName: "Gone", email: "cal@dgsports.test" });
    const { platformAdminId } = added.data;
    const first = await boLogin("cal@dgsports.test", added.data.temporaryPassword);
    const changed = await ctx.api("PUT", "/backoffice/auth/me/password", {
      token: first.data.token,
      body: { currentPassword: added.data.temporaryPassword, newPassword: "Cal-Chosen-Passw0rd-9" },
    });
    const calToken = changed.data.token;
    assert.equal((await bo("GET", "/companies", undefined, calToken)).status, 200);

    const self = await bo("POST", `/admins/${suId}/deactivate`);
    assert.equal(self.status, 409);

    const off = await bo("POST", `/admins/${platformAdminId}/deactivate`);
    assert.equal(off.status, 200, JSON.stringify(off.body));
    assert.equal(off.data.admin.status, "Inactive");
    assert.equal((await bo("GET", "/companies", undefined, calToken)).status, 401);
    assert.equal((await boLogin("cal@dgsports.test", "Cal-Chosen-Passw0rd-9")).status, 401);
    const refresh = await ctx.api("POST", "/backoffice/auth/refresh", {
      body: { refreshToken: changed.data.refreshToken.token },
    });
    assert.equal(refresh.status, 401);

    const on = await bo("POST", `/admins/${platformAdminId}/reactivate`);
    assert.equal(on.status, 200);
    assert.equal(on.data.admin.status, "Active");
    assert.equal((await boLogin("cal@dgsports.test", "Cal-Chosen-Passw0rd-9")).status, 200);

    const rows = await activity("?pageSize=100");
    assert.ok(rows.some((r) => r.action === "ADMIN_DEACTIVATE"));
    assert.ok(rows.some((r) => r.action === "ADMIN_REACTIVATE"));
  });

  it("never leaves the back office without an active super admin", async () => {
    // Everyone else Inactive except one other: deactivating that one leaves the caller — allowed
    const [[other]] = await ctx.sql.query(
      `SELECT platformAdminId FROM platform_admins WHERE platformAdminId != ? ORDER BY id LIMIT 1`,
      [suId]
    );
    await ctx.sql.query(`UPDATE platform_admins SET status = 'Inactive' WHERE platformAdminId != ?`, [suId]);
    await ctx.sql.query(`UPDATE platform_admins SET status = 'Active' WHERE platformAdminId = ?`, [
      other.platformAdminId,
    ]);
    assert.equal((await bo("POST", `/admins/${other.platformAdminId}/deactivate`)).status, 200);
    // The caller is now the only Active one: refused (409), and still Active
    assert.equal((await bo("POST", `/admins/${suId}/deactivate`)).status, 409);
    const [[me]] = await ctx.sql.query(`SELECT status FROM platform_admins WHERE platformAdminId = ?`, [suId]);
    assert.equal(me.status, "Active");
  });

  it("resets another super admin's password: a new temporary one, the old stops working", async () => {
    const added = await bo("POST", "/admins", { firstName: "Dee", lastName: "Reset", email: "dee@dgsports.test" });
    const { platformAdminId } = added.data;
    const reset = await bo("POST", `/admins/${platformAdminId}/reset-password`);
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    assert.notEqual(reset.data.temporaryPassword, added.data.temporaryPassword);
    assert.equal((await boLogin("dee@dgsports.test", added.data.temporaryPassword)).status, 401);
    const signedIn = await boLogin("dee@dgsports.test", reset.data.temporaryPassword);
    assert.equal(signedIn.status, 200);
    assert.equal(signedIn.data.admin.mustChangePassword, true);

    assert.equal((await bo("POST", `/admins/${suId}/reset-password`)).status, 409);
    const rows = await activity("?action=ADMIN_PASSWORD_RESET");
    assert.equal(rows.length, 1);
    assert.ok(!JSON.stringify(rows).includes(reset.data.temporaryPassword));
  });

  it("treats an unknown or deleted super admin as missing", async () => {
    for (const [method, url, body] of [
      ["PATCH", "/admins/nope", { firstName: "A", lastName: "B" }],
      ["POST", "/admins/nope/deactivate"],
      ["POST", "/admins/nope/reactivate"],
      ["POST", "/admins/nope/reset-password"],
    ]) {
      assert.equal((await bo(method, url, body)).status, 404, `${method} ${url}`);
    }
    const added = await bo("POST", "/admins", { firstName: "Eve", lastName: "Gone", email: "eve@dgsports.test" });
    const { platformAdminId } = added.data;
    await ctx.sql.query(`UPDATE platform_admins SET status = 'Deleted' WHERE platformAdminId = ?`, [platformAdminId]);
    assert.equal((await bo("PATCH", `/admins/${platformAdminId}`, { firstName: "Back", lastName: "Again" })).status, 404);
    assert.equal((await bo("POST", `/admins/${platformAdminId}/reactivate`)).status, 404);
    assert.equal((await bo("POST", `/admins/${platformAdminId}/reset-password`)).status, 404);
    const [[row]] = await ctx.sql.query(`SELECT firstName, status FROM platform_admins WHERE platformAdminId = ?`, [
      platformAdminId,
    ]);
    assert.equal(row.firstName, "Eve");
    assert.equal(row.status, "Deleted");
    const list = await bo("GET", "/admins");
    assert.ok(!list.data.admins.some((a) => a.platformAdminId === platformAdminId));
  });
});
