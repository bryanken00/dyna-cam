# DGSports

The product was called **Dyna Cam** until CR-036 (2026-11-24); the repository, folders and code
names (`DynaCam/`, `dynaCam.js`, `dyna-cam-api`) keep the old name, and the mobile app and
recorder box are still branded Dyna Cam until their own rebuild.

A court-camera service for pickleball venues, built on this repo's admin platform. Players book a
court, then scan its QR and enter their booking code to start recording their game (CR-034), then watch it live, save their best rallies, and get the
whole game on their phone (CR-027; the old 60-second clips and court buttons are gone — clips saved
before only expire). Videos never live in the cloud (CR-040): the venue's recorder box keeps each
game's video and sends it straight to the court's **Google Drive**, and players get it only as a
Drive link. Staff run venues, courts, cameras, games and payments from the web Admin portal and the mobile
staff app. The roadmap is [PLAN-001](docs/plans/PLAN-001-court-replay-cameras/plan.md).

The platform is single-organisation with one portal, **Admin** (`/admin/*` in the client,
`/api/v1/admin/*` in the API), where staff manage users, roles, permissions, settings and
resources. The **Owner** — created by `npm run db:setup` — holds every permission and is never
listed, editable or assignable in Users or Roles; everyone else gets access through roles and
per-user overrides.

## Repository layout

| Path              | What it is                                                            | Conventions live in                                                          |
| ----------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `front/`          | React 19 + Vite client (shadcn/ui, Tailwind v4, Zustand, React Query) | [front/CLAUDE.md](front/CLAUDE.md) → `frontend-conventions` skill             |
| `back/`           | Node + Express API (MySQL via `mysql2`, Passport JWT, Zod) + API tests | [back/CLAUDE.md](back/CLAUDE.md) → `backend-conventions` skill                |
| `app/`            | Expo SDK 58 / React Native staff app (NativeWind, Zustand, React Query) | [app/CLAUDE.md](app/CLAUDE.md) → `mobile-conventions` skill                 |
| `edge/`           | Recorder box: Node + ffmpeg, records each court camera and cuts clips | [edge/CLAUDE.md](edge/CLAUDE.md) → `edge-conventions` skill                 |
| `docs/`           | Repo-level Markdown for every part: plans, CRs, bugs, changelog, notes | [docs/README.md](docs/README.md)                                             |
| `.claude/skills/` | Claude Code skills checked into the repo                              | [.claude/skills/](.claude/skills/)                                           |

### Skills

The convention docs are packaged as skills so they load on demand instead of costing ~22k tokens
in every session. **Load the relevant skill before writing code** — the rules in it are
**non-negotiable** unless the user says otherwise.

| Skill | Use it for |
| ----- | ---------- |
| [`frontend-conventions`](.claude/skills/frontend-conventions/SKILL.md) | Anything under `front/src` — pages, hooks, components, forms, services, stores, routes. 8 topic docs. |
| [`backend-conventions`](.claude/skills/backend-conventions/SKILL.md) | Anything under `back/server`, `back/database` or `back/tests` — controllers, routes, validators, migrations, uploads, tests. 7 topic docs. |
| [`mobile-conventions`](.claude/skills/mobile-conventions/SKILL.md) | Anything under `app/` — screens, hooks, components, sheets, services, stores, SQLite, navigation, `app.json`. 7 topic docs; start with `architecture-and-traps.md`. |
| [`edge-conventions`](.claude/skills/edge-conventions/SKILL.md) | Anything under `edge/` — the recorder box: device API client, ffmpeg recording and clip cutting, segment timing, the job queue, tests and smoke run. |
| [`new-module`](.claude/skills/new-module/SKILL.md) | A whole new CRUD module end to end: table + migration, permission row, validator, controller, routes, services, list page, form drawer, sidebar registration. Drives the frontend and backend skills in the right order. |
| [`new-mobile-module`](.claude/skills/new-mobile-module/SKILL.md) | A new list/detail screen module in `app/`: screen, state hook, form sheet, data source, route, Menu row. Runs after `new-module` when the module also needs a table and API. |
| [`plan-doc`](.claude/skills/plan-doc/SKILL.md) | **Automatic** for a fully new feature or module (also `/plan-doc`) — plan + checklist in `docs/plans/PLAN-NNN-<slug>/`. |
| [`change-request`](.claude/skills/change-request/SKILL.md) | **Automatic** for a change to something that already exists, including new features added to it (also `/change-request`) — request + checklist in `docs/change-requests/CR-NNN-<slug>/`. |
| [`bug-report`](.claude/skills/bug-report/SKILL.md) | **Automatic** when something is broken (also `/bug-report`) — root cause + fix checklist in `docs/bug-reports/BUG-NNN-<slug>/`. |
| [`changelog`](.claude/skills/changelog/SKILL.md) | **Automatic** every time a plan, CR, or bug checklist is finished (also `/changelog`) — queues an entry in `docs/changelog/unpublished/`. |
| [`publish`](.claude/skills/publish/SKILL.md) | `/publish` only — rolls the queue into a plain-language release note, bumps the version. |

