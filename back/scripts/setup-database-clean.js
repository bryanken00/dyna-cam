/**
 * Database Setup (Clean) Script (ESM)
 *
 * DROPS all existing tables, re-applies every migration from scratch, then
 * seeds default permissions + the first back-office super admin (PLAN-008: no company
 * or Owner — those are onboarded in the back office).
 * ⚠️  WARNING: This will destroy all existing data!
 *
 * Usage: node scripts/setup-database-clean.js
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
    // Fail on a bad SUPERADMIN_PASSWORD before anything is dropped
    checkSuperAdminSeedEnv();

    console.log("⚠️  WARNING: This will DROP all tables and recreate them!");
    console.log("   All existing data will be lost.\n");

    console.log("🔌 Connecting to MySQL...");
    connection = await mysql.createConnection(DB_CONFIG);

    console.log(`📦 Creating database "${DB_NAME}" if not exists...`);
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await connection.query(`USE \`${DB_NAME}\``);

    // Drop every table (including _migrations) for a true clean slate
    const [existingTables] = await connection.query("SHOW TABLES");
    if (existingTables.length > 0) {
      console.log("🗑️  Dropping existing tables...\n");
      await connection.query("SET FOREIGN_KEY_CHECKS = 0");
      const tableKey = `Tables_in_${DB_NAME}`;
      for (const row of existingTables) {
        const tableName = row[tableKey];
        await connection.query(`DROP TABLE IF EXISTS \`${tableName}\``);
        console.log(`   🗑️  Dropped ${tableName}`);
      }
      await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    }

    console.log("\n📋 Applying migrations...\n");
    await runMigrations(connection);

    // Seed permissions
    console.log("\n🔐 Seeding permissions...");
    const timestamp = now();

    const permissions = [
      { module: "dashboard", submodule: null, description: "Dashboard access" },
      { module: "users", submodule: "list", description: "Users list management" },
      { module: "users", submodule: "roles", description: "Roles management" },
      // CR-021: no "settings" permission — the Settings page was removed (migration 026)
      { module: "audit_trail", submodule: null, description: "Audit Trail access" },
    ];

    for (const perm of permissions) {
      const [uuidRow] = await connection.query(`SELECT UUID() as id`);
      await connection.query(
        `INSERT INTO permissions (permissionId, module, submodule, description, portal, status, dateCreated, dateUpdated)
         VALUES (?, ?, ?, ?, 'ADMIN', 'Active', ?, ?)`,
        [uuidRow[0].id, perm.module, perm.submodule, perm.description, timestamp, timestamp]
      );
    }
    console.log(`   ✅ ${permissions.length} permissions seeded`);

    // PLAN-008: setup creates only the first back-office super admin (SUPERADMIN_EMAIL);
    // companies and their Owners are onboarded in the back office
    console.log("\n👤 Creating the back-office super admin...");
    await seedSuperAdmin(connection, { timestamp, hashPassword });
    // Existing companies' Owner roles get any permission added since (no account is created)
    await topUpOwnerRoles(connection, timestamp);

    console.log("\n🎉 Clean database setup complete!");
  } catch (error) {
    console.error("\n❌ Database setup failed:", error.message);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

main();
