# PLAN-008 · Multi-company SaaS: companies, company-wide Admin, and a back office

> **Status:** Draft · **Created:** 2026-11-26 · **Owner:** bryanken00 · **Checklist:** [checklist.md](checklist.md)
> **Related:** [PLAN-001](../PLAN-001-court-replay-cameras/plan.md) (venues, courts, boxes), [PLAN-003](../PLAN-003-court-booking/plan.md) (booking, Xendit), [PLAN-006](../PLAN-006-player-google-sign-in/plan.md) (players)

## Goal

DGSports runs many client **companies** from one deployment. We (DGSports) onboard each company in
a new **back office**. Each company's staff use the same Admin portal they use today, but see only
their own company's data: venues, courts, cameras, bookings, games, payments, users, roles,
settings and the audit trail. Players and recorder boxes keep working as they do now.

```
Back office (DGSports, super admins)      /backoffice      — onboard and manage companies
 └─ Company (a client, e.g. "BigPickle Inc.")
     └─ Admin portal (company staff)        /admin           — company-wide, never another company
         └─ Venues → Courts → Cameras / Boxes → Games, Bookings, Payments, Clips …
```

## Context

Today the platform is **single-organisation** ([CLAUDE.md](../../../CLAUDE.md)):

- **Staff data is global:** every Admin query sees the whole database, filtered only by soft
  delete ([auth-context.md](../../../.claude/skills/backend-conventions/references/auth-context.md)).
  `users`, `roles`, `settings` and `audit_trail` have no owner column, and there's one **Owner**
  (seeded by `scripts/_seed-owner.js`, hidden from Users and Roles).
- **Venue data:** almost everything else already belongs to a venue through `venueId`:
  - `courts`, `devices`, `recording_sessions`, `bookings`, `booking_orders`, `payments`;
  - `clips`, `court_rates`, `venue_hours`, `court_closures`, `venue_alerts`;
  - `paired_apps`, `pairing_codes`.
  - Their children (`session_videos`, `session_captures`) belong to a game.
- **Unique across the whole app:**
  - `credentials.email` (one staff login per email);
  - role names (among live roles);
  - the `settings` keys (`companyDisplayName`, `supportEmail`, …).
- **No owner check on reads by ID:** Admin controllers
  ([controllers/v1/admin/](../../../back/server/src/controllers/v1/admin/), 15 files) read by
  business ID with no tenant check.
- **Outside the Admin portal:**
  - players (`players`) are global Google accounts;
  - the public `/book` directory lists every Active venue;
  - recorder boxes enrol per venue;
  - Xendit, SendGrid and Google are one set of keys in `back/.env`.

So the step to SaaS is mostly: **one `companies` table, a `companyId` on the few top-level tables, and
a company check on every Admin query** — plus a separate back office to create companies.

## Approach

### Words

- **Company:** the tenant. The column is `companyId`.
- **Super admin:** a DGSports person in the back office.
- **Company Owner:** the first account of a company. It holds every permission and is hidden from
  that company's Users and Roles, like today's Owner.

### Data — migration `044_companies.sql`

- **`companies`:**
  - business ID `companyId`, `name`, `slug` (unique, URL-safe), `contactEmail`, `contactPhone`;
  - `status` (`Active`, `Suspended`, `Deleted`) and the dates.
- **`companyId VARCHAR(50)`** with an index and a FK to `companies`, added to the top-level tables
  only:
  - `venues`: everything under a venue belongs to the venue's company;
  - `users` and `roles`: staff and their roles belong to one company;
  - `settings`: per company; the unique key becomes (`companyId`, `settingKey`);
  - `audit_trail`: each company sees only its own.
- **Backfill:** one company, **"Default company"** (renamed later in the back office), owns every
  existing row. Then `companyId` becomes `NOT NULL`. Nothing changes for today's data or staff.
- **Unique per company:** role names become unique per company. `credentials.email` stays unique
  across the platform, so one staff email belongs to one company (see Open questions).
- **Tables not changed:** venue children stay as they are and are scoped by joining `venues`. A
  `companyId` copy on hot tables (`bookings`, `recording_sessions`, `payments`) is a later
  optimisation if reports get slow.

### Back office users (super admins)

- **Separate accounts:** a separate `platform_admins` table with its own login.
  - Email plus password, the same password policy, lockout and must-change-password flow as staff.
  - Its own JWT audience, like players' tokens (`utils/playerTokens.js`), so a back-office token
    never passes an Admin check and an Admin token never passes a back-office check.
- **First super admin:** seeded by `npm run db:setup` from `SUPERADMIN_EMAIL` and an optional
  `SUPERADMIN_PASSWORD`, the same way the Owner is seeded today.
- **Permissions:** every super admin can do everything in the back office for now (no back-office
  roles yet).

### Company scope in the Admin API (the rule)

- **The token:** `passport.jwt.config.js` loads the user's `companyId`, so it is on `req.user`, and
  `requireAuth` refuses a user whose company isn't Active (403 `COMPANY_SUSPENDED`).
