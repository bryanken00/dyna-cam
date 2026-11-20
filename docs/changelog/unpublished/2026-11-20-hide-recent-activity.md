---
type: removed
impact: patch
audience: user
ref: CR-020
---

The Dashboard no longer shows the Recent activity card. The same entries are on the Audit Trail
page.

## Dev notes

- front/: `pages/Admin/Dashboard` drops the RecentActivity card and no longer calls
  `GET /api/v1/admin/dashboard/stats` (the endpoint and `useGetDashboardStats` are still there,
  unused).
