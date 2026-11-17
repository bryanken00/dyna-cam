import { runMigrations } from "./migrations";
import db from "./db";

/**
 * Local SQLite — the offline layer.
 *
 * The staff app has **no local tables yet**: every Dyna Cam screen reads the
 * API live (PLAN-001 keeps the SQLite layer out of v1). The template's
 * example `items` table was removed with its screen. The wiring stays so the
 * first offline feature only has to add a table:
 *
 *   1. tables/<table>.table.js     — CREATE TABLE IF NOT EXISTS
 *   2. register its init…Table() in initDatabase() below
 *   3. endpoints/<table>.endpoints.js — db_* functions
 *   4. its indexes in initIndexes()
 *
 * (A phone that ran the template keeps an unused `items` table. It is never
 * read; drop it in a migration if it ever matters.)
 */

/**
 * Indexes SQLite does not create for you.
 *
 * PRIMARY KEY and UNIQUE columns are indexed automatically — everything else
 * is a full table scan. Add an index for any column you filter or sort by on
 * a hot path, with IF NOT EXISTS so this is safe on every startup:
 *
 *   db.execSync(
 *     `CREATE INDEX IF NOT EXISTS idx_products_status ON products(status)`,
 *   );
 */
// eslint-disable-next-line no-unused-vars
const initIndexes = (database = db) => {};

/**
 * Called once from App.js on mount.
 *
 * Order matters: create tables first, then run migrations against them, then
 * add indexes. Register each new table file in the block below.
 */
export const initDatabase = () => {
  try {
    // ── Tables ───────────────────────────────────────────────────────────────
    // (none yet)

    // ── Migrations ───────────────────────────────────────────────────────────
    // Schema changes to tables already live on a device. See migrations/README.md.
    runMigrations();

    // ── Indexes ──────────────────────────────────────────────────────────────
    initIndexes();

    console.log("[DB] Database initialization complete");
  } catch (error) {
    console.error("[DB] Initialization error:", error);
  }
};
