---
type: added
impact: minor
audience: user
ref: PLAN-009
---

Venues can run tournaments. They hold courts for the event's days, add divisions (round robin,
knockout, or groups then knockout, with a level range, a team cap and an entry fee), and open
registration. In the player app (Discover → Tournaments), players register a doubles team, send
their partner an invite link, and pay the entry fee online. They can withdraw before the draw for
a refund. Staff generate the draw, put matches on courts and times, call teams to their court, and
enter scores; winners move on automatically, and group winners go through to the knockout.
Players follow the draw, standings and live results in the app and on the venue's TV board, and
their teams and next matches appear on the Play tab.

## Dev notes

- back/: run `npm run db:migrate` (052: `tournaments`, `tournament_courts`,
  `tournament_divisions`, `tournament_teams`, `tournament_team_players`, `tournament_matches`,
  `court_closures.tournamentId`, `payments.tournamentTeamId`, the `tournaments` permission granted
  to every Owner). Give staff roles Tournaments access in Roles.
- back/: new `/api/v1/admin/tournaments/*`, `/api/v1/public/tournaments[/:token|/invites/:token]`
  and `/api/v1/player/tournaments/*`. Entry fees are Xendit invoices `team-<teamCode>` on the
  venue's company account (same webhooks). The minute job expires unpaid entries. The TV board
  reply has a new `tournaments` list. Tests: `tests/tournaments.test.js`,
  `tests/tournament-brackets.test.js`.
- A tournament holds its courts with court closures tied to it. They don't appear in, and can't
  be changed from, the Closures list.
- front/: Admin → DGSports → Tournaments and a tournament's page. Payments lists tournament
  entries. The TV board shows the day's tournament.
- web-app/: Discover → Tournaments (`/events`), a tournament's page (`/events/:key`), the partner
  invite (`/team-invite/:token`), and teams on the Play tab.
