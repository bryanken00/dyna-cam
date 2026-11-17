# Backend — (Node + Express + MySQL)

## ⚠️ Before writing any code in `back/server` or `back/database`, load the `backend-conventions` skill

The conventions are **non-negotiable** and live in that skill's `references/`
([`.claude/skills/backend-conventions/`](../.claude/skills/backend-conventions/SKILL.md)) — seven
topic docs covering the authenticated `req.user` context and the Owner-protection rule,
query/transaction patterns, schema and ID conventions, validators, permission gating, upload paths,
and tests. The skill's table says which one to read for the area you're touching. Read it **before** writing, not after.

Building a whole new CRUD module? Use the **`new-module`** skill instead — it drives this one plus
the frontend half in the right order.

## Stack

Node + Express · MySQL via a custom `Database` class wrapping `mysql2/promise` (`server/config/database.js`,
injected as `req.db`) · Passport JWT auth · Zod validators. One Admin portal (`/api/v1/admin/*`) plus
the shared `/api/v1/upload/*`. Queries see the whole database (soft deletes aside); the seeded
**Owner** role and its accounts are the only records hidden from the Admin portal.

Reference implementation: `server/src/controllers/v1/admin/roles.controller.js`.

## Schema

**Never edit `database/schema.sql`** — it is the frozen baseline. Every schema change (new table,
column, index, ENUM value, FK, backfill) is a **new numbered migration** in
`database/migrations/` (`NNN_<what_it_does>.sql`), applied with `npm run db:migrate`.

**A migration is immutable once implemented** (committed or applied anywhere): never edit, rename,
renumber or delete it, even to fix it — write a new migration. The real schema is `schema.sql` +
every migration in order. Details: `schema-conventions.md` in the `backend-conventions` skill.

## Tests

`npm test` runs the API tests in `tests/` against a throwaway database it creates and drops; it
never opens the database in `DB_DATABASE`. Run it (and `npm run lint`) before reporting a backend
change done — there is no CI to run them for you. A new by-ID endpoint gets a test that a Deleted
(and, where relevant, Owner-owned) record returns 404 and is left unchanged — see
`tests/owner-protection.test.js`.
