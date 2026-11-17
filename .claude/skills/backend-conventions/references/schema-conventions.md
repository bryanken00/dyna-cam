# Schema & ID Conventions

These conventions apply to all database tables and backend controller code in this project.

---

## Table Structure Convention

Every table MUST follow this structure:

1. **`id`** — `BIGINT PRIMARY KEY AUTO_INCREMENT` — internal surrogate key, never exposed to the frontend.
2. **Business ID** — a separate `varchar(50) UNIQUE NOT NULL` column (e.g., `accountId`, `roleId`, `permissionId`, `auditId`) used in all API responses, URLs, and foreign key references.
3. **Timestamp columns** — `dateCreated DATETIME NOT NULL`, `dateUpdated DATETIME NOT NULL` (see Timestamp section below).

```sql
CREATE TABLE example (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  exampleId VARCHAR(50) UNIQUE NOT NULL,
  -- ... other columns ...
  status ENUM('Active','Inactive','Deleted') NOT NULL,
  dateCreated DATETIME NOT NULL,
  dateUpdated DATETIME NOT NULL
);
```

---

## ID Generation — Always UUID via `SELECT UUID()`

Business IDs (any column ending in `Id` that is NOT the auto-increment `id`) must be generated using `SELECT UUID()` from the database.

### Pattern

```js
import { getCurrentTimestampLocal } from "../../../utils/dateUtils.js";

// Generate UUID from MySQL
const [uuidRow] = await conn.execute(`SELECT UUID() as id`);
const accountId = uuidRow[0].id;

// For pool queries (non-transaction):
const uuidResult = await req.db.query(`SELECT UUID() as id`);
const roleId = uuidResult[0].id;
```

### Rules

| Rule                            | Description                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| Always use `SELECT UUID()`      | Never use `crypto.randomUUID()`, `uuidv4()`, or any JS-side UUID generation                      |
| Generate inside the transaction | When using transactions, generate the UUID with `conn.execute` to keep it on the same connection |
| One UUID per entity             | Generate a fresh UUID for each new row being inserted                                            |

### ✅ Correct

```js
let conn;
try {
  conn = await req.db.beginTransaction();
  const now = getCurrentTimestampLocal();

  // Generate UUID from MySQL
  const [uuidRow] = await conn.execute(`SELECT UUID() as id`);
  const accountId = uuidRow[0].id;

  await conn.execute(
    `INSERT INTO users (accountId, firstName, lastName, status, dateCreated, dateUpdated)
     VALUES (?, ?, ?, 'Active', ?, ?)`,
    [accountId, firstName, lastName, now, now],
  );

  await req.db.commit(conn);
  return res.sendSuccess("User created", { accountId }, 201);
} catch (err) {
  await req.db.rollback(conn);
  throw err;
}
```

### ❌ Wrong

```js
// Never use JS-side UUID libraries
import { v4 as uuidv4 } from "uuid";
const accountId = uuidv4(); // ❌ Wrong

// Never use crypto.randomUUID()
const auditId = crypto.randomUUID(); // ❌ Wrong

// Never hardcode or generate IDs from timestamps/random strings
const roleId = `role_${Date.now()}`; // ❌ Wrong
```

---

## Timestamp Convention

**Storage is Asia/Manila local time.** Use `getCurrentTimestampLocal()` from the
project's dateUtils for every write. `moment().tz("Asia/Manila")` ignores the
server's OS timezone, so timestamps stay Manila no matter where the backend is
deployed. The pool is configured with `timezone: '+08:00'` and `dateStrings: true`,
so the driver performs **no** conversion — the value you store is exactly the value
the API returns and the frontend displays.

```js
import { getCurrentTimestampLocal } from "../../../utils/dateUtils.js";

const now = getCurrentTimestampLocal();
```

- For a "today" date (e.g. a subscription start), use `getTodayDateLocal()` — never
  SQL `CURDATE()`/`UTC_DATE()` (server-clock dependent).
