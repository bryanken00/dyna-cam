import crypto from "node:crypto";
import { getCurrentTimestampLocal } from "./dateUtils.js";
import { hashPassword } from "./hashing/argonHash.js";
import { passwordProblem } from "./passwordPolicy.js";

/**
 * PLAN-008: companies (the tenants DGSports onboards from the back office). A new
 * company gets, in the caller's transaction:
 *   - its `companies` row (Active);
 *   - its own **Owner** role holding every active permission (`write`) — hidden from
 *     the company's Users and Roles, like the setup Owner;
 *   - the Owner account, with a temporary password it must change at first sign-in.
 * Settings need no rows: a company without them gets the defaults.
 */

/** "BigPickle Inc." → "bigpickle-inc" (the URL-safe default for a company's slug). */
export const slugify = (value) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

/** A temporary password the policy accepts (shown once, changed at first sign-in). */
export const temporaryPassword = (email) => {
  for (;;) {
    const password = crypto.randomBytes(12).toString("base64url");
    if (!passwordProblem(password, { email })) return password;
  }
};

/**
 * Create a company with its Owner. Run inside a transaction (`conn` from
 * req.db.beginTransaction()); the caller commits.
 *
 * @param {import("mysql2/promise").PoolConnection} conn
 * @param {Object} company
 * @param {string} company.name
 * @param {string} [company.slug] - defaults to slugify(name)
 * @param {string|null} [company.contactEmail]
 * @param {string|null} [company.contactPhone]
 * @param {{ firstName: string, lastName: string, email: string, password?: string }} company.owner
 * @returns {Promise<{ ok: true, companyId: string, slug: string, ownerAccountId: string,
 *   ownerRoleId: string, ownerPassword: string } | { ok: false, status: number, message: string }>}
 */
export const createCompany = async (conn, { name, slug, contactEmail = null, contactPhone = null, owner }) => {
  const now = getCurrentTimestampLocal();
  const companySlug = slug || slugify(name);
  if (!companySlug) return { ok: false, status: 400, message: "Give the company a name with letters or numbers" };

  const [slugTaken] = await conn.execute(`SELECT 1 FROM companies WHERE slug = ? LIMIT 1 FOR UPDATE`, [
    companySlug,
  ]);
  if (slugTaken.length > 0) {
    return { ok: false, status: 409, message: `The company link "${companySlug}" is already used — pick another` };
  }
  // One staff email = one company (credentials.email is unique platform-wide)
  const [emailTaken] = await conn.execute(
    `SELECT 1 FROM credentials WHERE email = ? AND status != 'Deleted' LIMIT 1 FOR UPDATE`,
    [owner.email]
  );
  if (emailTaken.length > 0) {
    return { ok: false, status: 409, message: "That email already has a staff account" };
  }

  const password = owner.password || temporaryPassword(owner.email);
  const problem = passwordProblem(password, { email: owner.email });
  if (problem) return { ok: false, status: 400, message: problem };

  const [[{ companyId }]] = await conn.execute(`SELECT UUID() AS companyId`);
  await conn.execute(
    `INSERT INTO companies (companyId, name, slug, contactEmail, contactPhone, status, dateCreated, dateUpdated)
     VALUES (?, ?, ?, ?, ?, 'Active', ?, ?)`,
    [companyId, name, companySlug, contactEmail, contactPhone, now, now]
  );

  const [[{ roleId }]] = await conn.execute(`SELECT UUID() AS roleId`);
  await conn.execute(
    `INSERT INTO roles (roleId, companyId, roleName, description, status, dateCreated, dateUpdated)
     VALUES (?, ?, 'Owner', 'Full access owner role. Not visible in Admin portal.', 'Active', ?, ?)`,
    [roleId, companyId, now, now]
  );
  await conn.execute(
    `INSERT INTO role_permissions (roleId, permissionId, accessLevel, dateCreated)
     SELECT ?, p.permissionId, 'write', ? FROM permissions p WHERE p.status = 'Active'`,
    [roleId, now]
  );

  const [[{ accountId }]] = await conn.execute(`SELECT UUID() AS accountId`);
  await conn.execute(
    `INSERT INTO users (accountId, companyId, firstName, lastName, roleId, status, dateCreated, dateUpdated)
     VALUES (?, ?, ?, ?, ?, 'Active', ?, ?)`,
    [accountId, companyId, owner.firstName, owner.lastName, roleId, now, now]
  );
  await conn.execute(
    `INSERT INTO credentials (accountId, email, password, type, status, mustChangePassword, dateCreated, dateUpdated)
     VALUES (?, ?, ?, 'ADMIN', 'Active', 1, ?, ?)`,
    [accountId, owner.email, await hashPassword(password), now, now]
  );

  return {
    ok: true,
    companyId,
    slug: companySlug,
    ownerAccountId: accountId,
    ownerRoleId: roleId,
    ownerPassword: password,
  };
};
