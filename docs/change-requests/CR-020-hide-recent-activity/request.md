# CR-020 · Hide Recent activity on the Dashboard

> **Status:** Done · **Requested:** 2026-11-20 · **Requested by:** bryanken00 · **Size:** S
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [CR-019](../CR-019-sidebar-order/request.md) (admin pages moved down the sidebar)

## Requested change

> Hide this on dashboard. (the Recent activity card)

## Today

The Dashboard ends with a **Recent activity** card: the latest audit-trail entries ("CREATE
sessions · System Owner").

## Why

It repeats the Audit Trail page and isn't useful on the day-to-day court view.

## Scope

**In**

- Remove the Recent activity card from the Dashboard, and stop loading its data there.

**Out**

- The Audit Trail page (unchanged — the same entries are there).
- The API's dashboard-stats endpoint (left as is; the Dashboard just no longer calls it).

## Acceptance criteria

- The Dashboard no longer shows Recent activity.
- Everything else on the Dashboard is unchanged.
- The Audit Trail page still lists the activity.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Web: Dashboard (`pages/Admin/Dashboard`). |
| Data | None. |
| Build / rollout | Web deploy only. |
| Permissions | None. |
| Existing users | The card is gone; the Audit Trail page has the same entries. Release impact `patch`. |
| Size | S. |

## Open questions

- None.

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-20 | Asked directly |
| Signed off — Done | bryanken00 | 2026-11-20 | Bulk sign-off by the requester ("check all CR and plan… mark all complete"); acceptance items ticked on that sign-off, not re-checked one by one |
