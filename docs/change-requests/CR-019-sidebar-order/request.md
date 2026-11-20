# CR-019 · Sidebar: User Management, Settings and Audit Trail at the bottom

> **Status:** In progress · **Requested:** 2026-11-20 · **Requested by:** bryanken00 · **Size:** S
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** —

## Requested change

> Put this on below: User management, Settings, Audit.

Move **User Management** (Users, Roles) down to the bottom of the sidebar, so the bottom group
reads **User Management → Settings → Audit Trail**.

## Today

The sidebar lists Dashboard, User Management, Setup, Dyna Cam, then — under a divider at the
bottom — Settings and Audit Trail.

## Why

The everyday pages (Dashboard, Setup, Dyna Cam) come first; administration sits together at the
bottom.

## Scope

**In**

- Sidebar order: Dashboard, Venues, Dyna Cam — divider — User Management (Users, Roles),
  Settings, Audit Trail (2026-11-20: Venues no longer under a "Setup" group). The sidebar search's ↑/↓ order follows it.

**Out**

- Page addresses, permissions, or who sees which item (unchanged).

## Acceptance criteria

- User Management (with Users and Roles) appears below the divider, above Settings and Audit Trail.
- The top of the sidebar is Dashboard, Setup, Dyna Cam.
- Staff without user permissions still don't see User Management.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Web: the sidebar only (`routes/pageRoutes/AdminRoute.jsx` order + `section: "system"`). |
| Data | None. |
| Build / rollout | Web deploy only. |
| Permissions | None — unchanged. |
| Existing users | Users / Roles move lower in the menu. Release impact `patch`. |
| Size | S: one list reordered. |

## Open questions

- None.

## Revisions

- 2026-11-20: **Venues** is its own sidebar item (no "Setup" group around it — Setup held only
  Venues). Its address stays `/admin/setup/venues`, so venue / court pages, printed links and
  Google Drive's return link keep working. Asked directly by bryanken00.

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-20 | Asked directly |
