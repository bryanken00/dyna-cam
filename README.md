# Dyna Cam

A court-camera service for pickleball venues. A fixed camera on each court records all the time;
a player scans the court's QR code (or presses a button) to save the last 60 seconds as a replay
clip and gets it on their phone, with the venue's logo on it. Venue staff run venues, courts,
cameras, clips and payments from the web Admin portal and the mobile staff app. The roadmap and
its phases are in [PLAN-001](docs/plans/PLAN-001-court-replay-cameras/plan.md).

Dyna Cam is built on a production-style single-organisation admin platform. It ships one **Admin**
portal out of the box — users, roles, per-user permissions, settings, and a dashboard — run by an
**Owner** account that holds every permission, with role-based access control, an audit trail,
private file uploads, a hardened Express API, and an API test suite.

The repository is a **monorepo of four independent apps**:

| Path               | App                         | Stack                                                                                          |
| ------------------ | --------------------------- | ---------------------------------------------------------------------------------------------- |
| [`front/`](front/) | React SPA (the Admin portal) | React 19 · Vite · shadcn/ui (Radix + Tailwind) · Tailwind CSS v4 · Zustand · TanStack Query · react-hook-form + zod · React Router v8 |
| [`back/`](back/)   | REST API server             | Node · Express · MySQL (`mysql2`) · Passport JWT · Zod                                         |
| [`edge/`](edge/)   | Recorder box (one per venue) | Node 20 · ffmpeg · pm2 — records every court camera (RTSP) and cuts, watermarks and uploads clips |
| [`app/`](app/)     | Mobile staff app            | Expo SDK 58 · React Native 0.88 · React Native Reusables on NativeWind · Zustand · TanStack Query · expo-sqlite |