- **Every Admin query is scoped to `req.user.companyId`. No exceptions:**
  - **Tables with `companyId`:** `AND x.companyId = ?`.
  - **Tables under a venue:** join `venues v ON v.venueId = x.venueId AND v.companyId = ?`, using a
    helper in `utils/companyScope.js` such as `inCompanyVenue(alias)`.
  - **By-ID endpoints:** a record in another company returns **404**, like a missing or Deleted one,
    never a 403. Writes use the same join in the `UPDATE … WHERE`, as the Owner rule does today.
  - **IDs a client sends** (`venueId`, `courtId`, `roleId` in bodies and filters) are checked to
    belong to the caller's company before they're used.
  - **Lists and reports** (Dashboard, Payments, Bookings, Sessions, Clips, Audit trail) only count
    the company's venues.
- **Owner rule per company:** `roleName = 'Owner'` is hidden **within** the company. Each company
  has its own Owner role and account.
- **Background jobs** (booking maintenance, venue health, Drive jobs) keep running across all
  companies. When they notify staff ("everyone with the venue alerts permission"), they pick only
  the venue's company's users.
- **Tests:** a cross-company test for every Admin module. Company B's staff can't list, read,
  edit, delete or use company A's venues, courts, boxes, bookings, games, payments, clips, users,
  roles, settings or audit rows (404 or empty), and A's rows stay unchanged. The convention docs
  get the rule (backend `auth-context.md`, testing).

### Back office — `/backoffice` (web) and `/api/v1/backoffice/*` (API)

- **Sign in:** `/backoffice/login`, separate from the staff login.
- **Companies list:** name, status, number of venues, courts and boxes online, and bookings and
  games this month.
- **Onboard a company:**
  1. Company details: name, slug, contact.
  2. The company's Owner: first and last name, email.
  3. In one transaction the back office creates the company, its Owner role (every permission), the
     Owner account (`mustChangePassword = 1`, a temporary password from `passwordProblem()`), and
     its default settings.
  4. The Owner gets a welcome email with the sign-in link and the temporary password. The back
     office also shows the password once.
- **Company page:**
  - edit the details;
  - **Suspend** / **Reactivate**: suspended staff can't sign in, and its venues stop taking online
    bookings while existing bookings and games stay;
  - re-send the Owner's welcome, or reset the Owner's password.
- **Super admins:** list, add and deactivate (later phase).

### Admin portal (company staff)

- **Same pages:** the data is scoped by the API, so pages change little.
- **Top bar:** shows the company name.
- **Settings:** per company (`companyDisplayName` and `supportEmail` are per company).
- **Recorder boxes:** enrol with their venue's `VENUE_ID` as today, so the company comes from the
  venue. `npm run boxes` (a platform tool) lists every company's boxes with the company name.

### Players and public pages

- **Players:** stay platform-wide. One Google account books at any company's venue, and My games
  shows all of them.
- **`/book` directory:** lists every Active venue of every Active company, as today. A suspended
  company's venues drop out (see Open questions for a per-company page).
- **Emails:** booking and game emails name the venue and the company's display name. They still
  come from the one SendGrid sender.
- **Payments:** see *Each company's own Xendit* below. Players' checkout is unchanged; the money
  goes to the venue's company.

### Each company's own Xendit (decided 2026-11-26)

Players pay straight into the company's own Xendit account. DGSports doesn't hold the money.

- **Settings:** Admin → **Settings → Online payment**, with the `payments` write permission.
  - The company enters its Xendit **secret key** and **webhook verification token**.
  - Both are stored encrypted, like a court's Drive refresh token, and never returned. The page
    only shows "Connected · test mode / live mode".
  - **Check connection** reads the account's balance through Xendit, to prove the key works.
- **Webhook per company:** each company gets its own URL to paste into its Xendit dashboard:
  `POST /api/v1/webhooks/xendit/:webhookKey`.
  - `webhookKey` comes from `randomToken()` and is stored on the company.
  - The `x-callback-token` is compared with **that** company's token.
  - The invoice is read back with **that** company's key before anything changes, as today
    (`utils/bookingPayments.js`).
  - The old `/webhooks/xendit` keeps working for the default company until it switches over.
- **Every Xendit call uses the venue's company keys:** create invoice, read invoice, expire and
  refund. `lib/payments/xendit.js` takes the keys as a parameter instead of reading `.env`. The
  keys come from `utils/companyPayments.js` (venue → company → decrypted keys).
- **No keys, no online booking:** a company without Xendit keys can't take online bookings or pay
  links, as when Xendit is off today. The booking page shows the venue's phone, and Admin tells
  staff to connect Xendit.
- **The default company:** it keeps using `XENDIT_SECRET_KEY` / `XENDIT_CALLBACK_TOKEN` from `.env`
  until its Owner saves its own keys. New companies never fall back to `.env`.
- **`PAYMENT_SANDBOX`:** the built-in test checkout stays platform-wide for development and tests.

### Phases

