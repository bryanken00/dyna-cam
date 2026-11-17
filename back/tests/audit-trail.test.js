// Audit trail coverage (review finding F7): Admin-portal writes, sign-in events,
// and uploads are recorded, and the row exists by the time the response arrives.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { OWNER_PASSWORD, PNG, STAFF_PASSWORD, startTestApp } from "./helpers/testApp.js";

describe("audit trail", () => {
  let ctx;
  let owner;
  let staff;

  // Rows for one account, newest first. No waiting: the row must already be there.
  const rowsOf = async (accountId, where = "1 = 1", params = []) => {
    const [rows] = await ctx.sql.query(
      `SELECT action, module, description, metadata, ipAddress
       FROM audit_trail WHERE accountId = ? AND ${where} ORDER BY id DESC`,
      [accountId, ...params]
    );
    return rows;
  };
  const latest = async (accountId, action) => (await rowsOf(accountId, "action = ?", [action]))[0];
  const signIn = (account, password) =>
    ctx.api("POST", "/admin/auth/login", { body: { email: account.email, password } });

  before(async () => {
    ctx = await startTestApp();
    owner = await ctx.owner();
    staff = await ctx.createStaff("Sam");
  });

  after(() => ctx?.stop());

  describe("Admin portal writes", () => {
    it("records what the Owner does", async () => {
      const modules = (await rowsOf(owner.accountId)).map((row) => row.module);
      assert.ok(modules.includes("roles") && modules.includes("users"));

      const [created] = await rowsOf(owner.accountId, "module = 'users'");
      assert.equal(created.action, "CREATE");
    });

    it("never stores a password in the metadata", async () => {
      const rows = await rowsOf(owner.accountId, "module = 'users'");
      for (const row of rows) {
        assert.doesNotMatch(JSON.stringify(row.metadata), /passw/i);
      }
      assert.equal(rows[0].metadata.body.email, staff.email);
    });

    it("records an update and a delete, naming the record", async () => {
      const { roleId } = (
        await ctx.api("POST", "/admin/roles", { token: owner.token, body: { roleName: "Temp" } })
      ).data;
      await ctx.api("PUT", `/admin/roles/${roleId}`, {
        token: owner.token,
        body: { roleName: "Temp 2", status: "Active" },
      });
      await ctx.api("DELETE", `/admin/roles/${roleId}`, { token: owner.token });

      const rows = await rowsOf(owner.accountId, "description LIKE ?", [`%${roleId}%`]);
      assert.deepEqual(rows.map((row) => row.action).sort(), ["DELETE", "UPDATE"]);
    });
  });

  describe("sign-in events", () => {
    it("records a sign-in", async () => {
      assert.equal((await signIn(owner, OWNER_PASSWORD)).status, 200);
      const row = await latest(owner.accountId, "LOGIN");
      assert.equal(row.module, "auth");
      assert.ok(row.ipAddress);
    });

    it("records a wrong password, and the lockout", async () => {
      for (let attempt = 1; attempt <= 5; attempt++) await signIn(staff, "wrong-password");
      const rows = await rowsOf(staff.accountId, "action IN ('LOGIN_FAILED', 'ACCOUNT_LOCKED')");
      assert.equal(rows.filter((row) => row.action === "LOGIN_FAILED").length, 4);
      assert.equal(rows.filter((row) => row.action === "ACCOUNT_LOCKED").length, 1);
      await ctx.sql.query(
        `UPDATE credentials SET lockedUntil = NULL, failedLoginAttempts = 0 WHERE accountId = ?`,
        [staff.accountId]
      );
    });

    it("records sign-out, profile update, and password change", async () => {
      const session = (await signIn(owner, OWNER_PASSWORD)).data;

      await ctx.api("PUT", "/admin/auth/me", {
        token: session.token,
        body: { firstName: "System", lastName: "Owner" },
      });
      assert.ok(await latest(owner.accountId, "PROFILE_UPDATE"));

      const change = await ctx.api("PUT", "/admin/auth/me/password", {
        token: session.token,
        body: { currentPassword: OWNER_PASSWORD, newPassword: "Another-Passw0rd-5" },
      });
      assert.equal(change.status, 200);
      assert.ok(await latest(owner.accountId, "PASSWORD_CHANGE"));

      await ctx.api("POST", "/admin/auth/logout", {
        body: { refreshToken: change.data.refreshToken.token },
      });
      assert.ok(await latest(owner.accountId, "LOGOUT"));
      owner.token = (await signIn(owner, "Another-Passw0rd-5")).data.token;
    });

    it("records a reused refresh token", async () => {
      const session = (await signIn(staff, STAFF_PASSWORD)).data;
      const refresh = () =>
        ctx.api("POST", "/admin/auth/refresh", {
          body: { refreshToken: session.refreshToken.token },
        });
      assert.equal((await refresh()).status, 200);
      assert.equal((await refresh()).status, 401, "second use of the same token");
      assert.ok(await latest(staff.accountId, "TOKEN_REUSE"));
    });
  });

  describe("uploads", () => {
    it("records an upload and a delete", async () => {
      const upload = await ctx.api("POST", "/upload/image", {
        token: owner.token,
        form: [["file", PNG, "image/png", "picture.png"]],
      });
      assert.equal(upload.status, 200);
      await ctx.api("DELETE", "/upload/file", {
        token: owner.token,
        body: { path: upload.data.path },
      });

      const rows = await rowsOf(owner.accountId, "module = 'upload'");
      assert.deepEqual(rows.map((row) => row.action).sort(), ["CREATE", "DELETE"]);
    });
  });

  describe("the Audit Trail page", () => {
    it("shows every account's events", async () => {
      const response = await ctx.api("GET", "/admin/audit-trail?pageSize=100", {
        token: owner.token,
      });
      assert.equal(response.status, 200);
      const logs = response.data.logs;

      assert.ok(logs.some((log) => log.action === "LOGIN" && log.accountId === owner.accountId));
      assert.ok(logs.some((log) => log.accountId === staff.accountId));
    });

    it("filters by account", async () => {
      const response = await ctx.api(
        "GET",
        `/admin/audit-trail?pageSize=100&accountId=${staff.accountId}`,
        { token: owner.token }
      );
      assert.equal(response.status, 200);
      assert.ok(response.data.logs.length > 0);
      assert.ok(response.data.logs.every((log) => log.accountId === staff.accountId));
    });
  });
});
