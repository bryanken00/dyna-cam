---
type: added
impact: minor
audience: user
ref: PLAN-009
---

In the player app, players can set their pickleball level and DUPR rating on their profile,
follow venues, and get back to venues they've booked from the Play tab (Book again). On
Discover they can filter venues by indoor or outdoor courts, court surface and amenities. Staff
set a court's surface and whether it's indoor in the court form, and a venue's amenities in the
venue form.

## Dev notes

- back/: run `npm run db:migrate` (049: `player_sports`, `venue_follows`, `courts.surface`,
  `courts.isIndoor`, `venues.amenities`).
- back/: new `GET/PUT /api/v1/player/sports`, `GET /player/follows`,
  `POST/DELETE /player/follows/:venueKey` and `GET /player/recent-venues`. `/public/venues` now
  also returns each venue's `key`, `amenities`, `surfaces`, `indoorCourts`, `outdoorCourts` and
  `followers`. The admin venue and court APIs take `amenities` / `surface` / `isIndoor`.
  Test: `tests/player-profile.test.js`.
- DUPR ratings are typed in by the player and shown as unverified. There's no DUPR sync.
- `npm run db:data` now gives demo venues amenities and demo courts a surface and an indoor flag.
