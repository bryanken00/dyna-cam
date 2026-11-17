---
type: added
impact: minor
audience: user
ref: PLAN-001
---

Venues can now charge for players' clips. Set a clip price on the venue, and a player's clip
shows its preview and a short pay code until they pay at the front desk. Staff enter the code on
the new Payments page (or record the payment from the Clips page) and the clip unlocks on the
player's phone straight away. Payments can be refunded, and the page shows today's and this
month's takings. Clips saved by staff and session recordings stay free.

## Dev notes

- `back/`: run `npm run db:migrate` (migration `005_add_clip_payments`). New permission
  `payments` — grant it to the front-desk role. New endpoints under `/api/v1/admin/payments`.
- Cash only for now; online payment (PayMongo) is deferred — notes in PLAN-001.