## Work tracking is automatic

Every request to build, change, or fix something under `front/`, `back/`, `app/` or `edge/` gets its tracking doc
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
  client, the API or the app → put it in **[`docs/`](docs/)**, not at the repo root and not
  inside `front/` / `back/` / `app/`. See [docs/README.md](docs/README.md) for what belongs there
  and the naming convention. There is one `docs/` and one `.claude/` for the whole repo; don't
  create nested ones inside a part.
- **Coding conventions** for a side live in that side's skill:
  `.claude/skills/frontend-conventions/references/`,
  `.claude/skills/backend-conventions/references/` and
  `.claude/skills/mobile-conventions/references/`. One topic per file, `kebab-case.md`; add the
  new file to the skill's routing table so it gets read.
- The repo root keeps only its map files (`README.md`, `CLAUDE.md`).

## Cross-cutting facts

- **Backend response envelope:** every endpoint replies via `res.sendSuccess()` →
  `{ success, message, data: { ... } }`. The frontend unwraps `apiData?.data?.<entity>`; the
  mobile app's `services/api/` returns the envelope and `requests/` reads `.data.<entity>`.
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
- **Dyna Cam route families without a user login:** `/api/v1/device/*` (recorder boxes,
  `Authorization: Device <token>`, scoped to their venue — another venue's record is a 404);
  `/api/v1/app/*` (a phone/tablet paired to **one recording session**,
  `Authorization: App <token>`: the session, its live view and Stop; unpaired 10 min after the
  session ends); `/api/v1/pair/*` trades a single-use 6-digit key from a session's "Pair a device" for an
  app token, or (`/pair/enroll`) a box's `ENROLL_KEY` + `VENUE_ID` from its `.env` — matching
  the API's `RECORDER_ENROLL_KEY` — for a box token. Recorder boxes have no page: list and revoke
  them with `npm run boxes` / `npm run boxes:revoke -- <name or id>` in `back/`; `/api/v1/public/*` is
  the player's page (the court QR / clip share token is the credential, and a short-lived code
  from the session device's QR lets a player add their own Facebook/YouTube stream — its key is
  stored encrypted and never returned; CR-025: while a game records, its page also gets the box's signed
  live link and can Save the last … via `POST /public/sessions/:shareToken/captures`; CR-034:
  the court QR's `/public/courts/:qrToken` only checks a booking in by its code
  (`POST …/check-in`) — CR-027's walk-in `POST …/games` is gone, so the QR never starts a game
  without a booking (`startedByPlayer = 1` marks the walk-in games made before); CR-028: the game page also has
  the device's End game, delete a save and own-stream controls under `/public/sessions/:shareToken/…` —
  anyone holding the link can use them). CR-015: an unpaid game's videos open only once staff record its
  payment (CR-039: games no longer start unpaid — booking check-ins are free, Sessions has no New game
  any more and its API always creates a free game; older unpaid games keep this — Admin → Sessions → Record payment, Payments permission); until then the session device
  and the player's page show its pay code, and `/public/games/:payCode` (rate-limited) gives a paid
  game's link to Find a game on the device; `/api/v1/oauth/google/callback` is where Google sends staff
back after connecting a court's Google Drive (CR-001) — its encrypted, 10-minute `state` is the
credential, and the court's Drive refresh token is stored encrypted and never returned. CR-040: the
API opens each Drive upload (`/device/game-videos/:id/drive-session`) and the box sends the bytes to
Google itself; the API never stores or serves a video file, and gives game jobs only to a box that
reports `drive-direct`. The app keeps its token
  in `expo-secure-store`; the recorder box in `DATA_DIR/device.json`. The app is a session device
  only — staff work, including payments, happens on the web.