> Coding conventions live in the [`frontend-conventions`](.claude/skills/frontend-conventions/SKILL.md),
> [`backend-conventions`](.claude/skills/backend-conventions/SKILL.md) and
> [`mobile-conventions`](.claude/skills/mobile-conventions/SKILL.md) skills — 22 topic docs
> that are the source of truth for the project's patterns. This README is the high-level map. See
> [Working with Claude Code](#working-with-claude-code).

---

## Table of contents

- [Architecture at a glance](#architecture-at-a-glance)
- [Core concepts](#core-concepts)
- [Repository structure](#repository-structure)
- [Getting started](#getting-started)
- [Scripts](#scripts)
- [Backend](#backend)
- [Security](#security)
- [Tests](#tests)
- [Frontend](#frontend)
- [API overview](#api-overview)
- [Database schema](#database-schema)
- [Working with Claude Code](#working-with-claude-code)
- [Conventions & further reading](#conventions--further-reading)

---

## Architecture at a glance

```
                         ┌─────────────────────────────┐
   Browser               │  front/  (Vite SPA)         │
   ┌───────────────┐     │  /admin/*     Admin portal  │
   │ Admin UI      │◀───▶│  Zustand · Query · shadcn/ui│
   └───────────────┘     └──────────────┬──────────────┘
                                         │  HTTPS + JWT (Bearer) + CSRF
                                         ▼
                         ┌─────────────────────────────┐
                         │  back/  (Express API)        │
                         │  /api/v1/admin/*             │
                         │  /api/v1/upload/*            │
                         │  Passport JWT · RBAC · Zod   │
                         │  audit trail · rate limiting │
                         └──────────────┬──────────────┘
                                         │  mysql2 pool (req.db)
                                         ▼
                                ┌─────────────────┐
                                │   MySQL 8        │
                                │  11 tables       │
                                └─────────────────┘
```

- **One organisation:** every Admin query sees the whole database, limited only by the caller's
  permissions. The **Owner** account and role are hidden from the Users and Roles screens and
  can't be edited or assigned there.
- **Auth:** stateless JWT (RS256): a 15-minute access token and a rotating 7-day refresh token. The
  token carries a `userId`; the Passport strategy loads the full user (including `roleId`) onto
  `req.user` per request, and refuses users who are not `Active`.
- **Authorization:** a `module / submodule / accessLevel` permission model, enforced on the backend by
  `checkPermission` middleware and mirrored on the frontend by `ProtectedRoute` + `usePermissions`.

---

## Core concepts

| Concept               | What it means                                                                                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **One portal**        | `Admin` at `/admin` — users, roles, per-user permissions, settings, audit trail, dashboard. Every account signs in there.                                                                                 |
| **The Owner**         | Each company's first account, created when DGSports onboards the company in the back office (PLAN-008): an `Owner` role holding every permission (re-running setup grants it any new one). Never listed, editable, or assignable in Users or Roles. `npm run db:setup` creates no Owner — only the first back-office super admin. |
| **RBAC**              | Permissions are `module` + optional `submodule` + `accessLevel` (`none < read < write`). Per-user overrides take precedence over role permissions.                                                          |
| **Business IDs**      | Every row has an internal `id BIGINT` (never exposed) and a `varchar(50)` business ID (`accountId`, `roleId`, `permissionId`, …) used in all APIs, URLs, and foreign keys. Generated with MySQL `SELECT UUID()`. |
| **Soft deletes**      | Rows are never physically deleted — `status` is set to `'Deleted'` and queries filter `status != 'Deleted'`.                                                                                                |
| **Response envelope** | Every endpoint replies via `res.sendSuccess(message, data, status?)` → `{ success, message, data }`. The frontend unwraps `apiData.data.<entity>`.                                                          |
| **Audit trail**       | Middleware auto-logs successful `CREATE/UPDATE/DELETE`s (with sanitized metadata) and uploads, plus sign-in events (sign-in, failed sign-in, lockout, password changes). Viewed and exported in Admin → Audit Trail. |
| **Private uploads**   | Uploaded files are never public. The database stores the plain path; the API hands out signed, expiring links, and a bare path is refused.                                                                  |
| **Temporary passwords** | An account created for someone else (a company Owner, a super admin, a staff user) must choose its own password at first login; until then the API allows nothing else.                                                 |

---

## Repository structure

```
.
├── README.md                  ← you are here
├── CLAUDE.md                  ← project map for AI agents
├── setup.sh                   ← first-time setup: installs, .env files (back, front, edge), secrets, JWT keys
├── run.sh                     ← Windows (Git Bash): both dev servers in one terminal
├── run-mac.sh                 ← macOS: the same, for the bash macOS ships
├── .claude/skills/            ← Claude Code skills (checked in)
│   ├── frontend-conventions/  ← 8 frontend topic docs, loaded on demand
│   ├── backend-conventions/   ← 7 backend topic docs, loaded on demand
│   ├── mobile-conventions/    ← 7 mobile-app topic docs, loaded on demand
│   ├── edge-conventions/      ← the recorder box's rules, loaded on demand
│   ├── new-module/            ← scaffolds a CRUD module end to end
│   ├── new-mobile-module/     ← scaffolds a screen module in the mobile app
│   └── plan-doc, change-request, bug-report, changelog, publish
├── docs/                      ← plans, bug reports, change requests, changelog, reviews (all apps)
├── edge/                      ← recorder box: Node + ffmpeg, one per venue (see edge/README.md)
├── app/                       ← Expo React Native staff app
│   ├── CLAUDE.md              ← stack + pointer to mobile-conventions
│   ├── app.json · eas.json    ← Expo config + EAS build profiles
│   └── src/                   ← Screens/, components/ (ui/ + pattern/), services/{api,requests},
│                                store/ (Zustand + SQLite), Navigation/, constants/
├── front/                     ← React SPA
│   ├── CLAUDE.md              ← stack + pointer to frontend-conventions
│   └── src/
│       ├── pages/             ← Admin/ portal modules, Auth/ (forgot/reset password), LandingPage/ (`/`),
│       │                        ComponentGallery/ (`/components`, dev-only)
│       │   └── <Module>/      ← index.jsx (view) · hooks.jsx (logic) · components/
│       ├── components/        ← shared UI (PageHeader, StatCard, PaginationFooter,
│       │                        SectionLabel, StatusToggle, ProtectedRoute, layout, …)
│       ├── hooks/             ← usePermissions, useDebounce, …
│       ├── routes/            ← the Admin route tree + auth guards
│       ├── services/
│       │   ├── api/           ← raw axios calls (admin/<module>.js, plus shared account/upload)
│       │   └── requests/      ← TanStack Query hooks (mirror api/)
│       ├── store/             ← Zustand (authStore, themeStore)
│       └── index.css          ← Tailwind v4 + Modern design tokens (shadcn token bridge)
└── back/                      ← Express API
    ├── CLAUDE.md              ← stack + pointer to backend-conventions
    ├── .env.example
    ├── database/              ← schema.sql (frozen baseline) + migrations/ (every later change)
    ├── scripts/               ← keys / db:setup / db:reset / db:check
    ├── tests/                 ← API tests (`npm test`) — throwaway database + the real app
    ├── auth-keys/             ← RS256 JWT keypair (generate with `npm run keys`; gitignored)
    └── server/
        ├── bin/www.js         ← entrypoint (boot, health check, listen)
        ├── config/            ← express.js (middleware chain) · database.js (pool)
        └── src/
            ├── routes/        ← /api/v1/{admin,upload} mounts
            ├── controllers/   ← v1/{admin,auth,upload}/*.controller.js
            ├── middlewares/   ← passport JWT, checkPermission, auditTrail, csrf, rateLimiter,
            │                    signedUpload, requirePasswordChanged, idempotency, …
            ├── validators/    ← Zod schemas
            └── utils/         ← catchAsync, responses, dateUtils, hashing, file (uploads, signed
                                 links), passwordPolicy, loginLockout, …
```

---

## Getting started

### Prerequisites

- **Node.js** 22.22+ (or 24) and **npm**
- **MySQL** 8 (a reachable database/schema; to run the tests, the user must be allowed to create
  and drop databases)

### Quick setup

```bash
./setup.sh
```

Installs the dependencies of `back/`, `front/` and `edge/`, creates `back/.env`, `front/.env` and
`edge/.env` from their examples, generates `CSRF_SECRET`, `LOG_SALT` and `UPLOAD_URL_SECRET`, and
creates the JWT keypair. For running the recorder box on this machine it also points `edge/.env`'s
`API_URL` at the local API, generates `RECORDER_ENROLL_KEY` in `back/.env` if it is empty and
copies it into the box's `ENROLL_KEY`, and checks that ffmpeg is installed. Last, it pairs the box:
it lists the venues in your database so you pick the box's venue (`VENUE_ID`), asks for an
optional box name (`BOX_NAME`), and checks the two keys match — the box then enrols itself on its
first start. No venue yet? Add one in Admin → Setup → Venues and re-run `./setup.sh`. It is safe to re-run: an existing `.env`, an already-set
secret or key, and existing JWT keys are kept. It then asks
for `DB_USER`, `DB_PASS` and `DB_DATABASE` (press Enter to skip one, or keep its current value),
writes them into `back/.env`, and — once all three are set — runs `npm run db:setup` for you, which
prints the Owner's one-time password. If you skip any, set the `DB_*` values in `back/.env` and
continue from `npm run db:setup` below. The steps it automates are spelled out next.

Once set up, start both dev servers from one terminal — `./run-mac.sh` on macOS, `./run.sh` in
Git Bash on Windows. Output is prefixed per app and Ctrl+C stops everything. Both take the same
arguments: `back` or `front` to start just one, `app` (opt-in, e.g. `./run-mac.sh back app`) to
add the mobile app's Expo dev server, `edge` (opt-in, e.g. `./run-mac.sh back front edge`) to add
the recorder box (it needs ffmpeg and a filled-in `edge/.env`), and `stop` to free the dev ports
(4021 — or `PORT` from `back/.env` — 4020, 8081 and the box's `LIVE_PORT`, 8090) if a server was
left running. Before starting, both scripts look up this machine's current LAN IP and point the `.env` files'
URLs at it (`back/`, `front/`, `app/`, `edge/` — e.g. `APP_URL`, `FRONTEND_URL`, `VITE_API_URL`,
`EXPO_PUBLIC_API_URL`, the box's `API_URL`): an old private IP or `localhost` in a URL becomes the
current IP, so phones and the recorder box reach the API and the links they're given, even after
the Wi-Fi hands out a new address. Left as they are: `GOOGLE_REDIRECT_URI` (Google refuses a
private IP there), the `localhost` entries of `ALLOWED_ORIGINS` (the IP ones are added beside
them), plain host names such as `DB_HOST=localhost` (MySQL and Redis listen on loopback), and
public addresses. `NO_IP_UPDATE=1 ./run-mac.sh` skips it.

### 1. Backend

```bash
cd back
npm install

# Configure environment
cp .env.example .env          # then edit DB_*, ISSUER, AUDIENCE, CSRF_SECRET, LOG_SALT,
                              # UPLOAD_URL_SECRET, …

# Generate the RS256 JWT keypair referenced by .env (jwtAuthPrivatePath / jwtAuthPublicPath).
# Refuses to overwrite existing keys; pass --force to regenerate.
npm run keys

# Build the schema: applies the baseline + any pending migrations, then seeds the
# permission set, the Owner role, and the first Owner account (its one-time password is
# printed once).
# Additive and re-runnable — existing tables and data are left untouched, and seeds
# are skipped when already present.
npm run db:setup

# Optional, development only — ⚠️ EMPTIES THE DATABASE first (keeps only the
# permissions and the Owner), then loads demo staff, venues, courts, rates, games,
# bookings and payments (no video). DEMO_PASSWORD sets the demo logins' password
# (else a random one is printed once).
npm run db:data

npm run dev                   # nodemon on http://localhost:4021  (API under /api/v1)
```

**Required env vars** (see [`back/.env.example`](back/.env.example) for the full annotated list):

| Group    | Keys                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------- |
| App      | `NODE_ENV`, `PORT`                                                                              |
| Database | `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_DATABASE` (+ optional `DB_POOL_SIZE`, timeouts) |
| JWT      | `jwtAuthPrivatePath`, `jwtAuthPublicPath`, `ISSUER`, `AUDIENCE`                                 |
| Security | `CSRF_SECRET`, `LOG_SALT`, `UPLOAD_URL_SECRET` (signs links to uploaded files; the server refuses to start in production without it) |
| CORS     | `FRONTEND_URL`, `ALLOWED_ORIGINS` (comma-separated)                                             |

Optional, with safe defaults (all documented in the example file):

| Group            | Keys                                                           | Default                          |
| ---------------- | -------------------------------------------------------------- | -------------------------------- |
| First super admin | `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD` (both required, read by `db:setup`) | — (no forced change at first sign-in) |
| Sessions         | `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`              | `15m`, `7d`                      |
| Account lockout  | `LOGIN_MAX_FAILED_ATTEMPTS`, `LOGIN_LOCK_MINUTES`              | 5 wrong passwords, 15 minutes    |
| Upload links     | `UPLOAD_URL_TTL_SECONDS`                                       | `3600` (a link lives 1–2 hours)  |
| Logs             | `LOG_RETENTION_DAYS`                                           | `90`                             |

Rate limiting, Redis, email (SendGrid) and SSL are also optional and documented there.

### 2. Frontend

```bash
cd front
npm install

cp .env.example .env          # set VITE_API_URL to the backend (default http://localhost:4021)

npm run dev                   # Vite dev server (http://localhost:4020)
```

Frontend env (`front/.env`): `VITE_API_URL`, `VITE_SOCKET_URL`, `VITE_APP_NAME`, `VITE_STORE_KEY`,
`VITE_APP_ENV`, `VITE_SENTRY_DSN`. `VITE_STORE_KEY` prefixes every browser-storage key
(`<key>-admin-auth`, `<key>-ui-theme`, …) — give each project its own so two apps on one origin
(e.g. `localhost:4020`) don't share a session. The app version isn't an env var — it's `version` in `front/package.json`,
injected at build time as `import.meta.env.APP_VERSION`. Make sure the backend's `FRONTEND_URL` /
`ALLOWED_ORIGINS` include the Vite origin so CORS + CSRF allow it.

The Admin portal lives at `/admin/*`.

### 3. Mobile staff app (optional)

```bash
cd app
npm install

cp .env.example .env          # EXPO_PUBLIC_API_URL → the backend, e.g. http://192.168.1.20:4021

npm start                     # Expo dev server; open in a dev build or Expo Go
```

On a physical phone, `localhost` is the phone itself — use your computer's LAN IP. Sign in with
the same accounts as the Admin portal. `EXPO_PUBLIC_DEMO_MODE=true` signs in locally with no
backend, for UI work only. Native folders (`android/`, `ios/`) are generated with
`npx expo prebuild` and never committed.

### 4. Where to start

`npm run db:setup` seeds the permission set and **only the first back-office super admin**
(PLAN-008) — no company and no Owner. Set `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD` (8+
characters, not a well-known weak one) in `back/.env` first; there is **no fixed default
password**. Sign in to the **back office** at `/backoffice` with them (it's your own password, so
no forced change), then **onboard a company**: it creates the company and its **Owner** account with a
temporary password (shown once, and emailed when SendGrid is set up).

The Owner signs in to the **Admin portal** at `/admin`, chooses a new password, and builds the
company's team (only that company's data is ever visible):

1. **Create roles** — Admin → **User Management → Roles**, then set each role's permissions.
   `POST /api/v1/admin/roles` · `POST /api/v1/admin/roles/:roleId/permissions`
2. **Create users** — Admin → **User Management → Users**, giving each one a role and a
   temporary password. Per-user overrides adjust one person's access on top of their role.
   `POST /api/v1/admin/users`

Like the Owner, every user you create must choose their own password at first login. The Owner
never appears in the Users or Roles lists and can't be edited or assigned there; re-running
`npm run db:setup` after adding a permission grants it to every company's Owner role.

---

## Scripts

### Backend (`back/`)

| Script                                                       | Action                                                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `npm run dev`                                                | Start with nodemon (auto-reload)                                             |
| `npm start`                                                  | Start the server (`server/bin/www.js`)                                       |
| `npm run keys`                                               | Generate the RS256 JWT keypair into `auth-keys/` (`-- --force` to overwrite) |
| `npm run db:migrate`                                         | Apply the baseline + any pending migrations. Additive, safe                   |
| `npm run db:setup`                                           | Migrate, **then** seed permissions + the first super admin (no company or Owner). Additive, re-runnable, safe |
| `npm run db:setup:clean`                                     | ⚠️ **Drops all tables**, re-migrates from scratch, seeds permissions + the first super admin |
| `npm run db:reset`                                           | ⚠️ Nuclear: drops the whole **database** and recreates it empty (no tables)  |
| `npm run db:check`                                           | Verify DB connectivity / list tables + row counts (read-only, safe)          |
| `npm test`                                                   | API tests against a throwaway database (never touches `DB_DATABASE`); safe   |
| `npm run lint` · `lint:fix`                                  | ESLint                                                                       |
| `npm run format` · `format:check`                            | Prettier                                                                     |
| `npm run pm2:start` · `pm2:prod` · `pm2:reload` · `pm2:stop` | PM2 process management ([`ecosystem.config.cjs`](back/ecosystem.config.cjs)) |

`db:setup:clean` and `db:reset` destroy data. Schema changes ship as numbered migrations, so after
pulling one, run `db:migrate` to bring a local database up to date.

### Frontend (`front/`)

| Script                      | Action                       |
| --------------------------- | ---------------------------- |
| `npm run dev`               | Vite dev server              |
| `npm run build`             | Production build (`dist/`)   |
| `npm run build:analyze`     | Build with bundle analysis   |
| `npm run preview`           | Preview the production build |
| `npm run lint` · `lint:fix` | ESLint                       |

### Mobile app (`app/`)

| Script                                          | Action                                          |
| ----------------------------------------------- | ----------------------------------------------- |
| `npm start`                                     | Expo dev server (`expo start --clear`)          |
| `npm run android` · `npm run ios`               | Native run (needs a prebuild + toolchain)       |
| `npx expo-doctor@latest`                        | Dependency / config health check                |
| `npx expo export --platform android --clear`    | Bundle check — the app's build verification     |

The app has no test runner or linter; the two `npx` commands are its verification loop.

---

## Backend

### Request lifecycle

Configured in [`back/server/config/express.js`](back/server/config/express.js), middleware runs roughly in this order:

1. **Logging** (morgan → Winston) and a per-request **request ID** for tracing.
2. **Security headers** + **bot/empty-User-Agent blocking**.
3. Body parsing (`json`/`urlencoded`, 2 MB limit), cookies, **gzip compression**.
4. **Input sanitization** (XSS/injection; passwords are left untouched), then uploaded files under
   `/public/uploads` — served only through a signed, unexpired link.
5. **Passport JWT** init; a response-wrapper that adds `res.sendSuccess` / `res.sendError`.
6. `req.db` (the shared `Database` pool) is attached, then the **API router** (`/api/...`), which
   starts with the idempotency cache (skipped for auth routes).
7. CSRF error handler → global error handlers → final error formatter (4xx messages shown,
   5xx hidden in production; everything logged with masked sensitive fields).

### Data access — the `Database` class

[`back/server/config/database.js`](back/server/config/database.js) wraps a `mysql2/promise` pool (Asia/Manila local time, `utf8mb4`,
keep-alive, slow-query logging) and is injected as `req.db`:

- `req.db.query(sql, params)` → returns **rows directly** (pooled, no transaction).
- `req.db.beginTransaction()` → a connection; use `conn.execute(...)` (returns `[rows, fields]`), then
  `req.db.commit(conn)` / `req.db.rollback(conn)`. See [`db-patterns.md`](.claude/skills/backend-conventions/references/db-patterns.md).

### Auth & RBAC

- **Authentication** — [`passport.jwt.config.js`](back/server/src/middlewares/passport.jwt.config.js) verifies RS256
  tokens and loads the user onto `req.user` (`accountId`, `roleId`, `email`, `type`,
  `mustChangePassword`, …). A user who is not `Active` is refused.
- **Route guard** — in the route index files, `requireAuth` is the JWT check **plus**
  `requirePasswordChanged`. Mount every protected route group with it.
- **Authorization** — `checkPermission(module, submodule?, accessLevel?)` resolves the user's effective
  level (user override → role permission), enforcing `GET = read`, `POST/PUT/DELETE = write`.
  See [`permission-gating.md`](.claude/skills/backend-conventions/references/permission-gating.md).

### Validation, uploads, audit

- **Validation** — Zod schemas applied via `validateBody` / `validateQuery` / `validateParams`
  ([`validators.md`](.claude/skills/backend-conventions/references/validators.md)).
- **Uploads** — stored under `public/uploads/admin/...`: avatars in `avatars/{accountId}/`, general
  images in `images/`. In a per-user folder a user may only use or delete their own files. Files
  are not public: the API returns signed, expiring links and a bare path is refused
  ([`file-uploads.md`](.claude/skills/backend-conventions/references/file-uploads.md)).
- **Audit trail** — [`auditTrail.middleware.js`](back/server/src/middlewares/auditTrail.middleware.js) intercepts
  successful state-changing responses on audited routes (Admin resources and uploads) and writes a
  sanitized record to `audit_trail` before the response is sent. `recordAudit()` in the same file
  records sign-in events.

---

## Security

What the template enforces out of the box. The rules for keeping it that way in new code are in the
convention docs linked from each row.

| Area | What is enforced | Where |
| ---- | ---------------- | ----- |
| Owner protection | The Owner role and account never appear in the Users, Roles, or user-permission endpoints: they are left out of lists, reading, editing, or deleting them returns 404, and a user can't be given the Owner role. A second role named `Owner` is refused. | [`auth-context.md`](.claude/skills/backend-conventions/references/auth-context.md) |
| Sessions | 15-minute access token; 7-day refresh token, rotated on every use, with reuse detection. Sign-out, a password change, and a password reset revoke sessions. A user who is no longer `Active` is refused on every request and can't refresh. | `utils/jwt.js`, `auth.controller.js` |
| Sign-in | Rate limit per IP, plus a per-account lockout (5 wrong passwords → 15 minutes). No account enumeration on forgot-password. | `utils/loginLockout.js` |
| Passwords | Argon2id, hashed exactly as typed. At least 8 characters; well-known weak passwords and ones containing the email name are refused. | `utils/passwordPolicy.js` |
| Temporary passwords | No fixed default password. The first super admin's comes from `back/.env`; every account created for someone else must choose a new password at first login; until then every route outside `/auth/*` returns 403. | `requirePasswordChanged.middleware.js` |
| Permissions | Checked on the server for every Admin resource route. | [`permission-gating.md`](.claude/skills/backend-conventions/references/permission-gating.md) |
| Uploads | Cannot be written outside `public/uploads`; content must match the declared type; no SVG; random file names; delete checks ownership; served only through signed, expiring links. | [`file-uploads.md`](.claude/skills/backend-conventions/references/file-uploads.md) |
| Idempotency cache | Never stores auth responses (they contain tokens); expired rows are purged hourly. | `idempotency.middleware.js` |
| Audit trail | Admin writes, uploads, and sign-in events, recorded before the response is sent. | `auditTrail.middleware.js` |
| Input & headers | Zod validation, HTML sanitisation of request bodies, parameterised SQL, security headers, CORS allow-list, CSRF on auth routes. | `config/express.js`, `utils/security.js` |
| Dependencies | `npm audit` reports no known vulnerabilities and lockfiles are committed. Nothing watches for new advisories automatically — run `npm audit` regularly. | `package-lock.json` |

**Not done yet:** two-factor login, data retention for deleted records, malware scanning of
uploads, and a central log store.

---

## Tests

```bash
cd back && npm test
```

The backend has an API test suite in [`back/tests/`](back/tests/), run with Node's built-in test
runner. Each test file creates a throwaway database (`tpl_test_*`), runs the real setup script
against it, starts the real app, and drops the database afterwards. The database named in
`DB_DATABASE` is never opened, so the suite is safe to run next to your development data.

The tests cover the security rules above: Owner protection, uploads and signed links, the
idempotency cache, the first-password flow, sign-in protection, and the audit trail. A new module
should add a test that a `Deleted` record (and, where relevant, an Owner-owned one) returns 404
and stays unchanged — see
[`testing.md`](.claude/skills/backend-conventions/references/testing.md).

There is no CI workflow in the repository, so nothing runs these checks automatically. Before
merging a change, run them by hand:

| Side | Checks |
| --- | ------ |
| Backend (`back/`) | `npm run lint` · `npm test` · `npm audit --omit=dev` |
| Frontend (`front/`) | `npm run lint` · `npm run build` · `npm audit --omit=dev` |

There are no frontend tests yet.

---

## Frontend

- **Routing** — [`routes/pageRoutes/AdminRoute.jsx`](front/src/routes/pageRoutes/AdminRoute.jsx) defines the
  portal's routes + sidebar navigation. `<Auth>` / `<UnAuth>` guards gate access; `<ProtectedRoute module … accessLevel>` gates individual pages.
- **State** — Zustand for auth (`useAdminAuthStore`, persisted to `localStorage`) and theme; **TanStack Query** for all server state. Tokens attach via an axios
  interceptor, which also renews an expired access token silently. An account with a pending
  password change is kept on Account Settings by the `<Auth>` guard. See [`auth-state.md`](.claude/skills/frontend-conventions/references/auth-state.md).
- **Page module pattern** — each page is a folder: `index.jsx` (presentational), `hooks.jsx` (a single
  hook owning data, columns, filters, pagination, and actions), and `components/`. See
  [`hooks-pattern.md`](.claude/skills/frontend-conventions/references/hooks-pattern.md) and [`folder-structure.md`](.claude/skills/frontend-conventions/references/folder-structure.md).
- **Data layer** — `services/api/` holds raw axios calls; `services/requests/` holds the matching
  React Query hooks (list queries use `placeholderData: keepPreviousData` for smooth paging). See
  [`api-guide.md`](.claude/skills/frontend-conventions/references/api-guide.md).
- **UI system — "Modern"** — monochrome surfaces + hairline borders + one green accent used sparingly;
  structure comes from borders, not shadows, and the primary button is inverted monochrome (never the
  accent, never a gradient). Every color is a token in `src/index.css` (light/dark); type is **Onest**
  + **JetBrains Mono** (micro-data only), shadcn/ui components, Tailwind v4, `lucide-react` icons. The
  copy-paste spec is [`modern-module-pattern.md`](.claude/skills/frontend-conventions/references/modern-module-pattern.md) and
  `front/src/pages/Admin/UserManagement/Roles/` is the reference implementation. See
  [`ui-design-system.md`](.claude/skills/frontend-conventions/references/ui-design-system.md) and [`ui-form-design.md`](.claude/skills/frontend-conventions/references/ui-form-design.md).

---

## API overview

All routes are under `/api/v1`. Protected routes require `Authorization: Bearer <jwt>`; admin
resource routes additionally require the matching permission. While an account has a password
change pending, every protected route outside `/auth` returns 403 `PASSWORD_CHANGE_REQUIRED`.

| Group                      | Base path                                       | Endpoints                                                                                             |
| -------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Auth                       | `/api/v1/admin/auth`                            | `GET /csrf-token` · `POST /login` · `POST /refresh` · `POST /logout` · `POST /forgot-password` · `POST /reset-password` · `GET /me` · `PUT /me` · `PUT /me/password` |
| Admin · Users              | `/api/v1/admin/users`                           | `GET /` · `GET /:userId` · `POST /` · `PUT /:userId` · `DELETE /:userId`                              |
| Admin · Roles              | `/api/v1/admin/roles`                           | CRUD + `GET/POST /:roleId/permissions`                                                                |
| Admin · Permissions        | `/api/v1/admin/permissions`                     | `GET /` · `GET /modules` · `GET /user` · `POST /check`                                                |
| Admin · User permissions   | `/api/v1/admin/user-permissions`                | `GET /:accountId` · `POST /:accountId` · `POST /:accountId/bulk` · `DELETE /:accountId/:permissionId` |
| Admin · Audit trail        | `/api/v1/admin/audit-trail`                     | `GET /` (paginated + filterable) · `GET /export` (CSV) · `GET /:auditId`                              |
| Admin · Settings           | `/api/v1/admin/settings`                        | `GET /` · `PUT /`                                                                                     |
| Admin · Dashboard          | `/api/v1/admin/dashboard`                       | `GET /stats`                                                                                          |
| Uploads                    | `/api/v1/upload`                                | `POST /avatar` · `POST /image` · `DELETE /file`                                                       |
| Uploaded files             | `/public/uploads/*` (not under `/api`)          | `GET` with the `?expires=…&signature=…` the API returned; a bare path is refused                      |

List endpoints accept `page`, `pageSize`, `search`, `status`, and `sortBy` / `sortOrder` (where
applicable) and return `{ items, pagination }` inside the response envelope.

---

## Database schema

Full DDL: [`back/database/schema.sql`](back/database/schema.sql) — the frozen baseline, applied by
`npm run db:migrate`. It is never edited: every schema change is a new numbered file in
[`back/database/migrations/`](back/database/migrations/), and a migration is never edited once
implemented. The real schema is the baseline plus every migration, in order. The baseline's
eleven tables:

| Table                   | Business ID        | Purpose                                             |
| ----------------------- | ------------------ | --------------------------------------------------- |
| `credentials`           | `accountId`        | Auth credentials (`type` `ADMIN` or `USER`), the forced-password-change flag, and lockout state |
| `users`                 | `accountId`        | The Owner and staff users (one role each)           |
| `roles`                 | `roleId`           | Permission roles, including the hidden `Owner`      |
| `permissions`           | `permissionId`     | Master permission definitions                       |
| `role_permissions`      | —                  | Maps roles → permissions                            |
| `user_permissions`      | `userPermissionId` | Per-user permission overrides                       |
| `refresh_tokens`        | `jti`              | Issued refresh tokens (rotation/revocation)         |
| `password_reset_tokens` | `tokenHash`        | Single-use forgot/reset-password tokens             |
| `settings`              | `settingKey`       | Application-wide key/value store                    |
| `audit_trail`           | `auditId`          | Activity log                                        |
| `idempotency_keys`      | `idempotencyKey`   | Cached responses for idempotent mutations           |

Every table has `id BIGINT AUTO_INCREMENT` (internal), `dateCreated` / `dateUpdated`
(`DATETIME`, Asia/Manila local), and — where applicable — a `status` enum used for soft deletes.
Foreign keys reference business IDs, not the numeric `id`.
See [`schema-conventions.md`](.claude/skills/backend-conventions/references/schema-conventions.md).

---

## Working with Claude Code

The project's conventions and doc workflows are packaged as checked-in
[Claude Code](https://claude.com/claude-code) skills under [`.claude/skills/`](.claude/skills/),
so an agent loads only the docs a task actually needs instead of ~22k tokens of conventions in
every session. Clone the repo and they work — no setup.

| Skill | How it runs | Covers |
| ----- | ----------- | ------ |
| [`frontend-conventions`](.claude/skills/frontend-conventions/SKILL.md) | Automatic | Anything under `front/src` — code style, folder structure + route registration, the `hooks.jsx` contract, the API service layers, auth & permissions, the Modern design system, the Sheet form pattern. 8 topic docs. |
| [`backend-conventions`](.claude/skills/backend-conventions/SKILL.md)   | Automatic | Anything under `back/server`, `back/database` or `back/tests` — `req.user` and Owner protection, query/transaction patterns, schema & ID rules, validators, permission gating, uploads and signed links, tests. 7 topic docs. |
| [`mobile-conventions`](.claude/skills/mobile-conventions/SKILL.md)     | Automatic | Anything under `app/` — architecture and traps, the engineering checklist, code style, project structure + component kit, the data layer (api/requests, demo mode, SQLite), design guidelines, the list-module pattern. 7 topic docs. |
| [`new-module`](.claude/skills/new-module/SKILL.md)                     | `/new-module` | A whole CRUD module end to end. Drives the frontend and backend skills in the right order. |
| [`new-mobile-module`](.claude/skills/new-mobile-module/SKILL.md)       | `/new-mobile-module` | A list/detail screen module in the mobile app, after `new-module` when it needs a table and API. |
| [`plan-doc`](.claude/skills/plan-doc/SKILL.md)                         | `/plan-doc` | An implementation plan + build checklist in `docs/plans/PLAN-NNN-*/`. |
| [`bug-report`](.claude/skills/bug-report/SKILL.md)                     | `/bug-report` | A bug write-up with investigated root cause + fix checklist in `docs/bug-reports/BUG-NNN-*/`. |
| [`change-request`](.claude/skills/change-request/SKILL.md)             | `/change-request` | A client's request, impact, and acceptance checklist in `docs/change-requests/CR-NNN-*/`. |
| [`changelog`](.claude/skills/changelog/SKILL.md)                       | Automatic · `/changelog` | Queues each finished change in `docs/changelog/unpublished/` with its version weight. |
| [`publish`](.claude/skills/publish/SKILL.md)                           | `/publish` | Turns the queue into plain-language release notes and bumps the version. |

### The convention skills fire on their own

Just describe the work — Claude matches the task and reads only the relevant topic docs:

> Add a status filter to the Users table
>
> Why is the roles list returning 403 for a user with the right role?

You can also aim one at existing code: _"Use frontend-conventions to review
`src/pages/Admin/Inventory/hooks.jsx`."_

### `/new-module` scaffolds a vertical slice

It builds in dependency order — table + migration → permission row → validator → controller →
route wiring → `api/` + `requests/` services → `hooks.jsx` → form drawer → page → sidebar entry —
then runs lint and build.

```
/new-module Suppliers — fields: name (varchar 100, required), contactPerson (varchar 100,
optional), phone (optional), email (optional). Admin portal, permission `suppliers`, icon Truck.
```

It **stops and asks for the field list** if you don't give one — it won't guess your columns. It
also never runs `db:migrate` on its own; the migration waits until you say so. Partial work is
supported: _"just the backend for Suppliers"_, or _"add a `taxId` field to the existing Suppliers
module."_

### Plans, bugs, change requests, and releases

Work gets written up in [`docs/`](docs/README.md). Each item gets its own numbered folder with a
write-up and a checklist:

```
/plan-doc Let admins export the users list to Excel
/bug-report Operations managers get a 403 on the Roles page
/change-request Acme wants a "Department" field on users
```

Whenever Claude finishes a change under `front/`, `back/` or `app/`, it queues a one-file entry in
`docs/changelog/unpublished/` tagged `major` / `minor` / `patch`. When you're ready to ship:

```
/publish            # version picked from the heaviest entry
/publish --dry-run  # preview the version + release note, write nothing
/publish minor      # override the bump
```

`/publish` writes a client-friendly release note (no jargon) to
`docs/changelog/published/vX.Y.Z.md`, bumps the one product version everywhere it lives (`front/` and `back/`
`package.json`, plus the mobile app's `package.json`, `app.json` and `src/constants/version.js`), and clears the queue. It never commits or tags on its own. The names are longer
than `/plan` and `/bug` because those two are Claude Code built-ins.

### Adding a convention

Put the new topic doc in the relevant skill's `references/` as `kebab-case.md`, then add a row to
that skill's routing table in its `SKILL.md` — a doc that isn't in the table won't get read.
Cross-cutting facts that apply to more than one app belong in [`CLAUDE.md`](CLAUDE.md) at the root.

---

## Conventions & further reading

The 22 topic docs behind those skills, if you want to read them directly. They're plain Markdown —
useful to a human even without an agent.

**Project map:** [`CLAUDE.md`](CLAUDE.md) (root) · [`front/CLAUDE.md`](front/CLAUDE.md) ·
[`back/CLAUDE.md`](back/CLAUDE.md) · [`app/CLAUDE.md`](app/CLAUDE.md)

### Frontend — [`.claude/skills/frontend-conventions/references/`](.claude/skills/frontend-conventions/references/)

| Doc | Covers |
| --- | ------ |
| [`code-conventions.md`](.claude/skills/frontend-conventions/references/code-conventions.md) | Naming, import order, the `@/` alias, mandated libraries, error handling, ESLint rules. Read first. |
| [`folder-structure.md`](.claude/skills/frontend-conventions/references/folder-structure.md) | Where pages/modules/components/services live, and how to register a route. |
| [`hooks-pattern.md`](.claude/skills/frontend-conventions/references/hooks-pattern.md) | The `hooks.jsx` contract every list page follows. |
| [`api-guide.md`](.claude/skills/frontend-conventions/references/api-guide.md) | `api/` + `requests/` layers, the response envelope, query keys & invalidation. |
| [`auth-state.md`](.claude/skills/frontend-conventions/references/auth-state.md) | The Zustand auth store, login/logout, sessions, the forced password change, `usePermissions`, `<ProtectedRoute>`. |
| [`ui-design-system.md`](.claude/skills/frontend-conventions/references/ui-design-system.md) | The Modern system — tokens, dark mode, list-page skeleton, table columns. |
| [`modern-module-pattern.md`](.claude/skills/frontend-conventions/references/modern-module-pattern.md) | The canonical copy-paste spec for a module's list page + drawer. |
| [`ui-form-design.md`](.claude/skills/frontend-conventions/references/ui-form-design.md) | The Sheet form pattern — react-hook-form + zod, the props contract. |

### Backend — [`.claude/skills/backend-conventions/references/`](.claude/skills/backend-conventions/references/)

| Doc | Covers |
| --- | ------ |
| [`auth-context.md`](.claude/skills/backend-conventions/references/auth-context.md) | `req.user` fields, Owner protection, the `requireAuth` guard, accounts created for someone else, auditing. |
| [`db-patterns.md`](.claude/skills/backend-conventions/references/db-patterns.md) | `req.db.query` vs `conn.execute` return shapes, transactions, soft-delete filtering. |
| [`schema-conventions.md`](.claude/skills/backend-conventions/references/schema-conventions.md) | Table structure, business IDs, UUIDs, timestamps, phone columns, FKs, migrations. |
| [`validators.md`](.claude/skills/backend-conventions/references/validators.md) | Zod schemas, the `_helpers.js` wrappers: optional fields, `optionalPhone()`, `newPassword()`, `optionalUploadPath()`. |
| [`permission-gating.md`](.claude/skills/backend-conventions/references/permission-gating.md) | One permission per route group, the access hierarchy, the Owner-role rules. |
| [`file-uploads.md`](.claude/skills/backend-conventions/references/file-uploads.md) | The `public/uploads/admin/` paths and per-user folders, signed links, content checks, ownership on save and delete. |
| [`testing.md`](.claude/skills/backend-conventions/references/testing.md) | How `npm test` works, the test helpers, and the Deleted/Owner-record test every by-ID endpoint needs. |

### Mobile app — [`.claude/skills/mobile-conventions/references/`](.claude/skills/mobile-conventions/references/)

| Doc | Covers |
| --- | ------ |
| [`architecture-and-traps.md`](.claude/skills/mobile-conventions/references/architecture-and-traps.md) | Commands, the api/requests split, local DB layering, navigation, theming, typography, demo mode, and the traps. Read first. |
| [`engineering-checklist.md`](.claude/skills/mobile-conventions/references/engineering-checklist.md) | The bar for every change: reuse, fetch/render cost, layout at 320px and on tablets, loading/empty/error states, known gaps. |
| [`project-structure.md`](.claude/skills/mobile-conventions/references/project-structure.md) | Where files live in `app/src/` and the component kit (screen chrome, `pattern/`, RNR primitives). |
| [`code-conventions.md`](.claude/skills/mobile-conventions/references/code-conventions.md) | Naming, exports, imports, the library set, where state lives, error handling, RN rendering traps. |
| [`data-layer.md`](.claude/skills/mobile-conventions/references/data-layer.md) | `services/api` + `services/requests`, React Query keys, demo mode, Zustand, the SQLite layering. |
| [`design-guidelines.md`](.claude/skills/mobile-conventions/references/design-guidelines.md) | Tokens, dark mode, typography, icons, spacing, the screen checklist. |
| [`module-pattern.md`](.claude/skills/mobile-conventions/references/module-pattern.md) | The list screen + create/edit sheet anatomy and the conversion checklist. |
