# CR-019 · Sidebar: User Management, Settings and Audit Trail at the bottom — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered (none)

## Build

- [x] `AdminRoute.jsx`: User Management moved after Dyna Cam, `section: "system"`
- [x] `cd front && npm run lint && npm run build`

### 2026-11-20 revision — Venues as its own item

- [x] `AdminRoute.jsx`: Setup group replaced by a top-level Venues item at `/setup/venues`
      (same address), Building icon
- [x] `cd front && npm run lint && npm run build`

### 2026-11-20 revision — spacing

- [x] `Sidebar.jsx`: 4px between sub-pages of a group (`space-y-1`) and between top-level items
- [x] `cd front && npm run lint && npm run build`

## Acceptance

- [ ] User Management (Users, Roles) below the divider, above Settings and Audit Trail
- [ ] Top: Dashboard, Venues, Dyna Cam; Venues stays highlighted on a venue / court page
- [ ] Staff without user permissions don't see User Management

## Wrap-up

- [x] Changelog entry added (`ref: CR-019`)
- [ ] Requester shown the result and signed off
- [ ] `request.md` status set to `Done`
