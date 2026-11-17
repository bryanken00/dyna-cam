/**
 * Test harness: a throwaway database + the real Express app.
 *
 * Each test file calls startTestApp() once. It
 *   1. creates a database named `tpl_test_<pid>_<random>` on the MySQL server
 *      from DB_HOST / DB_USER / DB_PASS (back/.env, or real environment variables),
 *   2. runs the real `scripts/setup-database.js` against it (schema, migrations,
 *      permissions, the Owner role and first Owner account),
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

// The seeded Owner (setup-database.js reads OWNER_EMAIL / OWNER_PASSWORD)
export const OWNER = { email: "owner@template.com", password: "Test-Root-Passw0rd-1" };
export const OWNER_PASSWORD = OWNER.password;
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
    UPLOAD_URL_SECRET: crypto.randomBytes(32).toString("hex"),
    SMTP_HOST: "", // never send real email
    OWNER_EMAIL: OWNER.email,
    OWNER_PASSWORD: OWNER.password,
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
   * @param {Object} [options.headers]
   * @returns {Promise<{ status: number, body: any, data: any }>}
   */
  const api = async (method, url, { body, form, token, headers = {} } = {}) => {
    const init = { method, headers: { ...headers } };
    if (token) init.headers.Authorization = `Bearer ${token}`;

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

  /** Fetch a non-API path (e.g. an upload link). Returns the raw Response. */
  const get = (pathAndQuery) => fetch(`${baseUrl}${pathAndQuery}`);

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
    const [[row]] = await sql.query(`SELECT roleId FROM roles WHERE roleName = 'Owner' LIMIT 1`);
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
  const createStaff = async (label, { access = null } = {}) => {
    const { token } = await owner();
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
   * Add a recorder box to a venue the only way there is (PLAN-002 Phase F): a
   * 6-digit key from the Admin portal, redeemed at /pair/device. Each call
   * comes from its own documentation-range IP, so the per-IP pairing limits
   * don't trip in suites that add several boxes.
   * @returns {Promise<{ status: number, data: { token: string, deviceId: string, name: string } }>}
   */
  let boxCount = 0;
  const pairBox = async (adminToken, venueId, name = "Box") => {
    const key = await api("POST", "/admin/pairing-codes/recorders", {
      token: adminToken,
      body: { venueId, name },
    });
    if (key.status !== 201) return key;
    boxCount += 1;
    const paired = await api("POST", "/pair/device", {
      body: { code: key.data.code, agentVersion: "test" },
      headers: { "X-Forwarded-For": `198.51.100.${boxCount % 250}` },
    });
    if (paired.status !== 201) return paired;
    return {
      status: 201,
      data: {
        token: paired.data.token,
        deviceId: paired.data.device.deviceId,
        name: paired.data.device.name,
      },
    };
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

  return {
    api,
    get,
    login,
    owner,
    ownerRoleId,
    createStaff,
    pairBox,
    issueResetToken,
    sql,
    db,
    database,
    workDir,
    stop,
    importFromBack,
  };
}