- **Court booking (PLAN-003):** players reserve court time ahead; a `bookings` row reserves it and
  only **check-in** creates its game (`utils/bookingCheckIn.js`). Games, live bookings (incl.
  unexpired `Pending` holds), closures and opening hours share one overlap rule,
  `utils/courtTimeline.js` `findConflict()` — every writer locks the **court row** `FOR UPDATE`
  first (then the booking), and Start a game / New game refuse booked time. Two more
  no-login credentials: a venue's **booking link** (`venues.bookingToken`, `/book/:bookingToken`,
  API `/public/book/:bookingToken/*`; NULL = online booking off) and a booking's **own link**
  (`bookings.manageToken`, `/booking/:manageToken`, API `/public/bookings/:manageToken/*`: pay,
  check in, and until the venue's cut-off cancel / move once); CR-038: a venue's **TV court board**
  link (`venues.displayToken`, `/board/:displayToken`, API `/public/board/:displayToken`: today's
  courts with no names, codes, reasons or IDs; NULL = off); CR-043: players book online only up to
  `venues.scheduleConfirmedUntil` (a Sunday — staff confirm next week each week via
  `POST /admin/booking-settings/:venueId/confirm-week`, `utils/scheduleWeeks.js`; the desk isn't
  limited, the Dashboard reminds); all three links come from `randomToken()`, and
  their replies name courts by a hashed key, never a business ID. CR-030: players get in through
  `/book` (every Active venue with a booking link and an Active court, from `GET /public/venues`)
  and `/booking` (Find my booking: `POST /public/bookings/find`, booking code + the booking's phone
  or email → its link; one 404 for every miss, rate-limited). A booking must be `Paid` or
  `Free` to check in. **Online payment** goes through Dyna Cam's one Xendit account
  (`lib/payments/xendit.js`; off unless `XENDIT_SECRET_KEY` and `XENDIT_CALLBACK_TOKEN` are set):
  `/api/v1/webhooks/xendit` is its own route family — the `x-callback-token` header is the
  credential, and a payment is believed only after reading the invoice back from Xendit, never
  from the webhook body or the checkout redirect (`utils/bookingPayments.js`). Refunds are queued
  in the cancel's transaction and sent after commit; a refused one shows **Refund failed**.
  Booking emails (`utils/bookingEmails.js`) are sent after the commit of the request that causes
  them and never fail it; once-only ones are claimed on their `…SentAt` column. Staff work is under
  the `bookings` permission (money still needs `payments` write); the job is
  `jobs/bookingMaintenance.js` (every minute).
- **Backend changes are tested:** `cd back && npm test` (throwaway database, never touches
  `DB_DATABASE`). A new by-ID endpoint gets a test that a `Deleted` record (and, where relevant,
  an Owner-owned one) returns 404 and stays unchanged. There is no CI, so run
  `npm run lint` and `npm test` yourself before reporting a backend change done.
- **Recorder box changes are tested:** `cd edge && npm run lint && npm test`, and `npm run smoke` (a real
  ffmpeg record → cut → watermark run) when recording or clip cutting changes.
- **App changes are bundled, not unit-tested:** `app/` has no test runner or linter. Verify with
  `cd app && npx expo-doctor@latest && npx expo export --platform android --clear`, and try the
  flow on a device or emulator against the API on port `4021` (use the machine's LAN IP).
- **Schema changes are migrations, never `schema.sql`:** `back/database/schema.sql` is the
  frozen baseline — don't edit it. Every schema change (new table, column, index, ENUM, FK,
  backfill) is a **new numbered migration** in `back/database/migrations/`. A migration is
  **immutable once implemented** (committed or applied): never edit, rename or delete it, even
  to fix it — add another migration. The real schema is `schema.sql` + every migration in order.
- **Every shipped change gets a changelog entry:** when you finish a plan, CR, or bug checklist
  (or any other change under `front/`, `back/`, `app/` or `edge/` that will ship), add one entry to
  `docs/changelog/unpublished/` via the `changelog` skill **before reporting done** — one per
  finished checklist / logical change, not per file. Docs/`.claude/`-only changes
  don't get one. **Never bump `version` by hand** — `/publish` picks it from the entries' impact
  and bumps `front/`, `back/`, `edge/` and `app/` together.
- **One product version:** the web frontend reads `version` from `front/package.json`, injected
  by `vite.config.js` as `import.meta.env.APP_VERSION`. The mobile app keeps the same version in
  `app/package.json`, `app/app.json` (`expo.version`) and `app/src/constants/version.js`. There is
  no version env var — don't add one. EAS owns the app's build numbers.
