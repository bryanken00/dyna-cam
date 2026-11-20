---
type: removed
impact: patch
audience: user
ref: CR-024
---

The Clips page is gone from the Admin portal; Dyna Cam now has Sessions and Payments. Staff still
take payments in Payments.

## Dev notes

- front/: Clips nav item, route, page and its list services removed; `/admin/dyna-cam/clips`
  redirects to Sessions. `useGetClipOptions` (venue/court options) stays. The API is unchanged.
