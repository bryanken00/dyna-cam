/**
 * Test harness: a throwaway database + the real Express app.
 *
 * Each test file calls startTestApp() once. It
 *   1. creates a database named `tpl_test_<pid>_<random>` on the MySQL server
 *      from DB_HOST / DB_USER / DB_PASS (back/.env, or real environment variables),
 *   2. runs the real `scripts/setup-database.js` against it (schema, migrations,
 *      permissions and the first back-office super admin — PLAN-008: nothing else),
 *      then onboards the "Default company" (slug "default") with its Owner the way
 *      the back office does (utils/companies.js), so tests have a company to work in,
 *   3. starts the real app (server/config/express.js) on a random port, from a
 *      temp working directory so uploads never land in back/public,
 *   4. and on stop() drops the database and the temp directory.
 *
 * The database named in DB_DATABASE is never opened. See
 * .claude/skills/backend-conventions/references/testing.md.
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import dotenv from "dotenv";
import mysql from "mysql2/promise";

export const BACK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TEST_DB_PREFIX = "tpl_test_";

// The default company's Owner, onboarded by startTestApp() (setup makes no Owner — PLAN-008)
export const OWNER = { email: "owner@template.com", password: "Test-Root-Passw0rd-1" };
export const OWNER_PASSWORD = OWNER.password;
// PLAN-008 phase B: the seeded back-office super admin (SUPERADMIN_EMAIL / _PASSWORD)
export const SUPERADMIN = { email: "superadmin@dgsports.test", password: "Test-Super-Passw0rd-1" };
// What the Owner types when creating a staff user; the user must replace it at first login
export const TEMPORARY_PASSWORD = "Temp-First-Passw0rd";
// What a staff user made by createStaff() chooses at first login
export const STAFF_PASSWORD = "Test-Staff-Passw0rd";

// Smallest byte sequences that pass the upload content checks
export const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);

const importFromBack = (relativePath) => import(pathToFileURL(path.join(BACK, relativePath)).href);

/**
 * Run a script from back/scripts against the given database.
 * @returns {{ ok: boolean, output: string }}
 */
/** Like runScript, with command-line arguments (e.g. `boxes.js revoke <name>`). */
export const runScriptArgs = (script, args = [], env = {}) => {
  try {
    const output = execFileSync("node", [path.join("scripts", script), ...args], {
      cwd: BACK,
      env: { ...process.env, ...env },
      encoding: "utf-8",
      stdio: "pipe",
    });
    return { ok: true, output };
  } catch (err) {
    return { ok: false, output: `${err.stdout || ""}${err.stderr || ""}` };
  }
};

export const runScript = (script, env = {}) => {
  try {
    const output = execFileSync("node", [path.join("scripts", script)], {
      cwd: BACK,
      env: { ...process.env, ...env },
      encoding: "utf-8",
      stdio: "pipe",
    });
    return { ok: true, output };
  } catch (err) {
    return { ok: false, output: `${err.stdout || ""}${err.stderr || ""}` };
  }
};

/**
 * PLAN-008: setup creates only the super admin, so the tests' "Default company" and its
 * Owner (OWNER, temporary password — must change it at first sign-in) are onboarded here
 * exactly as the back office does it. Slug "default": the company that may use the
 * .env Xendit keys (utils/companyPayments.js).
 */
const onboardDefaultCompany = async (sql) => {
  const { createCompany } = await importFromBack("server/src/utils/companies.js");
  await sql.beginTransaction();
  try {
    const made = await createCompany(sql, {
      name: "Default company",
      slug: "default",
      owner: { firstName: "System", lastName: "Owner", email: OWNER.email, password: OWNER.password },
    });
    if (!made.ok) throw new Error(`Default company onboarding failed: ${made.message}`);
    await sql.commit();
  } catch (err) {
    await sql.rollback().catch(() => {});
    throw err;
  }
};

