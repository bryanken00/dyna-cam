# PLAN-008 · Multi-company SaaS — Checklist

> Tick items as they land. Plan: [plan.md](plan.md)

## Before starting

- [x] Open questions answered (plan.md — 2026-11-26; only demo data left)
- [ ] Approved

## Phase A — Companies and company scope

### Database

- [ ] Migration `044_companies.sql`:
  - [ ] `companies` (companyId, name, slug UNIQUE, contactEmail, contactPhone, status, dates)
  - [ ] "Default company" row; `companyId` added to venues, users, roles, settings, audit_trail
  - [ ] backfill to the default company, then `NOT NULL` + index + FK
  - [ ] settings unique (companyId, settingKey); role names unique per company (checked in code)

### API

- [ ] `passport.jwt.config.js`: `companyId` on `req.user`; `requireAuth`: company not Active → 403
      `COMPANY_SUSPENDED` (login refuses too)
- [ ] `utils/companyScope.js`: helpers for "in my company" filters and "does this venueId / courtId
      / roleId belong to my company"
- [ ] Scope every Admin controller to `req.user.companyId` (lists, by-ID reads, writes, client-sent
      IDs → 404 / 400):
  - [ ] venues · courts (incl. camera setup, Drive connect) · devices / boxes
  - [ ] sessions (games) · clips · captures · payments
  - [ ] bookings · booking-settings · closures
  - [ ] dashboard (stats, alerts, insights)
  - [ ] users · roles · user-permissions · permissions (the list stays global; assignments per
        company) · settings · audit-trail
  - [ ] Owner rule per company (`roleName = 'Owner'` within the caller's company)
- [ ] New rows get the caller's `companyId` (venues, users, roles, settings, audit rows)
- [ ] Jobs and emails: staff notifications (venue alerts, etc.) only to the venue's company
- [ ] Public `/venues` directory and booking link: hide suspended companies' venues
- [ ] Scripts: `_seed-owner.js` seeds the Owner into the default company; `boxes.js` shows the
      company; `seed-demo-data.js` builds two companies
- [ ] Tests: `company-scope.test.js` — for each Admin module, company B's staff can't list / read /
      edit / delete / use company A's records (404 or empty) and A's rows stay unchanged; the
      existing suite still passes as the default company
- [ ] Convention docs: backend `auth-context.md` and `testing.md` (the company rule replaces "every
      Admin query sees the whole database"); `CLAUDE.md`
- [ ] `npm run lint` · `npm test`

## Phase B — Back office

### API

- [ ] Migration `045_platform_admins.sql`: `platform_admins` (+ credentials fields, lockout,
      mustChangePassword) and their refresh tokens
- [ ] `utils/platformTokens.js` (own audience) + `middlewares/platformAuth.middleware.js`;
      `/api/v1/backoffice/auth/*` (login, refresh, logout, change password)
- [ ] `setup-database.js`: first super admin from `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`
- [ ] `GET /backoffice/companies` (with counts) · `GET /backoffice/companies/:companyId`
- [ ] `POST /backoffice/companies`: company + Owner role (all permissions) + Owner account
      (`mustChangePassword = 1`) + default settings, one transaction; welcome email after commit
- [ ] `PATCH /backoffice/companies/:companyId` (details) · `POST …/suspend` · `POST …/reactivate`
      · `POST …/owner/reset-password`
- [ ] Tests: staff token refused on `/backoffice/*` and back-office token refused on `/admin/*`;
      onboarding creates a working Owner who sees an empty company; suspend blocks its staff and
      online booking; Deleted company → 404
- [ ] `npm run lint` · `npm test`

### Web

- [ ] Route tree `/backoffice/*` with its own auth store (`VITE_STORE_KEY`-prefixed) and guard
- [ ] Login · change temporary password
- [ ] Companies list (status, venues, courts, boxes online, bookings this month)
- [ ] Onboard a company (Sheet form: company + Owner) → shows the temporary password once
- [ ] Company page: edit, Suspend / Reactivate, reset the Owner's password
- [ ] `npm run lint` · `npm run build`

## Phase C — Each company's own Xendit

- [ ] Migration `046_company_xendit.sql`: on `companies` — `xenditSecretKeyEnc`, `xenditCallbackTokenEnc`
      (encrypted, never returned), `xenditMode` (test / live), `xenditWebhookKey` (UNIQUE, `randomToken()`)
- [ ] `lib/payments/xendit.js`: every call (create, read, expire, refund) takes the keys as a parameter
- [ ] `utils/companyPayments.js`: venue → company → decrypted keys; the default company falls back to
      `.env` until it saves its own; others never do
- [ ] `utils/bookingPayments.js` + refunds + cancels: keys from the booking's venue's company
- [ ] `POST /api/v1/webhooks/xendit/:webhookKey`: compare `x-callback-token` with that company's token,
      read the invoice back with its key, and only settle bookings of that company's venues; the old
      `/webhooks/xendit` stays for the default company
- [ ] Admin → Settings → Online payment (`payments` write): save keys, Check connection, show
      Connected · mode and the webhook URL to copy; warn when changing keys with open checkouts
- [ ] No keys → the company's venues take no online bookings or pay links (`payOnline` false; Admin hint)
- [ ] Tests: two companies with different (fake) Xendit servers — each invoice, settle, refund uses its
      own company's keys; a webhook with company A's key/token can't settle company B's booking; no keys
      → online booking refused
- [ ] `npm run lint` · `npm test` · front `npm run lint` · `npm run build`

## Phase D — Polish

- [ ] Admin top bar shows the company name; Settings per company
- [ ] Emails use the company's display name

## Wrap-up

- [ ] Migrations 044 / 045 applied, or noted as pending for deploy (`SUPERADMIN_EMAIL` in `.env`)
- [ ] Tried in the browser: onboard company B in the back office → its Owner signs in, adds a venue →
      company A's staff never see it, and B never sees A's
- [ ] Changelog entry added in `docs/changelog/unpublished/` (`ref: PLAN-008`)
- [ ] `plan.md` status set to `Done`
