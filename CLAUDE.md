# Full-Stack Admin Template

A single-organisation admin platform with one portal, **Admin** (`/admin/*` in the client,
`/api/v1/admin/*` in the API), where staff manage users, roles, permissions, settings and
resources. The **Owner** — created by `npm run db:setup` — holds every permission and is never
listed, editable or assignable in Users or Roles; everyone else gets access through roles and
per-user overrides.

## Repository layout

| Path              | What it is                                                            | Conventions live in                                                          |
| ----------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `front/`          | React 19 + Vite client (shadcn/ui, Tailwind v4, Zustand, React Query) | [front/CLAUDE.md](front/CLAUDE.md) → `frontend-conventions` skill             |
| `back/`           | Node + Express API (MySQL via `mysql2`, Passport JWT, Zod) + API tests | [back/CLAUDE.md](back/CLAUDE.md) → `backend-conventions` skill                |
| `docs/`           | Repo-level Markdown not tied to `front/` or `back/`                   | [docs/README.md](docs/README.md)                                             |
| `.claude/skills/` | Claude Code skills checked into the repo                              | [.claude/skills/](.claude/skills/)                                           |

### Skills

The convention docs are packaged as skills so they load on demand instead of costing ~22k tokens
in every session. **Load the relevant skill before writing code** — the rules in it are
**non-negotiable** unless the user says otherwise.

| Skill | Use it for |
| ----- | ---------- |
| [`frontend-conventions`](.claude/skills/frontend-conventions/SKILL.md) | Anything under `front/src` — pages, hooks, components, forms, services, stores, routes. 8 topic docs. |
| [`backend-conventions`](.claude/skills/backend-conventions/SKILL.md) | Anything under `back/server`, `back/database` or `back/tests` — controllers, routes, validators, migrations, uploads, tests. 7 topic docs. |
| [`new-module`](.claude/skills/new-module/SKILL.md) | A whole new CRUD module end to end: table + migration, permission row, validator, controller, routes, services, list page, form drawer, sidebar registration. Drives the other two in the right order. |
| [`plan-doc`](.claude/skills/plan-doc/SKILL.md) | **Automatic** for a fully new feature or module (also `/plan-doc`) — plan + checklist in `docs/plans/PLAN-NNN-<slug>/`. |
| [`change-request`](.claude/skills/change-request/SKILL.md) | **Automatic** for a change to something that already exists, including new features added to it (also `/change-request`) — request + checklist in `docs/change-requests/CR-NNN-<slug>/`. |
| [`bug-report`](.claude/skills/bug-report/SKILL.md) | **Automatic** when something is broken (also `/bug-report`) — root cause + fix checklist in `docs/bug-reports/BUG-NNN-<slug>/`. |
| [`changelog`](.claude/skills/changelog/SKILL.md) | **Automatic** every time a plan, CR, or bug checklist is finished (also `/changelog`) — queues an entry in `docs/changelog/unpublished/`. |
| [`publish`](.claude/skills/publish/SKILL.md) | `/publish` only — rolls the queue into a plain-language release note, bumps the version. |

## Work tracking is automatic

Every request to build, change, or fix something under `front/` or `back/` gets its tracking doc
**before any code is written**, without the user typing a slash command. Classify it:

| The request is… | Doc | Skill |
| --- | --- | --- |
| A **fully new** feature or module: nothing in the app does this yet, and it isn't an add-on to an existing module | Plan | `plan-doc` |
| A **change to something that exists**: an update, tweak, or removal of an existing module, page, field, or flow, **or a new feature added onto an existing one** (including follow-ups to a finished plan or CR) | Change request | `change-request` |
| Something that **should already work and doesn't**: an error, wrong data, a broken flow | Bug | `bug-report` |

- Unsure between plan and CR? Ask "does it extend something that's already there?" Yes → CR
  (link the plan/CR it extends). No → plan.
- An open (not `Done`) plan or CR that the request belongs to is **updated** (dated line under
  Revisions, new checklist items), not given a sibling doc.
- One request can produce several docs: "fix X and add Y to Users" is a BUG plus a CR.
- No doc for: questions, explanations, reviews, research, or changes that only touch `docs/`,
  `.claude/`, `README.md`, `CLAUDE.md`, or lint/tooling config.
- **When a checklist is finished** (every item ticked, status `Done` / `Fixed`), add a changelog
  entry through the `changelog` skill with `ref: PLAN-/CR-/BUG-NNN` before reporting done.

## Where new Markdown goes

