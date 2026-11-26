// PLAN-008 Phase A — the company rule for people: users, roles, user permission
// overrides and the audit trail belong to one company. (Settings are per company
// too, but no role can reach /admin/settings since CR-021 removed its permission.)
// Another company's staff (even its Owner) can't list, read, edit, delete, assign or
// use them — a by-ID request answers 404 like a missing record — and nothing changes.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { STAFF_PASSWORD, startTestApp, TEMPORARY_PASSWORD } from "./helpers/testApp.js";

describe("company scope — people and settings (PLAN-008)", () => {
  let ctx;
  let a; // the default company: its Owner (ctx.owner()) and a staff user it made
  let b; // another company, from the back office's createCompany()
  let bStaff;
  const A = {};

  const as = (session) => (method, url, body) => ctx.api(method, url, { token: session.token, body });

  before(async () => {
    ctx = await startTestApp();
    const aOwner = await ctx.owner();
    a = as(aOwner);
    b = await ctx.createCompany("Rival Courts");
    bStaff = await ctx.createStaff("Rival Admin", { access: "write", company: b });

    // Company A's records
    const role = await a("POST", "/admin/roles", { roleName: "Front desk", description: "A's desk" });
    assert.equal(role.status, 201, JSON.stringify(role.body));
    A.roleId = role.data.roleId;
    const user = await a("POST", "/admin/users", {
      firstName: "Ana",
      lastName: "Alpha",
      email: "ana@alpha.test",
      password: TEMPORARY_PASSWORD,
      roleId: A.roleId,
    });
    assert.equal(user.status, 201, JSON.stringify(user.body));
    A.userId = user.data.accountId;
    A.ownerId = aOwner.accountId;
    A.ownerRoleId = await ctx.ownerRoleId();
    const perms = await a("GET", "/admin/permissions");
    A.permissionId = perms.data.permissions[0].permissionId;
    const override = await a("POST", `/admin/user-permissions/${A.userId}`, {
      permissionId: A.permissionId,
      accessLevel: "read",
    });
    assert.ok([200, 201].includes(override.status), JSON.stringify(override.body));
    A.userPermissionId = override.data.userPermissionId;
  });
  after(async () => {
    await ctx?.stop();
  });

  const userRow = async (accountId) =>
    (await ctx.sql.query(`SELECT firstName, roleId, status FROM users WHERE accountId = ?`, [accountId]))[0][0];
  const roleRow = async (roleId) =>
    (await ctx.sql.query(`SELECT roleName, status FROM roles WHERE roleId = ?`, [roleId]))[0][0];

  for (const who of ["staff", "owner"]) {
    describe(`company B's ${who}`, () => {
      const B = () => as(who === "staff" ? bStaff : b.owner);

      it("doesn't see company A's users and can't read, edit or delete them", async () => {
        const list = await B()("GET", "/admin/users?pageSize=100");
        assert.equal(list.status, 200);
        const ids = list.data.users.map((u) => u.accountId);
        assert.ok(!ids.includes(A.userId) && !ids.includes(A.ownerId));

        for (const id of [A.userId, A.ownerId]) {
          assert.equal((await B()("GET", `/admin/users/${id}`)).status, 404);
          const before_ = await userRow(id);
          const edit = await B()("PUT", `/admin/users/${id}`, {
            firstName: "Hacked",
            lastName: "X",
            roleId: (await B()("GET", "/admin/roles?pageSize=100")).data.roles[0]?.roleId || A.roleId,
            status: "Active",
          });
          assert.ok([400, 404].includes(edit.status), JSON.stringify(edit.body));
          assert.equal((await B()("DELETE", `/admin/users/${id}`)).status, 404);
          assert.deepEqual(await userRow(id), before_);
        }
      });

      it("can't give a user company A's role, or reuse company A's staff email", async () => {
        const res = await B()("POST", "/admin/users", {
          firstName: "Bea",
          lastName: "Beta",
          email: `bea-${who}@beta.test`,
          password: TEMPORARY_PASSWORD,
          roleId: A.roleId,
        });
        assert.equal(res.status, 400);
        const ownerRole = await B()("POST", "/admin/users", {
          firstName: "Bea",
          lastName: "Beta",
          email: `bea2-${who}@beta.test`,
          password: TEMPORARY_PASSWORD,
          roleId: A.ownerRoleId,
        });
        assert.equal(ownerRole.status, 400);

        const role = await B()("POST", "/admin/roles", { roleName: `B role ${who}` });
        assert.equal(role.status, 201);
        const dupEmail = await B()("POST", "/admin/users", {
          firstName: "Copy",
          lastName: "Cat",
          email: "ana@alpha.test",
          password: TEMPORARY_PASSWORD,
          roleId: role.data.roleId,
        });
        assert.equal(dupEmail.status, 409);
      });

      it("doesn't see company A's roles and can't read, edit, delete or re-permission them", async () => {
        const list = await B()("GET", "/admin/roles?pageSize=100");
        assert.ok(!list.data.roles.some((r) => r.roleId === A.roleId || r.roleId === A.ownerRoleId));

        for (const id of [A.roleId, A.ownerRoleId]) {
          const before_ = await roleRow(id);
          assert.equal((await B()("GET", `/admin/roles/${id}`)).status, 404);
          assert.equal(
            (await B()("PUT", `/admin/roles/${id}`, { roleName: "Hacked", status: "Active" })).status,
            404
          );
          assert.equal((await B()("DELETE", `/admin/roles/${id}`)).status, 404);
          const perms = await B()("GET", `/admin/roles/${id}/permissions`);
          assert.deepEqual(perms.data.permissions, []);
          assert.equal(
            (
              await B()("POST", `/admin/roles/${id}/permissions`, {
                permissions: [{ permissionId: A.permissionId, accessLevel: "write" }],
              })
            ).status,
            404
          );
          assert.deepEqual(await roleRow(id), before_);
        }
        const [[count]] = await ctx.sql.query(`SELECT COUNT(*) AS n FROM role_permissions WHERE roleId = ?`, [
          A.roleId,
        ]);
        assert.equal(count.n, 0);
      });

      it("can't read or change company A's users' permission overrides", async () => {
        assert.equal((await B()("GET", `/admin/user-permissions/${A.userId}`)).status, 404);
        assert.equal(
          (
            await B()("POST", `/admin/user-permissions/${A.userId}`, {
              permissionId: A.permissionId,
              accessLevel: "write",
            })
          ).status,
          404
        );
        assert.equal(
          (await B()("POST", `/admin/user-permissions/${A.userId}/bulk`, { permissions: [] })).status,
          404
        );
        assert.equal(
          (await B()("DELETE", `/admin/user-permissions/${A.userId}/${A.userPermissionId}`)).status,
          404
        );
        const [rows] = await ctx.sql.query(`SELECT accessLevel FROM user_permissions WHERE accountId = ?`, [
          A.userId,
        ]);
        assert.deepEqual(
          rows.map((r) => r.accessLevel),
          ["read"]
        );
      });

      it("doesn't see company A's audit trail", async () => {
        const list = await B()("GET", "/admin/audit-trail?pageSize=100");
        assert.equal(list.status, 200);
        assert.ok(list.data.logs.length > 0, "B's own actions are listed");
        assert.ok(!list.data.logs.some((l) => [A.ownerId, A.userId].includes(l.accountId)));
        const byAccount = await B()("GET", `/admin/audit-trail?accountId=${A.ownerId}`);
        assert.equal(byAccount.data.logs.length, 0);
        const [[aLog]] = await ctx.sql.query(`SELECT auditId FROM audit_trail WHERE accountId = ? LIMIT 1`, [
          A.ownerId,
        ]);
        assert.equal((await B()("GET", `/admin/audit-trail/${aLog.auditId}`)).status, 404);
        const csv = await ctx.get("/api/v1/admin/audit-trail/export", {
          headers: { Authorization: `Bearer ${(who === "staff" ? bStaff : b.owner).token}` },
        });
        assert.equal(csv.status, 200);
        assert.ok(!(await csv.text()).includes(A.ownerId));
      });
    });
  }

  it("role names are unique per company, not across companies", async () => {
    const B = as(b.owner);
    assert.equal((await B("POST", "/admin/roles", { roleName: "Front desk" })).status, 201);
    assert.equal((await B("POST", "/admin/roles", { roleName: "Front desk" })).status, 409);
    assert.equal((await a("POST", "/admin/roles", { roleName: "Front desk" })).status, 409);
  });

  it("company A sees none of company B's people or audit rows", async () => {
    const users = await a("GET", "/admin/users?pageSize=100");
    assert.ok(!users.data.users.some((u) => [b.owner.accountId, bStaff.accountId].includes(u.accountId)));
    assert.equal((await a("GET", `/admin/users/${bStaff.accountId}`)).status, 404);
    const roles = await a("GET", "/admin/roles?pageSize=100");
    assert.ok(!roles.data.roles.some((r) => r.roleId === bStaff.roleId));
    assert.equal((await a("GET", `/admin/roles/${bStaff.roleId}`)).status, 404);


    const audit = await a("GET", "/admin/audit-trail?pageSize=100");
    assert.ok(!audit.data.logs.some((l) => [b.owner.accountId, bStaff.accountId].includes(l.accountId)));
  });

  it("/me and login name the caller's company", async () => {
    const me = await as(b.owner)("GET", "/admin/auth/me");
    assert.equal(me.status, 200);
    assert.equal(me.data.user.companyId, b.companyId);
    assert.equal(me.data.user.companyName, "Rival Courts");
    const login = await ctx.login(bStaff.email, STAFF_PASSWORD);
    assert.equal(login.user.companyId, b.companyId);
    assert.equal(login.user.companyName, "Rival Courts");
  });
});
