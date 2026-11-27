---
type: added
impact: minor
audience: user
ref: PLAN-009
---

Venues can create clubs that players join from the new Clubs tab in the player app. A club is
either open to anyone or approves each new member. Staff can approve members, make club admins,
and limit an Open Play session to one club's members. Venues can also run coached clinics, with
the coach's name shown, which players find under Discover → Coaching and join like Open Play.

## Dev notes

- back/: run `npm run db:migrate` (053: `clubs`, `club_members`, `play_sessions.clubId` /
  `coachName`, `play_series.clubId` / `coachName`, the `clubs` permission granted to every Owner).
- back/: new `/api/v1/admin/clubs/*`, `/api/v1/public/clubs[/:token]` and
  `/api/v1/player/clubs/*`. The Open Play admin API takes `kind`, `coachName` and `clubId`, and
  its options list each venue's clubs. Joining a club's session as a non-member answers 403.
  `/public/open-play?kind=Clinic` lists clinics. Tests: `tests/clubs.test.js`.
- front/: Admin → DGSports → Clubs (`clubs` permission). The Open Play form has Type, Coach and
  Who can join.
- web-app/: a Clubs tab (`/clubs`, `/clubs/:key`), Discover → Coaching (`/coaching`), and the
  coach and members-only notice on a session's page.
