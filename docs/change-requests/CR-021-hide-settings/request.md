# CR-021 · Hide the Settings page

> **Status:** In progress · **Requested:** 2026-11-20 · **Requested by:** bryanken00 · **Size:** S
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [CR-019](../CR-019-sidebar-order/request.md) (sidebar), [CR-020](../CR-020-hide-recent-activity/request.md) (Dashboard tidy-up)

## Requested change

> We can remove or hide this settings.

## Today

Admin → **Settings** edits a company display name, support email, date format, timezone and
week start. **Nothing in Dyna Cam reads these values** — the pages, emails and the courtside app
use their own settings (`TIMEZONE`, `MAIL_FROM`, …). Roles also list a "Settings" permission.

## Why

A page whose changes do nothing confuses staff.

## Scope

**In**

- Remove Settings from the sidebar and remove its page (`/admin/settings` → Not found).
- Hide the "Settings" permission from Roles and user permissions (marked inactive; no longer
  seeded on a new database).

**Out**

- The stored settings and their API stay (nothing is deleted; it can come back).

## Acceptance criteria

- The sidebar has no Settings; its bottom group is User Management, Audit Trail.
- Opening `/admin/settings` shows Not found.
- Editing a role no longer shows a Settings permission.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Web: sidebar, Settings page removed, Roles / user permissions (one permission fewer). |
| Data | Migration `026`: the `settings` permission row → `Inactive` (kept). Setup scripts stop seeding it. |
| Build / rollout | Server (migration) + web deploy. |
| Permissions | `settings` hidden; roles that had it lose nothing that works. |
| Existing users | Settings is gone from the menu. Release impact `patch` (it had no effect). |
| Size | S. |

## Open questions

- None — hide (reversible) rather than delete the stored values.

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-20 | Asked directly ("remove or hide") — hidden, data kept |