/** A connection with no database selected, for creating/dropping test databases. */
export const connectToServer = () =>
  mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || "3306"),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    multipleStatements: true,
    dateStrings: true,
  });

export const newTestDatabaseName = () =>
  `${TEST_DB_PREFIX}${process.pid}_${crypto.randomBytes(3).toString("hex")}`;

export const dropTestDatabase = async (connection, name) => {
  if (!name.startsWith(TEST_DB_PREFIX)) {
    throw new Error(`Refusing to drop "${name}": not a test database`);
  }
  await connection.query(`DROP DATABASE IF EXISTS \`${name}\``);
};

/** The enrol key every test app runs with (a file can override it via `env`). */
export const TEST_ENROLL_KEY = "test-enroll-key-0123456789abcdef0123456789abcdef";

/** Load back/.env (if present) and apply the settings every test run needs. */
export const loadTestEnv = (overrides = {}) => {
  dotenv.config({ path: path.join(BACK, ".env"), quiet: true });

  if (process.env.NODE_ENV === "production") {
    throw new Error("Tests must not run with NODE_ENV=production");
  }

  Object.assign(process.env, {
    NODE_ENV: "test",
    DISABLE_CSRF: "true", // CSRF has its own cookie flow; these tests exercise the API rules
    RATE_LIMIT_STORE: "memory",
    RATE_LIMIT_AUTH_POINTS: "1000",
    RATE_LIMIT_UPLOAD_POINTS: "1000",
    RATE_LIMIT_PWRESET_POINTS: "1000",
    // PLAN-006: every online booking in the tests signs a player in first
    RATE_LIMIT_PLAYER_SESSION_POINTS: "1000",
    RATE_LIMIT_PLAYER_SIGN_IN_POINTS: "1000",
    UPLOAD_URL_SECRET: crypto.randomBytes(32).toString("hex"),
    // Recorder boxes enrol with this (PLAN-002 Phase I); ctx.pairBox() uses it
    RECORDER_ENROLL_KEY: TEST_ENROLL_KEY,
    SENDGRID_API_KEY: "", // never send real email (a test that wants SendGrid fakes it)
    // Never reach Xendit (a test that wants online payment points XENDIT_API_URL at a fake)
    XENDIT_SECRET_KEY: "",
    XENDIT_CALLBACK_TOKEN: "",
    XENDIT_API_URL: "http://127.0.0.1:9",
    // CR-046: booking is paid online only, so every test runs with the built-in test
    // checkout on (its own store file per process); a test of real Xendit sets
    // PAYMENT_SANDBOX: "" and points XENDIT_API_URL at a fake. ctx.payBooking() pays.
    PAYMENT_SANDBOX: "true",
    PAYMENT_SANDBOX_FILE: path.join(
      os.tmpdir(),
      `tpl-sandbox-${process.pid}-${crypto.randomBytes(4).toString("hex")}.json`
    ),
    RATE_LIMIT_PUBLIC_PAY_POINTS: "1000",
    SUPERADMIN_EMAIL: SUPERADMIN.email,
    SUPERADMIN_PASSWORD: SUPERADMIN.password,
    // The app runs from a temp directory, so key paths must be absolute
    jwtAuthPrivatePath: path.resolve(
      BACK,
      process.env.jwtAuthPrivatePath || "./auth-keys/private.pem"
    ),
    jwtAuthPublicPath: path.resolve(
      BACK,
      process.env.jwtAuthPublicPath || "./auth-keys/public.pem"
    ),
    ...overrides,
  });
};

/**
 * @param {Object} [options]
 * @param {Object} [options.env] - extra environment variables for this file
 * @param {boolean} [options.keepFirstPasswordFlag] - leave the seeded Owner
 *   flagged mustChangePassword (only the first-password tests want that)
 */
