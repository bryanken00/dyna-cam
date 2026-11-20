---
type: improved
impact: patch
audience: user
ref: CR-019
---

User Management (Users, Roles) moved to the bottom of the sidebar, together with Settings and
Audit Trail. The top of the sidebar is now Dashboard, Setup and Dyna Cam.

## Dev notes

- front/: `routes/pageRoutes/AdminRoute.jsx` — User Management is after Dyna Cam with
  `section: "system"`. Routes and permissions unchanged.
