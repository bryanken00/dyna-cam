# CR-020 · Hide Recent activity on the Dashboard — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered (none)

## Build

- [x] Dashboard: remove the RecentActivity card and the stats query that only fed it
- [x] `cd front && npm run lint && npm run build`

## Acceptance

- [x] The Dashboard no longer shows Recent activity; the rest is unchanged
- [x] The Audit Trail page still lists the activity

## Wrap-up

- [x] Changelog entry added (`ref: CR-020`)
- [x] Requester shown the result and signed off
- [x] `request.md` status set to `Done`
