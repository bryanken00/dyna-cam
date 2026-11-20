---
type: improved
impact: patch
audience: user
ref: CR-019
---

User Management (Users, Roles) moved to the bottom of the sidebar, together with Settings and
Audit Trail. The top of the sidebar is now Dashboard, Venues and Dyna Cam — Venues is its own item,
no longer under "Setup". Items in the sidebar have a little more space between them.

## Dev notes

- front/: `routes/pageRoutes/AdminRoute.jsx` — User Management is after Dyna Cam with
  `section: "system"`; the Setup group is replaced by a top-level Venues item (still
  `/admin/setup/venues`). Routes and permissions unchanged.
