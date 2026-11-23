# PLAN-004 · Demo data (`npm run db:data`) — Checklist

> Tick items as they land. Plan: [plan.md](plan.md)

## Backend

- [x] `back/scripts/seed-demo-data.js`: connect, production guard, empty the database (keep
      `_migrations`, `permissions`, the Owner) before seeding
- [x] Roles + role permissions, staff users + credentials (`DEMO_PASSWORD` or a random one), one override
- [x] Venues, courts (encrypted camera URLs, QR tokens), opening hours, rates, closures
- [x] Past games (staff / player / booked; Ready / Failed / Cancelled) and their cash payments
- [x] Bookings past and future, with their cash / online payments and refunds
- [x] A few audit-trail rows (alert history dropped — see plan Revisions)
- [x] `"db:data"` in `back/package.json`; mention it in `back/CLAUDE.md`, `README.md`, `back/.env.example`

## Wrap-up

- [x] `cd back && npm run lint` passes (0 errors, the 12 old warnings) and `npm test` 437/437
- [x] Ran `npm run db:data` twice on a throwaway database with extra staff, tokens and keys: only the
      Owner, permissions and the demo remain; the API's booking, clip and alert jobs left the demo alone
- [x] Admin dashboard, Sessions, Bookings, Payments, Venues, Users, Audit trail and a venue's
      booking link answer 200 for a demo manager login (API smoke run)
- [x] Changelog entry added in `docs/changelog/unpublished/` (`ref: PLAN-004`)
- [x] `plan.md` status set to `Done`
