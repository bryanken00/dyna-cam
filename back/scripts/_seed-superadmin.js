/**
 * PLAN-008 — shared seed: the first back-office super admin, the ONLY account
 * `npm run db:setup` creates (setup-database*.js, after the migrations). The back
 * office has no sign-up, so this is how the first DGSports person gets in; they
 * add the other super admins and onboard companies (each with its Owner) there.
 *
 * Both SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD are required until a super admin
 * exists. The password is the one the installer chose in back/.env, so there is no
 * forced change at first sign-in (mustChangePassword = 0) — super admins added later
 * in the back office get a temporary password they must change.
 *
 * Env:
 *   SUPERADMIN_EMAIL     back-office login email
 *   SUPERADMIN_PASSWORD  its password: 8+ characters, not a well-known weak one
 */

import { passwordProblem } from "../server/src/utils/passwordPolicy.js";

const MIN_PASSWORD_LENGTH = 8; // same minimum the API enforces

const settings = () => ({
  email: (process.env.SUPERADMIN_EMAIL || "").trim().toLowerCase(),
  password: process.env.SUPERADMIN_PASSWORD || "",
});

/** Throws if SUPERADMIN_PASSWORD is unusable. */
function checkPassword(password, email) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`SUPERADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const problem = passwordProblem(password, { email });
  if (problem) {
    throw new Error(`SUPERADMIN_PASSWORD refused: ${problem}`);
  }
}

/** Throws if SUPERADMIN_PASSWORD is set but unusable (call before destructive steps). */
export function checkSuperAdminSeedEnv() {
  const { email, password } = settings();
  if (password) checkPassword(password, email);
}

/**
 * @param {import("mysql2/promise").Connection} connection - database already selected
 * @param {{ timestamp: string, hashPassword: (password: string) => Promise<string> }} options
 * @returns {Promise<boolean>} true when an account was created
 */
export async function seedSuperAdmin(connection, { timestamp, hashPassword }) {
  const { email, password } = settings();
  const [existing] = await connection.query(
    `SELECT platformAdminId FROM platform_admins WHERE status != 'Deleted' LIMIT 1`
  );
  if (existing.length > 0) {
    console.log("   ⏭️  A back-office super admin already exists — skipping");
    return false;
  }
  if (!email) {
    throw new Error(
      "Set SUPERADMIN_EMAIL in back/.env — setup creates the first back-office super admin, who onboards companies"
    );
  }
  if (!password) {
    throw new Error("Set SUPERADMIN_PASSWORD in back/.env — the first back-office super admin's password");
  }
  checkPassword(password, email);

  const [uuidRow] = await connection.query(`SELECT UUID() as id`);
  await connection.query(
    `INSERT INTO platform_admins
       (platformAdminId, firstName, lastName, email, password, status, mustChangePassword,
        dateCreated, dateUpdated)
     VALUES (?, 'DGSports', 'Admin', ?, ?, 'Active', 0, ?, ?)`,
    [uuidRow[0].id, email, await hashPassword(password), timestamp, timestamp]
  );

  console.log("\n   📋 Super admin login (back office, /backoffice):");
  console.log(`      Email:    ${email}`);
  console.log("      Password: the value of SUPERADMIN_PASSWORD");
  return true;
}
