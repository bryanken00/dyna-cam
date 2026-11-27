/**
 * Database Setup Script (ESM)
 *
 * Applies all pending migrations (database/migrations/) then seeds default
 * permissions + the first back-office super admin (PLAN-008: nothing else — companies
 * and their Owners are onboarded in the back office). Additive and re-runnable — existing
 * tables and data are left untouched; seeds are skipped when already present.
 *
 * Usage: node scripts/setup-database.js
 */

import "dotenv/config";
import mysql from "mysql2/promise";
import argon2 from "argon2";
import moment from "moment-timezone";
import { runMigrations } from "./migrate.js";
import { checkSuperAdminSeedEnv, seedSuperAdmin } from "./_seed-superadmin.js";
import { topUpOwnerRoles } from "./_owner-permissions.js";

const DB_CONFIG = {
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || "3306"),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  multipleStatements: true,
};

const DB_NAME = process.env.DB_DATABASE;

// Storage is Asia/Manila local (matches getCurrentTimestampLocal + pool tz +08:00).
function now() {
  return moment().tz(process.env.TIMEZONE || "Asia/Manila").format("YYYY-MM-DD HH:mm:ss");
}

async function hashPassword(password) {
  // Argon2 embeds a random salt in the encoded hash — no separate salt needed.
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456, // 19 MiB (OWASP minimum for Argon2id)
    timeCost: 3,
    parallelism: 1,
  });
}

async function main() {
  let connection;

  try {
    checkSuperAdminSeedEnv();

    console.log("🔌 Connecting to MySQL...");
    connection = await mysql.createConnection(DB_CONFIG);

    console.log(`📦 Creating database "${DB_NAME}" if not exists...`);
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await connection.query(`USE \`${DB_NAME}\``);

    console.log("\n📋 Applying migrations...\n");
    await runMigrations(connection);

    // Seed permissions (skipped when already seeded — setup is re-runnable)
    console.log("\n🔐 Seeding permissions...");
    const timestamp = now();

    // Each permission is inserted only if it is missing. Not "only when the table
    // is empty": migrations run first and may already have inserted their own
    // permission rows, which must not stop the base set from being seeded.
    const permissions = [
      { module: "dashboard", submodule: null, description: "Dashboard access" },
      { module: "users", submodule: "list", description: "Users list management" },
      { module: "users", submodule: "roles", description: "Roles management" },
      // CR-021: no "settings" permission — the Settings page was removed (migration 026)
      { module: "audit_trail", submodule: null, description: "Audit Trail access" },
      // PLAN-001 — also inserted by migrations 001/002 on existing databases
      { module: "venues", submodule: "list", description: "Venues management" },
      { module: "venues", submodule: "courts", description: "Courts and cameras management" },
      { module: "clips", submodule: null, description: "Replay clips" },
      { module: "payments", submodule: null, description: "Clip payments (cash)" },
      // PLAN-003 — also inserted by migration 033 on existing databases
      { module: "bookings", submodule: null, description: "Court bookings" },
      // PLAN-009 phase C — also inserted by migration 050 on existing databases
      { module: "open_play", submodule: null, description: "Open Play sessions" },
      // PLAN-009 phase E — also inserted by migration 052
      { module: "tournaments", submodule: null, description: "Tournaments" },
      // PLAN-009 phase F — also inserted by migration 053
      { module: "clubs", submodule: null, description: "Clubs" },
      // (PLAN-002's paired_apps was retired by migration 010 — devices pair to a session)
    ];

    let seeded = 0;
    for (const perm of permissions) {
      const [existing] = await connection.query(
        `SELECT 1 FROM permissions WHERE module = ? AND submodule <=> ? LIMIT 1`,
        [perm.module, perm.submodule]
      );
      if (existing.length > 0) continue;

      const [uuidRow] = await connection.query(`SELECT UUID() as id`);
      await connection.query(
        `INSERT INTO permissions (permissionId, module, submodule, description, portal, status, dateCreated, dateUpdated)
         VALUES (?, ?, ?, ?, 'ADMIN', 'Active', ?, ?)`,
        [uuidRow[0].id, perm.module, perm.submodule, perm.description, timestamp, timestamp]
      );
      seeded += 1;
    }
    console.log(
      seeded > 0
        ? `   ✅ ${seeded} permission(s) seeded`
        : "   ⏭️  Permissions already seeded — skipping"
    );

    // PLAN-008: setup creates only the first back-office super admin (SUPERADMIN_EMAIL);
    // companies and their Owners are onboarded in the back office
    console.log("\n👤 Creating the back-office super admin...");
    await seedSuperAdmin(connection, { timestamp, hashPassword });
    // Existing companies' Owner roles get any permission added since (no account is created)
    await topUpOwnerRoles(connection, timestamp);

    console.log("\n🎉 Database setup complete!");
  } catch (error) {
    console.error("\n❌ Database setup failed:", error.message);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

main();
