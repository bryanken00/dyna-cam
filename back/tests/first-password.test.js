// The seeded Owner's first password and the forced password change (review finding F4).

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  connectToServer,
  dropTestDatabase,
  newTestDatabaseName,
  OWNER,
  runScript,
  startTestApp,
} from "./helpers/testApp.js";

describe("first Owner password", () => {
  let ctx;
  let token;
  const NEW_PASSWORD = "Brand-New-Passw0rd";

  const flagOf = async (email) => {
    const [[row]] = await ctx.sql.query(
      `SELECT mustChangePassword FROM credentials WHERE email = ?`,
      [email]
    );
    return row.mustChangePassword;
  };

  before(async () => {
    ctx = await startTestApp({ keepFirstPasswordFlag: true });
  });

  after(() => ctx?.stop());

  describe("setup script", () => {
    let server;
    const extra = []; // databases created by these tests

    before(async () => {
      server = await connectToServer();
    });

    after(async () => {
      for (const name of extra) await dropTestDatabase(server, name);
      await server.end();
    });

    const exists = async (name) =>
      (await server.query(`SHOW DATABASES LIKE ?`, [name]))[0].length === 1;

    it("refuses an unusable OWNER_PASSWORD before creating anything", async () => {
      const name = newTestDatabaseName();
      extra.push(name);

      const short = runScript("setup-database.js", {
        DB_DATABASE: name,
        OWNER_PASSWORD: "short",
      });
      assert.equal(short.ok, false);
      assert.match(short.output, /at least 8/);

      const common = runScript("setup-database.js", {
        DB_DATABASE: name,
        OWNER_PASSWORD: "password123",
      });
      assert.equal(common.ok, false);
      assert.match(common.output, /too common/);

      assert.equal(await exists(name), false);
    });

    it("generates and prints a random password when none is configured", () => {
      const name = newTestDatabaseName();
      extra.push(name);

      const run = runScript("setup-database.js", { DB_DATABASE: name, OWNER_PASSWORD: "" });
      assert.equal(run.ok, true, run.output);
      assert.match(run.output, /Password: [A-Za-z0-9_-]{16}\s+← generated/);
    });

    it("gives the Owner role every permission", async () => {
      const [[counts]] = await ctx.sql.query(
        `SELECT
           (SELECT COUNT(*) FROM permissions WHERE status = 'Active') AS permissions,
           (SELECT COUNT(*) FROM role_permissions rp
              INNER JOIN roles r ON r.roleId = rp.roleId
              WHERE r.roleName = 'Owner' AND rp.accessLevel = 'write') AS granted`
      );
      assert.ok(counts.permissions > 0);
      assert.equal(counts.granted, counts.permissions);
    });

    it("is re-runnable: a second run adds no second Owner, and grants new permissions", async () => {
      await ctx.sql.query(
        `INSERT INTO permissions (permissionId, module, submodule, description, portal, status, dateCreated, dateUpdated)
         VALUES ('test-new-permission', 'reports', NULL, 'Added later', 'ADMIN', 'Active',
                 '2026-01-01 00:00:00', '2026-01-01 00:00:00')`
      );

      const again = runScript("setup-database.js", { DB_DATABASE: ctx.database });
      assert.equal(again.ok, true, again.output);
      assert.match(again.output, /already exists — skipping/);
      const [[owners]] = await ctx.sql.query(
        `SELECT COUNT(*) AS n FROM users u INNER JOIN roles r ON r.roleId = u.roleId
         WHERE r.roleName = 'Owner'`
      );
      assert.equal(owners.n, 1);
      const [[roles]] = await ctx.sql.query(
        `SELECT COUNT(*) AS n FROM roles WHERE roleName = 'Owner'`
      );
      assert.equal(roles.n, 1);
      const [[granted]] = await ctx.sql.query(
        `SELECT accessLevel FROM role_permissions WHERE permissionId = 'test-new-permission'`
      );
      assert.equal(granted?.accessLevel, "write");
    });
  });

  describe("forced change at first login", () => {
    it("signs in with the seeded password and reports the flag", async () => {
      const session = await ctx.login(OWNER.email, OWNER.password);
      assert.equal(session.user.mustChangePassword, true);
      token = session.token;
    });

    it("locks every route except the auth routes", async () => {
      for (const url of ["/admin/users", "/admin/roles", "/admin/dashboard/stats"]) {
        const response = await ctx.api("GET", url, { token });
        assert.equal(response.status, 403, url);
        assert.equal(response.body.code, "PASSWORD_CHANGE_REQUIRED");
      }
      const upload = await ctx.api("DELETE", "/upload/file", {
        token,
        body: { path: "/public/uploads/x.png" },
      });
      assert.equal(upload.status, 403);

      const me = await ctx.api("GET", "/admin/auth/me", { token });
      assert.equal(me.status, 200);
      assert.equal(me.data.user.mustChangePassword, true);
    });

    it("leaves the sidebar's permission call open", async () => {
      const response = await ctx.api("GET", "/admin/permissions/user", { token });
      assert.equal(response.status, 200);
      assert.ok(response.data.permissions.length > 0);
    });

    it("rejects a wrong current password, and the same password again", async () => {
      const wrong = await ctx.api("PUT", "/admin/auth/me/password", {
        token,
        body: { currentPassword: "not-the-password", newPassword: NEW_PASSWORD },
      });
      assert.equal(wrong.status, 401);
      assert.equal(wrong.body.code, "INVALID_CREDENTIALS");

      const same = await ctx.api("PUT", "/admin/auth/me/password", {
        token,
        body: { currentPassword: OWNER.password, newPassword: OWNER.password },
      });
      assert.equal(same.status, 400);
      assert.equal((await ctx.api("GET", "/admin/users", { token })).status, 403);
    });

    it("unlocks the account once a new password is chosen", async () => {
      const change = await ctx.api("PUT", "/admin/auth/me/password", {
        token,
        body: { currentPassword: OWNER.password, newPassword: NEW_PASSWORD },
      });
      assert.equal(change.status, 200);
      assert.equal((await ctx.api("GET", "/admin/users", { token })).status, 200);

      const session = await ctx.login(OWNER.email, NEW_PASSWORD);
      assert.equal(session.user.mustChangePassword, false);
      token = session.token;

      const old = await ctx.api("POST", "/admin/auth/login", { body: OWNER });
      assert.equal(old.status, 401);
    });

    it("is cleared by a password reset too", async () => {
      const [[account]] = await ctx.sql.query(`SELECT accountId FROM credentials WHERE email = ?`, [
        OWNER.email,
      ]);
      await ctx.sql.query(`UPDATE credentials SET mustChangePassword = 1 WHERE accountId = ?`, [
        account.accountId,
      ]);
      const resetToken = await ctx.issueResetToken(account.accountId);

      const reset = await ctx.api("POST", "/admin/auth/reset-password", {
        body: { token: resetToken, password: "Reset-Passw0rd-1" },
      });
      assert.equal(reset.status, 200);
      assert.equal(await flagOf(OWNER.email), 0);
      token = (await ctx.login(OWNER.email, "Reset-Passw0rd-1")).token;
    });

    it("applies to an account the Owner creates for someone else", async () => {
      const [[usersList]] = await ctx.sql.query(
        `SELECT permissionId FROM permissions WHERE module = 'users' AND submodule = 'list'`
      );
      const { roleId } = (
        await ctx.api("POST", "/admin/roles", { token, body: { roleName: "Staff" } })
      ).data;
      await ctx.api("POST", `/admin/roles/${roleId}/permissions`, {
        token,
        body: { permissions: [{ permissionId: usersList.permissionId, accessLevel: "read" }] },
      });
      const staff = { email: "sam@example.test", password: "First-Passw0rd-9" };
      const created = await ctx.api("POST", "/admin/users", {
        token,
        body: { firstName: "Sam", lastName: "Staff", ...staff, roleId },
      });
      assert.equal(created.status, 201);

      const session = await ctx.login(staff.email, staff.password);
      assert.equal(session.user.mustChangePassword, true);
      assert.equal((await ctx.api("GET", "/admin/users", { token: session.token })).status, 403);

      await ctx.sql.query(`UPDATE credentials SET mustChangePassword = 0 WHERE email = ?`, [
        staff.email,
      ]);
      assert.equal((await ctx.api("GET", "/admin/users", { token: session.token })).status, 200);
    });
  });
});
