# CR-019 · Sidebar: User Management, Settings and Audit Trail at the bottom — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered (none)

## Build

- [x] `AdminRoute.jsx`: User Management moved after Dyna Cam, `section: "system"`
- [x] `cd front && npm run lint && npm run build`

## Acceptance

- [ ] User Management (Users, Roles) below the divider, above Settings and Audit Trail
- [ ] Top: Dashboard, Setup, Dyna Cam
- [ ] Staff without user permissions don't see User Management

## Wrap-up

- [x] Changelog entry added (`ref: CR-019`)
- [ ] Requester shown the result and signed off
- [ ] `request.md` status set to `Done`
