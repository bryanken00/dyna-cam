---
type: added
impact: major
audience: user
ref: PLAN-008
---

DGSports now runs many companies on one platform. DGSports onboards each company in the new
**back office**, which creates the company and its Owner account (with a temporary password and a
welcome email), and can suspend or reactivate it. Super admins can add and manage each other, and
every back-office action is recorded on an Activity page — a company's own audit trail also shows
what DGSports did to it (for example "DGSports suspended the company"). Each company's staff use the Admin portal as
before but see only their own company: its venues, courts, cameras, games, bookings, payments,
users, roles and audit trail. The top bar shows the company's name. Each company now connects its
own **Xendit** account (Payments → Online payment), so players pay straight into it; a company
without Xendit can't take online bookings yet. Today's data becomes the "Default company", which
keeps using the server's Xendit keys until it connects its own.

## Dev notes

- back/: run `npm run db:migrate` — `044_companies.sql` (companies, with the Xendit columns;
  `companyId` on venues, users, roles, settings, audit_trail; everything backfilled to "Default
  company") and `045_platform_admins.sql` (super admins + their refresh tokens). Set
  `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD` (both required; no forced change at first sign-in) and run `npm run db:setup` (it also
  applies `046_platform_audit_trail.sql`). Setup now creates **only** the first super admin — no
  company or Owner; `OWNER_EMAIL` / `OWNER_PASSWORD` are gone (an existing install's data and Owner
  become the "Default company"). It seeds the first
  super admin. Set `API_PUBLIC_URL` so each company's Xendit webhook URL is right.
- back/: every Admin query is scoped to `req.user.companyId` (`utils/companyScope.js`); another
  company's record is a 404. Staff of a suspended company can't sign in and their tokens stop
  working. Venue-alert emails go only to the venue's company. `npm run boxes` shows each box's
  company. Tests: `company-scope-{people,venues,operations}`, `backoffice`, `company-xendit`.
- back/: `/api/v1/backoffice/*` (own token audience: `utils/platformTokens.js`,
  `middlewares/platformAuth.middleware.js`): sign-in, companies list / detail / onboard / edit /
  suspend / reactivate / reset the Owner's password; `/backoffice/admins` (add, rename, deactivate,
  reactivate, reset — not yourself, not the last active one) and `/backoffice/activity` (the
  `platform_audit_trail`, `utils/platformAudit.js`; company actions also write the company's
  `audit_trail` with actor `dgsports`, shown as "DGSports").
- back/: Xendit per company: `/api/v1/admin/company-payments` (write-only keys, checked with Xendit),
  `/api/v1/webhooks/xendit/:webhookKey`; every invoice, expiry and refund uses the booking's venue's
  company's keys (`utils/companyPayments.js`); a webhook settles only its own company's bookings.
- back/: `npm run db:data` keeps super admins and builds two demo companies.
- front/: `/backoffice/*` (login, companies, onboarding, company page, account); Admin top bar shows
  the company; Payments → Online payment card + Connect Xendit drawer.
- app/, edge/: no change (boxes enrol by venue, so they belong to the venue's company).
