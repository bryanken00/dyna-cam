# CR-039 · No New game in Sessions; a staff game is always free — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered

## Build

- [x] API `POST /admin/sessions` (now, scheduled, open): always free — no pay code; `free` dropped
      from the validator
- [x] Front New game drawer: Payment section, `free` field and default removed; paid wording
      reworded
- [x] Revision: New game removed from Sessions — header and empty-state buttons, `SessionFormDrawer`,
      `createSessionApi` / `useCreateSession`; header links to Bookings; empty list explains
- [x] Tests: a helper turns a game into an older-style unpaid one (with a pay code) for the
      payment tests; a test that New game is always free, even if `free: false` is sent

## Acceptance

- [x] No New game in Sessions; Bookings link; empty-list hint
- [x] A game from the API → Free, no pay code, videos open (API test)
- [x] An older unpaid game can still be marked paid

## Wrap-up

- [x] `cd back && npm run lint && npm test` passes
- [x] `cd front && npm run lint && npm run build` passes
- [x] Changelog entry added (`ref: CR-039`)
- [x] Requester shown the result and signed off
- [x] `request.md` status set to `Done`
