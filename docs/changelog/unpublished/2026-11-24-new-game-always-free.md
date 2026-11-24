---
type: removed
impact: major
audience: user
ref: CR-039
---

Sessions no longer has **New game**: every game now starts from a booking — for a walk-in, make a
desk booking and check it in. No new game asks for payment at the desk any more; games created
unpaid before this keep their pay code and can still be marked paid.

## Dev notes

- back/: `POST /api/v1/admin/sessions` (now, scheduled, waiting for the device) always creates a
  Free game — `free` is no longer read (removed from the validator).
- front/: Sessions — New game button, empty-state button and `SessionFormDrawer` removed (and the
  front's `createSessionApi` / `useCreateSession`); the header links to Bookings. The API stays.
- back/tests: `ctx.makeUnpaid(sessionId)` turns a game into an unpaid one (with a real pay code)
  for the payment tests; new test that New game is always free.