- To store an inherently-UTC instant (like a JWT's `exp`), convert it with
  `toTimestampLocal(date)`.
- Because reads come back as naive `"YYYY-MM-DD HH:mm:ss"` Manila strings, TTL
  checks can compare them **lexicographically** (`stored.expiresAt <= now`).

> The `*UTC` helpers still exist in dateUtils for explicitly-UTC needs, but are
> **not** used for storage. If you ever need multi-timezone support, switch the
> pool to `timezone: 'Z'` + `dateStrings: false` and use the UTC helpers instead.

### On INSERT — always set both:

```js
await conn.execute(
  `INSERT INTO roles (roleId, roleName, description, status, dateCreated, dateUpdated)
   VALUES (?, ?, ?, 'Active', ?, ?)`,
  [roleId, roleName, description || null, now, now],
);
```

### On UPDATE — always set `dateUpdated`:

```js
await req.db.query(
  `UPDATE users SET firstName = ?, dateUpdated = ? WHERE accountId = ? AND status != 'Deleted'`,
  [firstName, now, accountId],
);
```

### Exception: live-status columns

Columns that record **live status rather than an edit** — a device's `lastSeenAt`, a court's
`previewWantedUntil` / `snapshotPath` / `snapshotAt`, a paired phone's `lastSeenAt` — are updated
**without** touching `dateUpdated` (they change every few seconds; `dateUpdated` would stop meaning
"last edited"). Requests that only change such columns also skip the audit trail
(`res.locals.skipAudit = true`). Everything else follows the rule above.

### Never use:

- `NOW()` in SQL
- `new Date()` in JS
- `moment()` directly
- Any other timestamp source

---

## Phone Columns

Every phone is a Philippine mobile number stored in the canonical grouped form
**`09XX XXXX XXX`** (11 digits, 4-4-3, e.g. `0912 3456 789`). The column is always:

```sql
phone VARCHAR(20) NULL,
```

`VARCHAR(20)` rather than 13 leaves headroom for legacy rows written before the convention.
Phone is **optional on every table that has it** (today: `users`), so `NULL` is the "no number"
value and controllers write `phone || null`.

Never format or sanitise a phone in a controller. The `optionalPhone()` validator normalises
whatever the client sent (`+63…`, `63…`, `9…`, bare digits, or already-grouped) into the
canonical form before the handler runs, so the DB can only ever hold one shape. See
[validators.md](./validators.md).

---

## Foreign Key References

Foreign keys reference the **business ID column** (not the auto-increment `id`).
They are declared inline on users and the permission mappings (see `database/schema.sql`;
tables added later declare theirs in their migration):

```sql
-- users.roleId                              → roles.roleId
-- role_permissions.roleId / permissionId    → roles / permissions
-- user_permissions.accountId / permissionId → users / permissions
```

`ON DELETE RESTRICT` is intentional: rows are soft-deleted (`status = 'Deleted'`),
never physically removed, so a RESTRICT never fires in normal operation.

**Deliberately unconstrained**: `credentials.accountId`, `refresh_tokens.accountId`,
`password_reset_tokens.accountId`, and all of `audit_trail` (audit rows must outlive their
referents).

---

## Soft Deletes

Tables with a `status` column use soft deletes by setting `status = 'Deleted'` — never physically delete rows.

```js
// Soft delete
const now = getCurrentTimestampLocal();
await req.db.query(
  `UPDATE users SET status = 'Deleted', dateUpdated = ? WHERE accountId = ?`,
  [now, accountId],
);

// Always filter out deleted rows in SELECT queries
`SELECT * FROM users WHERE status != 'Deleted'`;
```

---

## Migrations

`database/schema.sql` is the **frozen baseline** — the schema as it stood when the
template was cut. It is applied, not just documentation: the tracking runner
(`scripts/migrate.js`, `_migrations` table) runs it first (recorded as
`schema.sql`), then applies every numbered file in `database/migrations/` in
filename order. Each runs exactly once:

- `npm run db:migrate` — apply the baseline + pending migrations
- `npm run db:setup` — migrate **then** seed (additive, re-runnable)
- `npm run db:setup:clean` — drop everything, re-migrate from scratch, seed

The current schema is **`schema.sql` + every migration, in order.** When you need
a table's real shape, read both.

### Rule 1 — never edit `schema.sql`

Every schema change — a new table, a new or changed column, an index, an ENUM
value, an FK, a data backfill — goes in a **new numbered migration**. Not in
`schema.sql`, not in both. This applies to the template itself as well as to
projects built from it.

### Rule 2 — an implemented migration is immutable

Once a migration has been implemented (committed, or applied to any database),
**never edit, rename, renumber, or delete it** — even to fix a mistake in it. The
runner records it by filename and will never re-run it, so an edit silently
diverges between databases. Write a new migration that corrects it instead.

The only migration you may still edit is one you created in the current, still
uncommitted piece of work that has not been applied anywhere.

### Writing one

- **Name:** `NNN_<what_it_does>.sql` — `NNN` is the next unused 3-digit prefix
  (`ls back/database/migrations`; start at `001`). e.g. `004_add_sku_to_products.sql`.
- **One logical change per file.** MySQL DDL auto-commits per statement and can't
  be rolled back, so keep each migration focused.
- **Header comment** saying what it changes and why.
- Because `schema.sql` never changes, a migration runs on top of exactly the same
  state on a fresh database as on an existing one, so a plain `ALTER TABLE … ADD
  COLUMN` is fine. Still write `CREATE TABLE IF NOT EXISTS` and make seed-style
  `INSERT`s idempotent (`WHERE NOT EXISTS`) — they may overlap with
  `scripts/setup-database.js`.
- A change to a table created by an earlier migration is **another** migration
  (`ALTER TABLE`), never an edit to the one that created it.

```sql
-- 004_add_sku_to_products.sql
-- Adds an optional SKU to products for the barcode lookup.
ALTER TABLE products ADD COLUMN sku VARCHAR(50) NULL AFTER name;
CREATE INDEX idx_products_sku ON products (sku);
```

Apply it with `npm run db:migrate` (only when the user asks — it writes to their
database). `npm test` builds its throwaway database through the same runner, so
it exercises every migration.

---

## Schema Reference

`database/schema.sql` is the baseline and is written to be read top-to-bottom;
later changes are in `database/migrations/`. Key tables (baseline):

| Table              | Business ID        | Purpose                                             |
| ------------------ | ------------------ | --------------------------------------------------- |
| `roles`            | `roleId`           | Permission roles (incl. the hidden `Owner` role)    |
| `users`            | `accountId`        | Admin/staff users (incl. Owner accounts)            |
| `credentials`      | `accountId`        | Sign-in credentials, `type` `ADMIN` or `USER`       |
| `permissions`      | `permissionId`     | Master permission definitions                       |
| `role_permissions` | (composite)        | Maps roles → permissions                            |
| `user_permissions` | `userPermissionId` | Per-user permission overrides                       |
| `refresh_tokens`   | `jti`              | Issued refresh tokens (rotation/revocation)         |
| `password_reset_tokens` | `tokenHash`   | Single-use forgot/reset-password tokens             |
| `settings`         | `settingKey`       | Application-wide key/value store (one row per key)  |
| `audit_trail`      | `auditId`          | Append-only action log (no FKs by design)           |
| `idempotency_keys` | `idempotencyKey`   | Cached responses for idempotent mutations           |

---

## Checklist for New Tables

- [ ] Added as a new numbered migration in `database/migrations/` —
      `schema.sql` untouched, no implemented migration edited
- [ ] Has `id BIGINT PRIMARY KEY AUTO_INCREMENT`
- [ ] Has a business ID column (`varchar(50) UNIQUE NOT NULL`)
- [ ] Business ID is generated via `SELECT UUID()` in application code
- [ ] Has `dateCreated DATETIME NOT NULL` and `dateUpdated DATETIME NOT NULL`
- [ ] Timestamps use `getCurrentTimestampLocal()` from `utils/dateUtils.js` (Asia/Manila storage)
- [ ] Uses `status` enum with `'Deleted'` for soft deletes (where applicable)
- [ ] Foreign keys reference business ID columns, not auto-increment `id`
