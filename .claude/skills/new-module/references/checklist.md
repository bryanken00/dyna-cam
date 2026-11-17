# Final verification checklist

Walk this before reporting the module done. Anything unchecked gets reported to the user with the
reason — don't silently drop it.

## Backend

- [ ] Table in a new numbered `database/migrations/NNN_*.sql` only — `database/schema.sql` is
      untouched and no previously-implemented migration was edited.
- [ ] `id BIGINT PRIMARY KEY AUTO_INCREMENT` + `{{entityId}} VARCHAR(50) UNIQUE NOT NULL` +
      `dateCreated`/`dateUpdated DATETIME NOT NULL`
- [ ] Any FK references the **business ID** column (never `id`) and has an index
- [ ] Phone columns are `VARCHAR(20) NULL`; validator `.max()` matches every `varchar(n)`; every
      `z.enum` matches the column's ENUM exactly
- [ ] Permission row inserted idempotently in the migration **and** added to the
      `setup-database.js` seed array; granted to the `Owner` role
- [ ] Validator file `{{entities}}.validator.js` exists with create / update / list-query schemas
- [ ] Optional fields use `optionalString` / `optionalEmail` / `optionalPhone`, never a bare
      `.optional().nullable()`; query filters use `queryEnum` / `queryEnumDefault` / `queryInt`
- [ ] Every POST/PUT/PATCH has `validateBody`; the list GET has `validateQuery`
- [ ] `checkPermission("{{module}}", {{submodule}}, "read")` on GETs and `"write"` on mutations —
      the same slug the frontend uses; sub-actions reuse the parent's permission
- [ ] Middleware order is `checkPermission` → `validate*` → `catchAsync`
- [ ] IDs from `SELECT UUID()`; timestamps from `getCurrentTimestampLocal()` — no
      `crypto.randomUUID()`, `uuidv4()`, `NOW()`, `new Date()`, or `moment()` in app code
- [ ] Anything about the caller (e.g. a `createdBy`) comes from `req.user` — never from
      `req.body`/`req.query`
- [ ] If the module lists or assigns users or roles: every such query joins `roles` and excludes
      `roleName = 'Owner'`, and an Owner ID is refused like a missing one
- [ ] Every query filters `status != 'Deleted'` unless an explicit `?status=` was passed; DELETE is
      a soft delete (`status = 'Deleted'`), never `DELETE FROM`
- [ ] Transactions: `let conn;` before `try`, `conn.execute` with `[rows]` destructured,
      `req.db.rollback(conn)` in `catch`, `req.db.commit(conn)` before success, no manual
      `conn.release()`; check-then-insert uses `FOR UPDATE` in the same transaction
- [ ] Sort column whitelisted before interpolation (it is not a bound parameter)
- [ ] Responses go through `res.sendSuccess(msg, { {{entities}}, pagination })` / `res.sendError`
- [ ] Router mounted in `routes/v1/admin/index.js` with `requireAuth` and
      `auditTrail("{{entities}}")`
- [ ] `back/tests/{{entities}}.test.js` exists and, for every by-ID endpoint, proves a Deleted
      record's ID returns 404 and the row is unchanged, and a live record returns 200 (plus the
      Owner cases if the module touches users or roles — see `tests/owner-protection.test.js` and
      `backend-conventions` → `testing.md`)

## Frontend

- [ ] `services/api/admin/{{entities}}.js` — raw axios, no try/catch, no hooks
- [ ] `services/requests/admin/{{entities}}.js` — React Query hooks; toasts and
      `invalidateQueries({ queryKey })` (object syntax) live here, not in components
- [ ] Page folder is `pages/Admin/{{Entities}}/` with `index.jsx`, `hooks.jsx`, `components/`;
      no barrel `index.js` re-exports
- [ ] `hooks.jsx` exports one hook holding all state, `useMemo`'d columns, `useCallback`'d
      handlers; search runs through `useDebounce(…, 500)`; filters reset `current` to 1
- [ ] `index.jsx` has no `useState` except `isFilterVisible`, and imports no React Query hook
      directly
- [ ] Data unwrapped as `apiData?.data?.{{entities}}` (two `.data` hops)
- [ ] Layout: `p-8 space-y-5` → `PageHeader` → stat-card grid → one bordered card
      (`1px solid var(--color-line)`, `var(--radius-card)`, **no shadow**) with the toolbar inside
- [ ] `DataTable` + `PaginationFooter` (no built-in pager); filter `Select` uses the `"all"`
      sentinel mapped to `""`
- [ ] Columns: `#` mono · initial-avatar + name · secondary text · status dot · `⋮` via
      `RowActions`; sentence-case headers; strings through `decodeHTML()`; phones through
      `formatPhoneDisplay()`
- [ ] `⋮` menu order is primary action, Edit, `{ type: "divider" }`, Delete (`danger: true`), and
      delete goes through `confirm()` from `store/confirmStore`
- [ ] Form drawer owns its `<Sheet>`, props are exactly `{ open, onClose, onSuccess, entity? }`,
      has the `sr-only` `<SheetTitle>` and `showCloseButton={false}` + its own bordered X
- [ ] zod schema required-ness matches the DB; optional fields validate shape-not-presence;
      required labels render an explicit `*`
- [ ] Hydration via explicit `form.reset({...})` (never `form.reset(entity)`); dirty check via
      `formState.isDirty`; submit maps the payload explicitly with `value || null` for optionals
- [ ] Mutations use `isPending` (not `isLoading`)
- [ ] Phone fields use `PHONE_PLACEHOLDER` + `PHONE_MAX_LENGTH` + `formatPhoneOnChange` + `zPhone`
- [ ] `canWrite` from `usePermissions` gates the create button, `⋮` actions, and row selection
- [ ] Route registered in `AdminRoute.jsx`: lazy import + nav entry + `<ProtectedRoute
      accessLevel="read">` inside `<Suspense>`; parent's `permission.anyOf` updated if nested
- [ ] The `module`/`submodule` strings match across the seed, `checkPermission`, `ProtectedRoute`,
      the nav `permission`, and `hasPermission` — character for character
- [ ] Only shadcn/ui (`@/components/ui/*`) and lucide-react; no hardcoded hex, no
      `bg-white`/`bg-gray-*`/`text-slate-*`, no `shadow-*` on static surfaces, no inline
      `background` on the primary `<Button>`, no gradient except the form header chip
- [ ] No leftover `console.log`

## Release

- [ ] One entry in `docs/changelog/unpublished/` (via the `changelog` skill): `type: added`,
      `impact: minor`, with the "run `npm run db:migrate`" deploy step in its Dev notes

## Commands

```bash
cd back && npm run lint && npm test
```

`npm test` only creates and drops its own `tpl_test_*` databases; it never opens the project's
database.

```bash
cd front && npm run lint && npm run build
```

Migration — only when the user asks, since it writes to their database:

```bash
cd back && npm run db:migrate
```

## Report

State what was created (file list), what the lint/build actually said, whether the migration was
applied or is still pending, and anything the user must do by hand (e.g. granting the new
permission to non-Owner roles via the Roles page).
