// The Owner role and account are never reachable from the Admin portal's
// by-ID endpoints — not even by a staff admin who holds every permission — and
// they look exactly like records that do not exist. Ordinary staff records stay
// manageable, and a deleted user is gone too.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

describe("owner protection", () => {
  let ctx;
  let admin; // a staff admin with write access to everything — the acting user
  let ownerAccountId;
  let ownerRoleId;
  const staff = {}; // an ordinary role + user the admin may manage
  let permissions;

  const userBody = (roleId) => ({
    firstName: "Changed",
    lastName: "Name",
    roleId,
    status: "Active",
  });
  const roleBody = { roleName: "Renamed", description: null, status: "Active" };
  const call = (method, url, body) => ctx.api(method, url, { token: admin.token, body });
  const statusOf = async (method, url, body) => (await call(method, url, body)).status;

  before(async () => {
    ctx = await startTestApp();
    ownerAccountId = (await ctx.owner()).accountId;
    ownerRoleId = await ctx.ownerRoleId();
    admin = await ctx.createStaff("Admin", { access: "write" });
    permissions = (await call("GET", "/admin/permissions")).data.permissions;

    const role = await call("POST", "/admin/roles", { roleName: "Cashier" });
    assert.equal(role.status, 201);
    staff.roleId = role.data.roleId;
    assert.equal(
      await statusOf("POST", `/admin/roles/${staff.roleId}/permissions`, {
        permissions: [{ permissionId: permissions[0].permissionId, accessLevel: "read" }],
      }),
      200
    );

    const user = await call("POST", "/admin/users", {
      firstName: "Casey",
      lastName: "Cashier",
      email: "casey@example.test",
      password: "Staff-Passw0rd",
      roleId: staff.roleId,
    });
    assert.equal(user.status, 201);
    staff.accountId = user.data.accountId;

    const override = await call("POST", `/admin/user-permissions/${staff.accountId}`, {
      permissionId: permissions[0].permissionId,
      accessLevel: "read",
    });
    assert.equal(override.status, 201);
    staff.userPermissionId = override.data.userPermissionId;
  });

  after(() => ctx?.stop());

  describe("users", () => {
    it("hides the Owner account, and leaves it out of the list", async () => {
      assert.equal(await statusOf("GET", `/admin/users/${ownerAccountId}`), 404);
      const list = await call("GET", "/admin/users?pageSize=100");
      assert.ok(list.data.users.every((user) => user.accountId !== ownerAccountId));
      assert.ok(list.data.users.some((user) => user.accountId === staff.accountId));
    });

    it("returns an ordinary user, without tenant fields", async () => {
      const response = await call("GET", `/admin/users/${staff.accountId}`);
      assert.equal(response.status, 200);
      assert.equal("companyId" in response.data.user, false);
      assert.equal("branchId" in response.data.user, false);
    });

    it("refuses to update the Owner account and leaves it unchanged", async () => {
      assert.equal(
        await statusOf("PUT", `/admin/users/${ownerAccountId}`, userBody(staff.roleId)),
        404
      );
      const [[row]] = await ctx.sql.query(`SELECT roleId FROM users WHERE accountId = ?`, [
        ownerAccountId,
      ]);
      assert.equal(row.roleId, ownerRoleId);
    });

    it("refuses the Owner role on create and update", async () => {
      assert.equal(
        await statusOf("POST", "/admin/users", {
          firstName: "New",
          lastName: "Owner",
          email: "second-owner@example.test",
          password: "Staff-Passw0rd",
          roleId: ownerRoleId,
        }),
        400
      );
      assert.equal(
        await statusOf("PUT", `/admin/users/${staff.accountId}`, userBody(ownerRoleId)),
        400
      );
    });

    it("updates an ordinary user", async () => {
      assert.equal(
        await statusOf("PUT", `/admin/users/${staff.accountId}`, userBody(staff.roleId)),
        200
      );
    });

    it("refuses to delete the Owner account", async () => {
      assert.equal(await statusOf("DELETE", `/admin/users/${ownerAccountId}`), 404);
      const [[row]] = await ctx.sql.query(`SELECT status FROM users WHERE accountId = ?`, [
        ownerAccountId,
      ]);
      assert.equal(row.status, "Active");
    });

    it("treats a deleted user as missing", async () => {
      const user = await call("POST", "/admin/users", {
        firstName: "Gone",
        lastName: "Soon",
        email: "gone@example.test",
        password: "Staff-Passw0rd",
        roleId: staff.roleId,
      });
      const { accountId } = user.data;
      assert.equal(await statusOf("DELETE", `/admin/users/${accountId}`), 200);
      assert.equal(await statusOf("GET", `/admin/users/${accountId}`), 404);
      assert.equal(await statusOf("PUT", `/admin/users/${accountId}`, userBody(staff.roleId)), 404);
      assert.equal(await statusOf("DELETE", `/admin/users/${accountId}`), 404);
    });
  });

  describe("roles", () => {
    it("hides the Owner role, and leaves it out of the list", async () => {
      assert.equal(await statusOf("GET", `/admin/roles/${ownerRoleId}`), 404);
      assert.equal(await statusOf("GET", `/admin/roles/${staff.roleId}`), 200);
      const list = await call("GET", "/admin/roles?pageSize=100");
      assert.ok(list.data.roles.every((role) => role.roleId !== ownerRoleId));
    });

    it("refuses a second role named Owner, on create or by renaming", async () => {
      assert.equal(await statusOf("POST", "/admin/roles", { roleName: "Owner" }), 409);
      assert.equal(
        await statusOf("PUT", `/admin/roles/${staff.roleId}`, { ...roleBody, roleName: "Owner" }),
        409
      );
      const [[row]] = await ctx.sql.query(`SELECT roleName FROM roles WHERE roleId = ?`, [
        staff.roleId,
      ]);
      assert.equal(row.roleName, "Cashier");
    });

    it("refuses to rename a role to another role's name, but keeps its own", async () => {
      const other = await call("POST", "/admin/roles", { roleName: "Clerk" });
      assert.equal(
        await statusOf("PUT", `/admin/roles/${other.data.roleId}`, {
          ...roleBody,
          roleName: "Cashier",
        }),
        409
      );
      assert.equal(
        await statusOf("PUT", `/admin/roles/${other.data.roleId}`, {
          ...roleBody,
          roleName: "Clerk",
        }),
        200
      );
    });

    it("refuses to update the Owner role", async () => {
      assert.equal(await statusOf("PUT", `/admin/roles/${ownerRoleId}`, roleBody), 404);
      const [[row]] = await ctx.sql.query(`SELECT roleName FROM roles WHERE roleId = ?`, [
        ownerRoleId,
      ]);
      assert.equal(row.roleName, "Owner");
    });

    it("does not list the Owner role's permissions", async () => {
      const owner = await call("GET", `/admin/roles/${ownerRoleId}/permissions`);
      assert.equal(owner.data.permissions.length, 0);
      const own = await call("GET", `/admin/roles/${staff.roleId}/permissions`);
      assert.equal(own.data.permissions.length, 1);
    });

    it("refuses to replace the Owner role's permissions", async () => {
      assert.equal(
        await statusOf("POST", `/admin/roles/${ownerRoleId}/permissions`, { permissions: [] }),
        404
      );
      const [[row]] = await ctx.sql.query(
        `SELECT COUNT(*) AS n FROM role_permissions WHERE roleId = ?`,
        [ownerRoleId]
      );
      assert.equal(row.n, permissions.length);
    });

    it("refuses to delete the Owner role", async () => {
      assert.equal(await statusOf("DELETE", `/admin/roles/${ownerRoleId}`), 404);
      const [[row]] = await ctx.sql.query(`SELECT status FROM roles WHERE roleId = ?`, [
        ownerRoleId,
      ]);
      assert.equal(row.status, "Active");
    });
  });

  describe("user permission overrides", () => {
    const override = () => ({ permissionId: permissions[0].permissionId, accessLevel: "write" });

    it("hides the Owner account", async () => {
      assert.equal(await statusOf("GET", `/admin/user-permissions/${ownerAccountId}`), 404);
      assert.equal(await statusOf("GET", `/admin/user-permissions/${staff.accountId}`), 200);
    });

    it("refuses to give the Owner account an override, or replace its overrides", async () => {
      assert.equal(
        await statusOf("POST", `/admin/user-permissions/${ownerAccountId}`, override()),
        404
      );
      assert.equal(
        await statusOf("POST", `/admin/user-permissions/${ownerAccountId}/bulk`, {
          permissions: [{ permissionId: permissions[0].permissionId, accessLevel: "none" }],
        }),
        404
      );
      const [[row]] = await ctx.sql.query(
        `SELECT COUNT(*) AS n FROM user_permissions WHERE accountId = ?`,
        [ownerAccountId]
      );
      assert.equal(row.n, 0);
    });

    it("changes an ordinary user's overrides", async () => {
      assert.equal(
        await statusOf("POST", `/admin/user-permissions/${staff.accountId}`, override()),
        200
      );
      assert.equal(
        await statusOf(
          "DELETE",
          `/admin/user-permissions/${staff.accountId}/${staff.userPermissionId}`
        ),
        200
      );
    });
  });
});