- **A · Companies and scope:** migration 044 (the default company owns everything), `companyId` on
  `req.user`, every Admin query scoped, cross-company tests, convention docs. Today's deployment
  keeps working as one company.
- **B · Back office:** platform admins, the `/backoffice` login, companies list, onboarding,
  suspend.
- **C · Each company's Xendit:** Settings → Online payment, per-company webhook, every Xendit call
  with the venue's company keys.
- **D · Polish:** company name in the Admin top bar and emails, the back-office company stats,
  `npm run boxes` showing the company.

### Alternatives considered

- **One database per company:** strongest isolation, but migrations, backups and boxes multiply,
  and players and the `/book` directory need cross-database queries. Too heavy for now.
- **`companyId` on every table:** simpler filters, but about 15 more columns to backfill and keep in
  sync on every insert. Scoping venue children through `venues` keeps one source of truth.
  Copying `companyId` onto hot tables stays possible later.
- **Super admins as normal users with `companyId = NULL`:** fewer tables, but one missed check
  would show every company's data to a staff token. A separate table and token audience can't leak
  that way.

## Affected areas

| Area | Files / tables | Change |
| --- | --- | --- |
| Database | `044_companies.sql`, later `045_platform_admins.sql`, `046_company_xendit.sql` | `companies`; `companyId` on venues, users, roles, settings, audit_trail; backfill; per-company unique role names and settings |
| API — auth | `middlewares/passport.jwt.config.js`, `requireAuth` | `req.user.companyId`; suspended company → 403 |
| API — Admin | all 15 `controllers/v1/admin/*.controller.js`, `utils/companyScope.js` | scope every query; foreign IDs → 404 |
| API — jobs / emails | `utils/venueHealth.js`, `jobs/*`, `utils/bookingEmails.js` | staff notifications per company |
| API — back office | `controllers/v1/backoffice/*`, `middlewares/platformAuth.middleware.js`, `utils/platformTokens.js` | sign-in, companies, onboarding, suspend |
| API — public | `public/booking.controller.js` (`/venues`) | hide suspended companies' venues and those without Xendit |
| API — payments | `lib/payments/xendit.js`, `utils/bookingPayments.js`, `utils/companyPayments.js`, `webhooks/xendit` | keys per company (encrypted on `companies`); webhook per company (`/webhooks/xendit/:webhookKey`) |
| Scripts | `_seed-owner.js`, `setup-database.js`, `boxes.js`, `seed-demo-data.js` | first super admin; Owner per company; demo with 2 companies |
| UI — Admin | top bar, Settings | company name; per-company settings |
| UI — back office | `front/src/pages/Backoffice/*`, a new route tree | login, companies list, onboard, company page |
| Docs | `CLAUDE.md`, backend `auth-context.md` + `testing.md` | the company-scope rule |
| App / edge | — | no change |

## Out of scope

- Subscription billing, plans or limits per company.
- Per-company SendGrid sender or Google keys (emails and Google sign-in / Drive stay DGSports').
- DGSports taking a fee from each payment (xenPlatform).
- A super admin opening a company's Admin as that company ("log in as").
- A custom domain or subdomain per company.
- Back-office roles and permissions (every super admin can do everything).

## Risks

- **A missed filter leaks another company's data:**
  - every Admin module gets a cross-company test;
  - `companyScope.js` makes the filter one call;
  - the rule goes into the backend conventions and code review;
  - a by-ID miss returns 404, never the record.
- **Existing data:** the backfill puts everything in "Default company" before `NOT NULL`. The
  migration can't run half-way, because MySQL DDL commits per statement, so it's ordered to be
  re-runnable (`IF NOT EXISTS` and a guarded backfill).
- **Background jobs:** they work across companies on purpose. Notifications are the only place they
  pick people, and they filter by the venue's company.
- **A payment settled with the wrong keys:** every invoice and refund looks the keys up from the
  booking's venue → company, never from the request. A webhook is believed only after reading the
  invoice back with that company's key, and the invoice's reference must match a booking of a venue
  in that company.
- **A company's Xendit key changes while invoices are open:** the old open invoices can't be read
  with the new key. Changing keys warns while unpaid checkouts exist; those holds just run out.
- **Players see venues of many companies:** intended (the `/book` directory). Players never see
  company IDs, as today.

## Open questions

Answered 2026-11-26 by bryanken00:

- [x] **The name:** company (`companyId`).
- [x] **Payments:** **each company's own Xendit** (keys in Admin → Settings → Online payment, webhook
      per company).
- [x] **Public booking:** one `/book` directory of all companies' venues.
- [x] **Staff emails:** one email = one company.
- [x] **Support access:** not now.

Still open:

- [ ] **Demo data:** `npm run db:data` builds two companies, so the separation is easy to see?
      *(Recommended: yes.)*

## Revisions

- 2026-11-26: Created.
- 2026-11-26: Open questions answered. Payments are each company's own Xendit (a new phase C);
  directory, one email = one company, and no support access as recommended.
