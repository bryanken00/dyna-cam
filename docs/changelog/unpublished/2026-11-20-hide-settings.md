---
type: removed
impact: patch
audience: user
ref: CR-021
---

The Settings page is gone from the Admin portal — nothing used its values. Roles no longer list a
Settings permission.

## Dev notes

- back/: run `npm run db:migrate` — `026_hide_settings_permission.sql` marks the `settings`
  permission Inactive (row kept). The setup scripts no longer seed it. The stored settings and
  `/api/v1/admin/settings` are kept, unused by the web app.
- front/: Settings nav item, route, page and its api/requests services removed;
  `/admin/settings` is Not found.
