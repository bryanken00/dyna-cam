// Sign-in hardening (review finding F6): per-account lockout, the password
// rule, passwords stored exactly as typed, short token lifetimes, and that a
// password change keeps the caller signed in while ending other sessions.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { BACK, OWNER_PASSWORD, startTestApp } from "./helpers/testApp.js";

const argon2 = createRequire(path.join(BACK, "package.json"))("argon2");

describe("login security", () => {
  let ctx;
  let owner;
  let staffRoleId;
  let n = 0;

  const signIn = (email, password) =>
    ctx.api("POST", "/admin/auth/login", { body: { email, password } });
  const credentialOf = async (email) => {
    const [[row]] = await ctx.sql.query(
      `SELECT accountId, password, failedLoginAttempts, lockedUntil, mustChangePassword
       FROM credentials WHERE email = ?`,
      [email]
    );
    return row;
  };
  // A staff user created by the Owner, with the given first password
  const createUser = async (password, email = `staff-${++n}@example.test`) => {
    const response = await ctx.api("POST", "/admin/users", {
      token: owner.token,
      body: { firstName: "Sam", lastName: "Staff", email, password, roleId: staffRoleId },
    });
    return { email, password, response };
  };
  const claims = (jwt) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());

  before(async () => {
    ctx = await startTestApp();
    owner = await ctx.owner();
    const role = await ctx.api("POST", "/admin/roles", {
      token: owner.token,
      body: { roleName: "Staff" },
    });
    staffRoleId = role.data.roleId;
  });

  after(() => ctx?.stop());

  describe("account lockout", () => {
    let user;

    before(async () => {
      user = await createUser("Lock-Me-Out-1!");
      assert.equal(user.response.status, 201);
    });

    it("counts wrong passwords and locks the account on the fifth", async () => {
      for (let attempt = 1; attempt <= 4; attempt++) {
        const response = await signIn(user.email, "wrong-password");
        assert.equal(response.status, 401, `attempt ${attempt}`);
      }
      assert.equal((await credentialOf(user.email)).failedLoginAttempts, 4);

      const fifth = await signIn(user.email, "wrong-password");
      assert.equal(fifth.status, 423);
      assert.equal(fifth.body.code, "ACCOUNT_LOCKED");
      assert.ok((await credentialOf(user.email)).lockedUntil);
    });

    it("refuses even the correct password while locked", async () => {
      const response = await signIn(user.email, user.password);
      assert.equal(response.status, 423);
    });

    it("lets the user in again once the lock has run out", async () => {
      await ctx.sql.query(
        `UPDATE credentials SET lockedUntil = '2020-01-01 00:00:00' WHERE email = ?`,
        [user.email]
      );
      assert.equal((await signIn(user.email, user.password)).status, 200);
      const credential = await credentialOf(user.email);
      assert.equal(credential.failedLoginAttempts, 0);
      assert.equal(credential.lockedUntil, null);
    });

    it("starts counting from zero after a successful sign-in", async () => {
      await signIn(user.email, "wrong-password");
      await signIn(user.email, "wrong-password");
      assert.equal((await signIn(user.email, user.password)).status, 200);
      for (let attempt = 1; attempt <= 4; attempt++) {
        assert.equal((await signIn(user.email, "wrong-password")).status, 401);
      }
      assert.equal((await signIn(user.email, user.password)).status, 200, "four is not five");
    });
  });

  describe("password rule", () => {
    it("refuses a well-known weak password for a new user", async () => {
      for (const weak of ["Password123", "qwerty12345", "1234567890", "aaaaaaaaaa"]) {
        const { response } = await createUser(weak);
        assert.equal(response.status, 400, weak);
        assert.match(response.body.message, /too common/, "the reason reaches the user");
      }
    });

    it("refuses a password that contains the email name", async () => {
      const { response } = await createUser("xx-Maria.Santos-99", "maria.santos@example.test");
      assert.equal(response.status, 400);
      assert.match(response.body.message, /email/i);
    });

    it("refuses a weak password on change, and accepts a good one", async () => {
      const change = (newPassword) =>
        ctx.api("PUT", "/admin/auth/me/password", {
          token: owner.token,
          body: { currentPassword: OWNER_PASSWORD, newPassword },
        });
      assert.equal((await change("password123")).status, 400);
      assert.equal((await change("zz-owner-zz-1")).status, 400, "contains the email name");
      assert.equal((await signIn(owner.email, OWNER_PASSWORD)).status, 200, "unchanged");
    });
  });

  describe("passwords are stored exactly as typed", () => {
    const TRICKY = "Tom & <Jerry>  1!";

    it("accepts a password with &, <, > and double spaces, and only that exact password", async () => {
      const user = await createUser(TRICKY);
      assert.equal(user.response.status, 201);
      assert.equal((await signIn(user.email, TRICKY)).status, 200);
      assert.equal((await signIn(user.email, "Tom &amp; 1!")).status, 401, "the old altered form");
      assert.ok(await argon2.verify((await credentialOf(user.email)).password, TRICKY));
    });

    it("still signs in an account whose password was stored in the old altered form, then fixes it", async () => {
      const user = await createUser("Placeholder-Pass-1!");
      // What older versions stored for TRICKY: tags removed, & escaped, spaces collapsed
      const { legacySanitizedPassword } = await ctx.importFromBack("server/src/utils/security.js");
      const legacy = legacySanitizedPassword(TRICKY);
      assert.equal(legacy, "Tom &amp; 1!");
      await ctx.sql.query(`UPDATE credentials SET password = ? WHERE email = ?`, [
        await argon2.hash(legacy, { type: argon2.argon2id }),
        user.email,
      ]);

      assert.equal((await signIn(user.email, TRICKY)).status, 200);
      const stored = (await credentialOf(user.email)).password;
      assert.ok(await argon2.verify(stored, TRICKY), "re-hashed from the real password");
      assert.equal(await argon2.verify(stored, legacy), false);
    });
  });

  describe("sessions", () => {
    it("issues a 15-minute access token and a 7-day refresh token", async () => {
      const session = await ctx.login(owner.email, OWNER_PASSWORD);
      const access = claims(session.token);
      const refresh = claims(session.refreshToken);
      assert.equal(access.exp - access.iat, 15 * 60);
      assert.equal(refresh.exp - refresh.iat, 7 * 24 * 60 * 60);
    });

    it("flags an account created by an admin for a first-login password change", async () => {
      const user = await createUser("First-Login-Pass-1!");
      const response = await signIn(user.email, user.password);
      assert.equal(response.status, 200);
      assert.equal(response.data.user.mustChangePassword, true);
    });

    it("keeps the caller signed in after a password change and ends other sessions", async () => {
      const user = await createUser("First-Login-Pass-2!");
      const here = (await signIn(user.email, user.password)).data;
      const elsewhere = (await signIn(user.email, user.password)).data;

      const change = await ctx.api("PUT", "/admin/auth/me/password", {
        token: here.token,
        body: { currentPassword: user.password, newPassword: "My-Own-Passw0rd-7" },
      });
      assert.equal(change.status, 200);

      const refresh = (refreshToken) =>
        ctx.api("POST", "/admin/auth/refresh", { body: { refreshToken } });
      assert.equal(
        (await refresh(change.data.refreshToken.token)).status,
        200,
        "new session works"
      );
      assert.equal((await refresh(elsewhere.refreshToken.token)).status, 401, "other device ended");

      const [[flag]] = await ctx.sql.query(
        `SELECT mustChangePassword FROM credentials WHERE email = ?`,
        [user.email]
      );
      assert.equal(flag.mustChangePassword, 0);
    });

    it("clears a lock when the password is reset", async () => {
      const user = await createUser("Reset-Clears-Lock-1!");
      for (let attempt = 1; attempt <= 5; attempt++) await signIn(user.email, "wrong-password");
      assert.equal((await signIn(user.email, user.password)).status, 423);

      const token = await ctx.issueResetToken((await credentialOf(user.email)).accountId);

      const weak = await ctx.api("POST", "/admin/auth/reset-password", {
        body: { token, password: "password123" },
      });
      assert.equal(weak.status, 400, "the weak password is refused");

      const reset = await ctx.api("POST", "/admin/auth/reset-password", {
        body: { token, password: "After-Reset-Pass-3!" },
      });
      assert.equal(reset.status, 200, "the same link still works with a good password");
      assert.equal((await signIn(user.email, "After-Reset-Pass-3!")).status, 200);
    });
  });
});