- **Plans, bug reports, change requests** → their folder under [`docs/`](docs/), created through
  `/plan-doc`, `/bug-report`, `/change-request` (numbered `PLAN-`/`BUG-`/`CR-NNN-<slug>/`, each a
  write-up + a checklist), automatically per [Work tracking](#work-tracking-is-automatic).
  **Changelog entries** → `docs/changelog/unpublished/`.
- **Other cross-cutting `.md` — notes, decisions, research, runbooks** that aren't specific to the
  client or the API → put it in **[`docs/`](docs/)**, not at the repo root and not inside
  `front/` / `back/`. See [docs/README.md](docs/README.md) for what belongs there and the naming
  convention.
- **Coding conventions** for a side live in that side's skill:
  `.claude/skills/frontend-conventions/references/` and
  `.claude/skills/backend-conventions/references/`. One topic per file, `kebab-case.md`; add the
  new file to the skill's routing table so it gets read.
- The repo root keeps only its map files (`README.md`, `CLAUDE.md`).

## Cross-cutting facts

- **Backend response envelope:** every endpoint replies via `res.sendSuccess()` →
  `{ success, message, data: { ... } }`. The frontend unwraps `apiData?.data?.<entity>`.
- **Permissions are shared front-to-back:** a page's `<ProtectedRoute module/submodule>` uses the
  same permission the backend's `checkPermission()` enforces for that route group.
- **Soft deletes everywhere:** rows are never physically deleted — set `status = 'Deleted'` and
  filter with `status != 'Deleted'`.
- **Business IDs, not numeric IDs:** APIs, URLs, and FKs use the `varchar` business ID
  (`accountId`, `roleId`, `permissionId`, …), never the internal auto-increment `id`.
- **Phone number format:** every phone is stored and sent as **`09XX XXXX XXX`** — a
  Philippine mobile number, 11 digits grouped **4-4-3** with single spaces (e.g.
  `0912 3456 789`). In the UI the placeholder/hint is the concrete example
  **`0912 3456 789`**, never the `09XX…` mask.
  - **Frontend:** use the shared helpers in `front/src/utils/phoneFormat.js` —
    `PHONE_PLACEHOLDER` for the placeholder, `zPhone` in the form's zod schema, and
    `formatPhoneOnChange` on the field's `onChange` so the spaces are typed in for the user
    (`onChange={(e) => field.onChange(formatPhoneOnChange(e.target.value))}`). Render stored
    values with `formatPhoneDisplay()`.
  - **Backend:** use `phone: optionalPhone()` from `server/src/validators/_helpers.js`. It
    accepts the grouped form, bare `09XXXXXXXXX`, and `+63`/`63`/`9…` variants, then
    **normalises to `09XX XXXX XXX` before it reaches the controller** — so the DB only ever
    holds the canonical form. Phone columns are `VARCHAR(20) NULL`; phone is optional
    everywhere, so `""`/`null`/omitted all mean "no number".
- **Uploaded files are private:** the DB stores the plain path (`/public/uploads/...`); the API
  returns a **signed, expiring link** and refuses a bare path.
  - **Backend:** wrap every upload column you return in `signUploadUrl()`; accept one with
    `optionalUploadPath()` and check `canAccessUpload()` before saving a client-sent path.
  - **Frontend:** render through `getImageUrl()` and use the link exactly as given; send it back
    unchanged when saving or deleting.
- **Temporary passwords:** an account created for someone else (the seeded Owner, a staff user)
  is inserted with `mustChangePassword = 1` and its password checked with `passwordProblem()`.
  Until the user changes it, the API returns 403 `PASSWORD_CHANGE_REQUIRED` outside `/auth/*`,
  and the frontend `<Auth>` guard keeps them on Account Settings. There is no fixed default password anywhere.
- **Protected routes use the index file's `requireAuth`** (JWT + pending-password-change guard),
  never a bare `passport.authenticate`. A user can sign in and use the API only while their
  `users` row and credential are `Active`.
- **Backend changes are tested:** `cd back && npm test` (throwaway database, never touches
  `DB_DATABASE`). A new by-ID endpoint gets a test that a `Deleted` record (and, where relevant,
  an Owner-owned one) returns 404 and stays unchanged. There is no CI, so run
  `npm run lint` and `npm test` yourself before reporting a backend change done.
- **Schema changes are migrations, never `schema.sql`:** `back/database/schema.sql` is the
  frozen baseline — don't edit it. Every schema change (new table, column, index, ENUM, FK,
  backfill) is a **new numbered migration** in `back/database/migrations/`. A migration is
  **immutable once implemented** (committed or applied): never edit, rename or delete it, even
  to fix it — add another migration. The real schema is `schema.sql` + every migration in order.
- **Every shipped change gets a changelog entry:** when you finish a plan, CR, or bug checklist
  (or any other change under `front/` or `back/` that will ship), add one entry to
  `docs/changelog/unpublished/` via the `changelog` skill **before reporting done** — one per
  finished checklist / logical change, not per file. Docs/`.claude/`-only changes
  don't get one. **Never bump `version` by hand** — `/publish` picks it from the entries' impact
  and bumps `front/` and `back/` `package.json` together.
- **App version = `package.json`:** the frontend reads `version` from `front/package.json`,
  injected by `vite.config.js` as `import.meta.env.APP_VERSION`. There is no version env var —
  don't add one.
