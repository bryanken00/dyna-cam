# PLAN-008 · Multi-company SaaS — Checklist

> Tick items as they land. Plan: [plan.md](plan.md)

## Before starting

- [x] Open questions answered (plan.md — 2026-11-26; only demo data left)
- [x] Approved

## Phase A — Companies and company scope

### Database

- [x] Migration `044_companies.sql`:
  - [x] `companies` (companyId, name, slug UNIQUE, contactEmail, contactPhone, status, dates)
  - [x] "Default company" row; `companyId` added to venues, users, roles, settings, audit_trail
  - [x] backfill to the default company, then `NOT NULL` + index + FK
  - [x] settings unique (companyId, settingKey); role names unique per company (checked in code)

### API

- [x] `passport.jwt.config.js`: `companyId` on `req.user`; `requireAuth`: company not Active → 403
      `COMPANY_SUSPENDED` (login refuses too)
- [x] `utils/companyScope.js`: helpers for "in my company" filters and "does this venueId / courtId
      / roleId belong to my company"
- [x] Scope every Admin controller to `req.user.companyId` (lists, by-ID reads, writes, client-sent
      IDs → 404 / 400):
  - [x] venues · courts (incl. camera setup, Drive connect) · devices / boxes
  - [x] sessions (games) · clips · captures · payments
  - [x] bookings · booking-settings · closures
  - [x] dashboard (stats, alerts, insights)
  - [x] users · roles · user-permissions · permissions (the list stays global; assignments per
        company) · settings · audit-trail
  - [x] Owner rule per company (`roleName = 'Owner'` within the caller's company)
- [x] New rows get the caller's `companyId` (venues, users, roles, settings, audit rows)
- [x] Jobs and emails: staff notifications (venue alerts, etc.) only to the venue's company
- [x] Public `/venues` directory and booking link: hide suspended companies' venues
- [x] Scripts: `_seed-owner.js` seeds the Owner into the default company; `boxes.js` shows the
      company; `seed-demo-data.js` builds two companies
- [x] Tests: `company-scope-people` / `-venues` / `-operations.test.js` (25 tests) — for each Admin module, company B's staff can't list / read /
      edit / delete / use company A's records (404 or empty) and A's rows stay unchanged; the
      existing suite still passes as the default company
- [x] Convention docs: backend `auth-context.md` and `testing.md` (the company rule replaces "every
      Admin query sees the whole database"); `CLAUDE.md`
- [x] `npm run lint` · `npm test`

## Phase B — Back office

### API

- [x] Migration `045_platform_admins.sql`: `platform_admins` (+ credentials fields, lockout,
      mustChangePassword) and their refresh tokens
- [x] `utils/platformTokens.js` (own audience) + `middlewares/platformAuth.middleware.js`;
      `/api/v1/backoffice/auth/*` (login, refresh, logout, change password)
- [x] `setup-database.js`: first super admin from `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`
- [x] `GET /backoffice/companies` (with counts) · `GET /backoffice/companies/:companyId`
- [x] `POST /backoffice/companies`: company + Owner role (all permissions) + Owner account
      (`mustChangePassword = 1`) + default settings, one transaction; welcome email after commit
- [x] `PATCH /backoffice/companies/:companyId` (details) · `POST …/suspend` · `POST …/reactivate`
      · `POST …/owner/reset-password`
- [x] Tests: staff token refused on `/backoffice/*` and back-office token refused on `/admin/*`;
      onboarding creates a working Owner who sees an empty company; suspend blocks its staff and
      online booking; Deleted company → 404
- [x] `npm run lint` · `npm test`

### Web

- [x] Route tree `/backoffice/*` with its own auth store (`VITE_STORE_KEY`-prefixed) and guard
- [x] Login · change temporary password
- [x] Companies list (status, venues, courts, boxes online, bookings this month)
- [x] Onboard a company (Sheet form: company + Owner) → shows the temporary password once
- [x] Company page: edit, Suspend / Reactivate, reset the Owner's password
- [x] `npm run lint` · `npm run build`

## Phase C — Each company's own Xendit

- [x] Xendit columns on `companies` (in `044_companies.sql` — no separate 046): `xenditSecretKeyEnc`, `xenditCallbackTokenEnc`
      (encrypted, never returned), `xenditMode` (test / live), `xenditWebhookKey` (UNIQUE, `randomToken()`)
- [x] `lib/payments/xendit.js`: every call (create, read, expire, refund) takes the keys as a parameter
- [x] `utils/companyPayments.js`: venue → company → decrypted keys; the default company falls back to
      `.env` until it saves its own; others never do
- [x] `utils/bookingPayments.js` + refunds + cancels: keys from the booking's venue's company
- [x] `POST /api/v1/webhooks/xendit/:webhookKey`: compare `x-callback-token` with that company's token,
      read the invoice back with its key, and only settle bookings of that company's venues; the old
      `/webhooks/xendit` stays for the default company
- [x] Admin → **Payments → Online payment (Xendit)** card + drawer (`payments` write; `/admin/company-payments`): save keys (checked with Xendit's balance first), show
      Connected · mode and the webhook URL to copy; warn when changing keys with open checkouts
- [x] No keys → the company's venues take no online bookings or pay links (`payOnline` false; Admin hint)
- [x] Tests: two companies with different (fake) Xendit servers — each invoice, settle, refund uses its
      own company's keys; a webhook with company A's key/token can't settle company B's booking; no keys
      → online booking refused
- [x] `npm run lint` · `npm test` · front `npm run lint` · `npm run build`

## Phase D — Polish

- [x] Admin top bar shows the company name; Settings per company
- [x] Emails: one universal DGSports sender, as set up today — no per-company display name (decided 2026-11-26)

## Phase E — Back office admin

### API

- [x] Migration `046_platform_audit_trail.sql`: `platform_audit_trail` (auditId, platformAdminId,
      action, companyId NULL, description, metadata JSON, ipAddress, userAgent, dateCreated)
- [x] Record every back-office action: sign-in / failed sign-in / lockout, password change,
      onboard, edit, suspend, reactivate, Owner password reset, super-admin add / deactivate /
      reactivate / reset (secrets never in metadata)
- [x] Company actions also write a row to that company's `audit_trail` (actor shown as DGSports)
- [x] `GET /backoffice/activity` (filters: company, admin, action, dates; pagination)
- [x] `GET/POST /backoffice/admins`, `PATCH /backoffice/admins/:id` (name), `POST …/deactivate`,
      `POST …/reactivate`, `POST …/reset-password` (temporary password once; sessions revoked);
      not yourself, not the last active one; Deleted / unknown → 404
- [x] Tests: each action is audited; deactivated admin's token stops working; self / last-admin
      refused; temporary password must be changed

### Web

- [x] Back office **Super admins** page (list, add drawer, deactivate / reactivate, reset password
      with the temporary-password dialog)
- [x] Back office **Activity** page (DataTable with filters)
- [x] `npm run lint` · `npm run build` (0 errors; back `npm test` 536 pass)

## Setup creates only the super admin (2026-11-26)

- [x] `setup-database*.js`: seed permissions + the first super admin only; `SUPERADMIN_EMAIL` and
      `SUPERADMIN_PASSWORD` (8+ characters) both required until one exists, no forced change at
      first sign-in; `scripts/_seed-owner.js` and
      `OWNER_EMAIL` / `OWNER_PASSWORD` removed (`.env.example`)
- [x] Re-running setup grants every company's Owner role new permissions (`scripts/_owner-permissions.js`)
- [x] Migration 044: "Default company" only when the install already has data
- [x] Tests: the harness onboards the "Default company" + Owner (`utils/companies.js`);
      `first-password.test.js` covers super-admin-only setup (537 pass)
- [x] `npm run db:data` builds both demo companies and their Owners (checked on a throwaway database)
- [x] README, CLAUDE.md files and backend / new-module skill docs updated

## Wrap-up

- [x] `cd back && npm run lint` (0 errors) · `npm test` (528 pass) · `cd front && npm run lint` (0 errors) · `npm run build`
- [x] Changelog entry added (`ref: PLAN-008`) (covers phase E)

- [x] Migrations 044 / 045 noted as pending for deploy: set `SUPERADMIN_EMAIL` (and optionally `SUPERADMIN_PASSWORD`, `API_PUBLIC_URL`) in `.env`, then `npm run db:setup` (or `db:migrate` + setup for the super admin; migrations 044, 045, 046)
- [ ] Tried in the browser: onboard company B in the back office → its Owner signs in, adds a venue →
      company A's staff never see it, and B never sees A's
- [ ] `plan.md` status set to `Done`
