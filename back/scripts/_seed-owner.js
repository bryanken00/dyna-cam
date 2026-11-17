/**
 * Shared seed: the Owner role and the first Owner account (used by
 * setup-database*.js). Run it after the permissions are seeded.
 *
 * The Owner role holds every active permission. It is never listed or editable
 * in the Admin portal, and neither is an account that has it. On every run the
 * role is granted any permission it does not have yet, so a permission added
 * later reaches the Owner by running setup again.
 *
 * There is no fixed default password. The first password comes from
 * OWNER_PASSWORD, or a random one is generated and printed once. Either way the
 * account is created with mustChangePassword = 1, so the API accepts nothing
 * from it but a password change until a new one is chosen.
 *
 * Env (both optional):
 *   OWNER_EMAIL     login email (default: owner@template.com)
 *   OWNER_PASSWORD  first password (default: random, printed once)
 */

import crypto from "node:crypto";

import { passwordProblem } from "../server/src/utils/passwordPolicy.js";

const DEFAULT_EMAIL = "owner@template.com";
const MIN_PASSWORD_LENGTH = 8; // same minimum the API enforces

function firstPassword() {
  const fromEnv = process.env.OWNER_PASSWORD;
  if (!fromEnv) {
    // 16 characters from [A-Za-z0-9_-]
    return { password: crypto.randomBytes(12).toString("base64url"), generated: true };
  }

  if (fromEnv.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`OWNER_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  // The same rule the API applies to every new password
  const problem = passwordProblem(fromEnv, {
    email: process.env.OWNER_EMAIL || DEFAULT_EMAIL,
  });
  if (problem) {
    throw new Error(`OWNER_PASSWORD refused: ${problem}`);
  }
  return { password: fromEnv, generated: false };
}

/**
 * Throws if OWNER_PASSWORD is set but unusable. Call before any destructive
 * step so a bad value fails the script early.
 */
export function checkOwnerSeedEnv() {
  firstPassword();
}

/**
 * Find or create the Owner role, then grant it every active permission it does
 * not have yet (as `write`).
 * @returns {Promise<string>} the Owner roleId
 */
async function seedOwnerRole(connection, timestamp) {
  // The first Owner role ever created — role names are unique, but never let a
  // later row (however it got the name) be the one granted every permission
  const [existing] = await connection.query(
    `SELECT roleId FROM roles WHERE roleName = 'Owner' AND status = 'Active' ORDER BY id LIMIT 1`
  );

  let roleId = existing[0]?.roleId;
  if (!roleId) {
    const [uuidRow] = await connection.query(`SELECT UUID() as id`);
    roleId = uuidRow[0].id;
    await connection.query(
      `INSERT INTO roles (roleId, roleName, description, status, dateCreated, dateUpdated)
       VALUES (?, 'Owner', 'Full access owner role. Not visible in Admin portal.', 'Active', ?, ?)`,
      [roleId, timestamp, timestamp]
    );
    console.log("   ✅ Owner role created");
  }

  const [granted] = await connection.query(
    `INSERT INTO role_permissions (roleId, permissionId, accessLevel, dateCreated)
     SELECT ?, p.permissionId, 'write', ?
     FROM permissions p
     WHERE p.status = 'Active'
       AND NOT EXISTS (
         SELECT 1 FROM role_permissions rp
         WHERE rp.roleId = ? AND rp.permissionId = p.permissionId
       )`,
    [roleId, timestamp, roleId]
  );
  if (granted.affectedRows > 0) {
    console.log(`   ✅ ${granted.affectedRows} permission(s) granted to the Owner role`);
  }

  return roleId;
}

/**
 * Create the Owner role (or top up its permissions) and the first Owner
 * account, unless an Owner account already exists.
 *
 * @param {import("mysql2/promise").Connection} connection - database already selected
 * @param {{ timestamp: string, hashPassword: (password: string) => Promise<string> }} options
 * @returns {Promise<boolean>} true when an account was created
 */
export async function seedOwner(connection, { timestamp, hashPassword }) {
  const roleId = await seedOwnerRole(connection, timestamp);

  const [existing] = await connection.query(
    `SELECT accountId FROM users WHERE roleId = ? AND status != 'Deleted' LIMIT 1`,
    [roleId]
  );
  if (existing.length > 0) {
    console.log("   ⏭️  An Owner account already exists — skipping");
    return false;
  }

  const email = process.env.OWNER_EMAIL || DEFAULT_EMAIL;
  const { password, generated } = firstPassword();

  const [uuidRow] = await connection.query(`SELECT UUID() as id`);
  const accountId = uuidRow[0].id;

  await connection.query(
    `INSERT INTO users (accountId, firstName, lastName, roleId, status, dateCreated, dateUpdated)
     VALUES (?, 'System', 'Owner', ?, 'Active', ?, ?)`,
    [accountId, roleId, timestamp, timestamp]
  );

  await connection.query(
    `INSERT INTO credentials (accountId, email, password, type, status, mustChangePassword, dateCreated, dateUpdated)
     VALUES (?, ?, ?, 'ADMIN', 'Active', 1, ?, ?)`,
    [accountId, email, await hashPassword(password), timestamp, timestamp]
  );

  console.log("\n   📋 Owner login (Admin portal):");
  console.log(`      Email:    ${email}`);
  console.log(
    generated
      ? `      Password: ${password}   ← generated now, shown only this once`
      : "      Password: the value of OWNER_PASSWORD"
  );
  console.log("      You will be asked to choose a new password at first login.");

  return true;
}