export async function startTestApp({ env = {}, keepFirstPasswordFlag = false } = {}) {
  loadTestEnv(env);

  const database = newTestDatabaseName();
  if (database === process.env.DB_DATABASE) {
    throw new Error("Test database name clashes with DB_DATABASE");
  }
  process.env.DB_DATABASE = database;

  const setup = runScript("setup-database.js");
  if (!setup.ok) {
    throw new Error(`Test database setup failed:\n${setup.output}`);
  }

  const sql = await connectToServer();
  await sql.query(`USE \`${database}\``);
  await onboardDefaultCompany(sql);
  if (!keepFirstPasswordFlag) {
    await sql.query(`UPDATE credentials SET mustChangePassword = 0`);
  }

  // Uploads are written relative to the working directory — keep them out of back/public
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tpl-test-"));
  process.chdir(workDir);

  const { default: app, db } = await importFromBack("server/config/express.js");
  const { logger, httpLogger } = await importFromBack("server/config/logger.js");
  for (const transport of [...logger.transports, ...httpLogger.transports]) {
    transport.silent = true; // keep test output readable and back/logs untouched
  }
  await db.initialize();

  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  /**
   * Call the API.
   * @param {string} method
   * @param {string} url - path below /api/v1, e.g. "/admin/users"
   * @param {Object} [options]
   * @param {Object} [options.body] - JSON body
   * @param {Array} [options.form] - multipart parts, in order:
   *   [name, value] or [name, Buffer, mimeType, filename]
   * @param {string} [options.token] - access token
   * @param {string} [options.player] - PLAN-006: a player access token (`Authorization: Player …`)
   * @param {Object} [options.headers]
   * @returns {Promise<{ status: number, body: any, data: any }>}
   */
  const api = async (method, url, { body, form, token, player, headers = {} } = {}) => {
    const init = { method, headers: { ...headers } };
    if (token) init.headers.Authorization = `Bearer ${token}`;
    if (player) init.headers.Authorization = `Player ${player}`;

    if (form) {
      const formData = new FormData();
      for (const [name, value, mimeType, filename] of form) {
        if (Buffer.isBuffer(value)) {
          formData.append(name, new Blob([value], { type: mimeType }), filename);
        } else {
          formData.append(name, value);
        }
      }
      init.body = formData;
    } else if (body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const response = await fetch(`${baseUrl}/api/v1${url}`, init);
    const parsed = await response.json().catch(() => null);
    return { status: response.status, body: parsed, data: parsed?.data };
  };

  /**
   * Fetch a non-API path (e.g. an upload link). Returns the raw Response.
   * `init` is passed to fetch, e.g. `{ redirect: "manual" }` to see a redirect.
   */
  const get = (pathAndQuery, init) => fetch(`${baseUrl}${pathAndQuery}`, init);

  /** Sign in; throws if it fails. @returns {{ token, refreshToken, user }} */
  const login = async (email, password) => {
    const response = await api("POST", "/admin/auth/login", { body: { email, password } });
    if (response.status !== 200) {
      throw new Error(`Login failed for ${email}: ${response.status} ${response.body?.message}`);
    }
    return {
      token: response.data.token,
      refreshToken: response.data.refreshToken.token,
      user: response.data.user,
    };
  };

  /**
   * The seeded Owner's session (signed in once, then reused).
   * @returns {{ accountId, email, token, refreshToken, user }}
   */
  let ownerSession;
  const owner = async () => {
    if (!ownerSession) {
      const session = await login(OWNER.email, OWNER.password);
      ownerSession = { accountId: session.user.accountId, email: OWNER.email, ...session };
    }
    return ownerSession;
  };

  const expectOk = (response, label) => {
    if (response.status >= 300) {
      throw new Error(`${label} failed: ${response.status} ${JSON.stringify(response.body)}`);
    }
    return response.data;
  };

  /**
   * Store a password-reset link for an account, as forgot-password would have
   * emailed it. @returns {string} the token to send to /auth/reset-password
   */
  const issueResetToken = async (accountId) => {
    const token = crypto.randomBytes(32).toString("hex");
    await sql.query(
      `INSERT INTO password_reset_tokens (tokenHash, accountId, expiresAt, dateCreated)
       VALUES (?, ?, '2099-01-01 00:00:00', '2026-01-01 00:00:00')`,
      [crypto.createHash("sha256").update(token).digest("hex"), accountId]
    );
    return token;
  };

  /** The Owner role's ID — never reachable from the Admin portal. */
  const ownerRoleId = async () => {
    const [[row]] = await sql.query(`SELECT roleId FROM roles WHERE roleName = 'Owner' ORDER BY id LIMIT 1`);
    return row.roleId;
  };

  /**
   * Create a role and a staff user with it, through the Admin API as the Owner,
   * and do the user's first-login password change (to STAFF_PASSWORD).
   * @param {string} label - names the role ("<label> staff") and the user
   * @param {Object} [options]
   * @param {"read"|"write"|null} [options.access] - grant the role every
   *   permission at this level; null (default) grants none
   * @returns {{ accountId, email, roleId, token, refreshToken, user }}
   */
  const createStaff = async (label, { access = null, company = null } = {}) => {
    // PLAN-008: in another company (from createCompany()) — made by that company's Owner
    const { token } = company ? company.owner : await owner();
    const { roleId } = expectOk(
      await api("POST", "/admin/roles", { token, body: { roleName: `${label} staff` } }),
      "create role"
    );

    if (access) {
      const { permissions } = expectOk(
        await api("GET", "/admin/permissions", { token }),
        "list permissions"
      );
      expectOk(
        await api("POST", `/admin/roles/${roleId}/permissions`, {
          token,
          body: {
            permissions: permissions.map(({ permissionId }) => ({
              permissionId,
              accessLevel: access,
            })),
          },
        }),
        "assign permissions"
      );
    }

    const email = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@example.test`;
    const { accountId } = expectOk(
      await api("POST", "/admin/users", {
        token,
        body: { firstName: label, lastName: "Staff", email, password: TEMPORARY_PASSWORD, roleId },
      }),
      "create staff user"
    );

    // A new account must choose its own password before it can do anything
    // else, so do what the user would do at first login.
    const first = await login(email, TEMPORARY_PASSWORD);
    const changed = expectOk(
      await api("PUT", "/admin/auth/me/password", {
        token: first.token,
        body: { currentPassword: TEMPORARY_PASSWORD, newPassword: STAFF_PASSWORD },
      }),
      "staff user's first password change"
    );

    return {
      accountId,
      email,
      roleId,
      token: changed.token,
      refreshToken: changed.refreshToken.token,
      user: { ...first.user, mustChangePassword: false },
    };
  };

  /**
   * Add a recorder box to a venue the only way there is (PLAN-002 Phase I): it
   * enrols itself with RECORDER_ENROLL_KEY at /pair/enroll. Each call comes from
   * its own documentation-range IP, so the per-IP limits don't trip in suites
   * that add several boxes. (`adminToken` is unused, kept so call sites read the
   * same as before.)
   * @returns {Promise<{ status: number, data: { token: string, deviceId: string, name: string } }>}
   */
  let boxCount = 0;
  const pairBox = async (_adminToken, venueId, name = "Box") => {
    boxCount += 1;
    const enrolled = await api("POST", "/pair/enroll", {
      body: { enrollKey: process.env.RECORDER_ENROLL_KEY, venueId, name, agentVersion: "test" },
      headers: { "X-Forwarded-For": `198.51.100.${boxCount % 250}` },
    });
    if (enrolled.status !== 201) return enrolled;
    return {
      status: 201,
      data: {
        token: enrolled.data.token,
        deviceId: enrolled.data.device.deviceId,
        name: enrolled.data.device.name,
      },
    };
  };

  /**
   * CR-039: staff's New game is always free now, so a test about paying for a
   * game first turns it into one made before that — unpaid, with a pay code
   * from the app's own generator.
   * @returns {Promise<string>} the game's pay code
   */
  const makeUnpaid = async (sessionId) => {
    const { randomPayCode } = await importFromBack("server/src/utils/crypto/tokens.js");
    const payCode = randomPayCode();
    const [result] = await sql.query(
      `UPDATE recording_sessions SET paymentStatus = 'Unpaid', payCode = ? WHERE sessionId = ?`,
      [payCode, sessionId]
    );
    if (result.affectedRows !== 1) throw new Error(`makeUnpaid: no game ${sessionId}`);
    return payCode;
  };

  /**
   * CR-046: a game paid at the desk before cash was removed — as it's stored
   * (a CASH payment, the game Paid). The API can't record one any more.
   */
  const markGamePaid = async (sessionId, amount = 300) => {
    const [result] = await sql.query(
      `UPDATE recording_sessions SET paymentStatus = 'Paid' WHERE sessionId = ?`,
      [sessionId]
    );
    if (result.affectedRows !== 1) throw new Error(`markGamePaid: no game ${sessionId}`);
    const now = "UTC_TIMESTAMP() + INTERVAL 8 HOUR";
    await sql.query(
      `INSERT INTO payments
         (paymentId, sessionId, venueId, amount, method, status, paidAt, dateCreated, dateUpdated)
       SELECT UUID(), sessionId, venueId, ?, 'CASH', 'Paid', ${now}, ${now}, ${now}
       FROM recording_sessions WHERE sessionId = ?`,
      [amount, sessionId]
    );
  };

  /**
   * PLAN-006: a player signed in with Google. Google's own answer is skipped —
   * the player is made (or found) exactly as the callback does it, and the
   * sign-in code is traded through POST /player/session like the sign-in page.
   * The same email always gives the same player. Unless `completeProfile` is
   * false, the first-sign-in profile is then saved (PATCH /player/me) with
   * `name` split into first / last and `phone`, so the player can book.
   * @returns {Promise<{ token: string, refreshToken: string, email: string }>}
   */
  const signInPlayer = async ({
    email = "player@example.test",
    name = "Test Player",
    phone = "0917 000 0000",
    sub,
    completeProfile = true,
  } = {}) => {
    const { signInFromGoogle } = await importFromBack("server/src/utils/players.js");
    const [first, ...rest] = name.split(" ");
    const result = await signInFromGoogle(db, {
      sub: sub || `google-${email.toLowerCase()}`,
      email,
      name,
      givenName: first,
      familyName: rest.join(" ") || null,
      photoUrl: null,
    });
    if (!result.code) throw new Error(`signInPlayer(${email}): the player is blocked`);
    const res = await api("POST", "/player/session", { body: { code: result.code } });
    if (res.status !== 200) {
      throw new Error(`signInPlayer(${email}) → ${res.status}: ${JSON.stringify(res.body)}`);
    }
    const token = res.data.accessToken.token;
    if (completeProfile) {
      const saved = await api("PATCH", "/player/me", {
        player: token,
        body: { firstName: first, lastName: rest.join(" ") || "Player", phone },
      });
      if (saved.status !== 200) {
        throw new Error(`signInPlayer(${email}) profile → ${saved.status}: ${JSON.stringify(saved.body)}`);
      }
    }
    return { token, refreshToken: res.data.refreshToken.token, email };
  };

  /**
   * CR-046: pay a held booking online, the way a player does — open its checkout
   * from its booking page (POST /public/bookings/:manageToken/pay), pay it in the
   * test checkout, then settle it as reading the invoice back does
   * (utils/bookingPayments.js settleInvoice). The booking is then Confirmed / Paid.
   */
  const payBooking = async (bookingId) => {
    const [[row]] = await sql.query(`SELECT manageToken FROM bookings WHERE bookingId = ?`, [
      bookingId,
    ]);
    if (!row) throw new Error(`payBooking(${bookingId}): no such booking`);
    const pay = await api("POST", `/public/bookings/${row.manageToken}/pay`);
    if (pay.status !== 200) {
      throw new Error(`payBooking(${bookingId}) → ${pay.status}: ${JSON.stringify(pay.body)}`);
    }
    if (pay.data.paid) return;
    const checkoutId = pay.data.checkoutUrl.split("/").pop();
    const paid = await api("POST", `/public/payment-sandbox/${checkoutId}/pay`);
    if (paid.status !== 200) {
      throw new Error(`payBooking(${bookingId}) sandbox → ${paid.status}: ${JSON.stringify(paid.body)}`);
    }
    const { settleInvoice } = await importFromBack("server/src/utils/bookingPayments.js");
    await settleInvoice(db, checkoutId);
  };

  const stop = async () => {
    server.closeAllConnections(); // fetch keeps connections alive; don't wait for them
    await new Promise((resolve) => server.close(resolve));
    await db.close().catch(() => {});
    await dropTestDatabase(sql, database);
    await sql.end();
    process.chdir(BACK);
    fs.rmSync(workDir, { recursive: true, force: true });
  };

  /**
   * PLAN-008: onboard another company, as the back office does (utils/companies.js), and
   * sign its Owner in (first password change done).
   * @returns {{ companyId, slug, name, owner: { accountId, email, token, refreshToken, user } }}
   */
  let companyCount = 0;
  const createCompany = async (name) => {
    companyCount += 1;
    const label = name || `Company ${companyCount}`;
    const { createCompany: create, slugify } = await importFromBack("server/src/utils/companies.js");
    const email = `owner-${slugify(label)}-${companyCount}@example.test`;
    let conn;
    let made;
    try {
      conn = await db.beginTransaction();
      made = await create(conn, {
        name: label,
        slug: `${slugify(label)}-${companyCount}`,
        owner: { firstName: label, lastName: "Owner", email, password: TEMPORARY_PASSWORD },
      });
      if (!made.ok) throw new Error(`createCompany(${label}): ${made.message}`);
      await db.commit(conn);
    } catch (err) {
      if (conn) await db.rollback(conn).catch(() => {});
      throw err;
    }
    const first = await login(email, TEMPORARY_PASSWORD);
    const changed = expectOk(
      await api("PUT", "/admin/auth/me/password", {
        token: first.token,
        body: { currentPassword: TEMPORARY_PASSWORD, newPassword: STAFF_PASSWORD },
      }),
      "company Owner's first password change"
    );
    return {
      companyId: made.companyId,
      slug: made.slug,
      name: label,
      owner: {
        accountId: made.ownerAccountId,
        email,
        token: changed.token,
        refreshToken: changed.refreshToken.token,
        user: { ...first.user, mustChangePassword: false },
      },
    };
  };

  /**
   * PLAN-008: the seeded super admin's back-office session (signed in once, then
   * reused). Its password is SUPERADMIN_PASSWORD — no forced change for this account.
   * @returns {{ token, refreshToken, admin }}
   */
  let superAdminSession;
  const superAdmin = async () => {
    if (superAdminSession) return superAdminSession;
    const signedIn = await api("POST", "/backoffice/auth/login", {
      body: { email: SUPERADMIN.email, password: SUPERADMIN.password },
    });
    if (signedIn.status !== 200) {
      throw new Error(`super admin login failed: ${signedIn.status} ${JSON.stringify(signedIn.body)}`);
    }
    superAdminSession = {
      token: signedIn.data.token,
      refreshToken: signedIn.data.refreshToken.token,
      admin: signedIn.data.admin,
    };
    return superAdminSession;
  };

  return {
    api,
    get,
    login,
    owner,
    superAdmin,
    ownerRoleId,
    createStaff,
    createCompany,
    pairBox,
    makeUnpaid,
    markGamePaid,
    signInPlayer,
    payBooking,
    issueResetToken,
    sql,
    db,
    database,
    workDir,
    stop,
    importFromBack,
  };
}
