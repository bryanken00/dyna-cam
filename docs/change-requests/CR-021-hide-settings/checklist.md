# CR-021 · Hide the Settings page — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered (none)

## Build

- [x] front: Settings nav item + route removed; `pages/Admin/Settings` and the settings
      api/requests services deleted
- [x] back: migration `026_hide_settings_permission.sql` (`settings` permission → Inactive);
      `setup-database.js` / `setup-database-clean.js` stop seeding it
- [x] Test `tests/settings-hidden.test.js`: no Settings permission offered; not seeded Active
- [x] `cd back && npm run lint && npm test` (299 pass); `cd front && npm run lint && npm run build`

## Acceptance

- [x] No Settings in the sidebar; `/admin/settings` → Not found
- [x] Roles / user permissions show no Settings permission

## Wrap-up

- [x] Migration `026` pending (`npm run db:migrate`)
- [x] Changelog entry added (`ref: CR-021`)
- [x] Requester shown the result and signed off
- [x] `request.md` status set to `Done`
