# PLAN-004 · Demo data (`npm run db:data`)

> **Status:** Done · **Created:** 2026-11-23 · **Owner:** — · **Checklist:** [checklist.md](checklist.md)
> **Related:** PLAN-001, PLAN-003

## Goal

One command, `npm run db:data` in `back/`, fills a development database with realistic demo data
across the whole system (staff, roles, venues, courts, booking settings, bookings, games and payments), so every Admin page and the player's booking pages have something to show.
No video: no clips, saves or game video rows, and no files.

## Context

`npm run db:setup` ([../../../back/scripts/setup-database.js](../../../back/scripts/setup-database.js))
creates the schema, the permissions and the Owner, and nothing else. A fresh database shows empty
pages everywhere, so demos and UI checks start by clicking data in by hand.

## Approach

A new script, [../../../back/scripts/seed-demo-data.js](../../../back/scripts/seed-demo-data.js),
wired as `"db:data"` in `back/package.json`. It connects like the other `scripts/`, writes every row
in one transaction, and prints a summary and the demo logins.

- **Empties the database first.** Every table is truncated except `_migrations` and
  `permissions`; the Owner role, its permissions and the Owner account (login and sessions) are
  kept so the Owner can still sign in. Then the demo is loaded, so every run gives the same fresh
  demo. TRUNCATE commits on its own, so it runs before the seeding transaction. Video files on
  disk aren't deleted.
- **Never in production.** It refuses when `NODE_ENV=production`.
- **No fixed password.** Demo logins use `DEMO_PASSWORD` (checked with `passwordProblem()`), or a
  random one printed once. They aren't flagged for a password change, because the person running
  the script is the one who uses them.
- **Rows match what the app writes.** IDs come from `SELECT UUID()`, tokens and codes from
  `randomToken()` and `randomPayCode()`, camera URLs go through `encryptSecret()`, phones are in the
  `09XX XXXX XXX` format, and times are Manila local, relative to the moment the script runs. A
  seeded random generator keeps the mix the same from run to run.
- **Quiet with the API running.** The background jobs must not change or email the demo rows:
  - games are in the past and settled (Ready, Failed or Cancelled), so no video rows get made;
  - there are no recorder boxes, so no box-offline alerts;
  - unpaid desk holds carry a phone and no email, so no "released" email;
  - bookings that have started or ended are already settled.

  Player emails use `example.com`, and upcoming Confirmed bookings are marked as already
  reminded, so the job never emails a demo player.

What it seeds:

| Area | Rows |
| --- | --- |
| Staff | 3 roles (Venue Manager, Front Desk, Bookkeeper) with their permissions; 5 staff, one Inactive, one with a per-user override |
| Venues | Smash Point BGC (4 courts, 2 of them with two cameras), Dink House Cebu (3 courts, one with its own rate), Kitchen Line Alabang (2 courts + 1 Inactive, online booking off) |
| Booking setup | Opening hours, peak and off-peak rates, closures (past, upcoming court, upcoming whole venue) |
| Bookings | Past: Completed (with its game), NoShow, Cancelled (cash, refunded online, refund failed), Expired. Future: Confirmed (cash, online, free), Pending desk holds, one moved once |
| Games | About 14 days of past games: staff-made (Paid or Unpaid with a pay code), player-started (Free, 5 saves) and booked; mostly Ready, some Failed or Cancelled |
| Payments | Cash for games and bookings, Xendit online for bookings (fake `inv_demo_…` refs), refunds, one refund failed |
| Audit trail | A handful of staff actions |

### Alternatives considered

- A demo-data migration: migrations are for schema and run on every environment. Demo rows must
  never reach production.
- Driving the API over HTTP: this needs the server running and a login, and the API can't backdate
  history (past games, NoShows, refunds).
- Adding beside existing data and removing only an earlier demo (the first build): the user asked
  for a clean database each run instead.

## Affected areas

| Area | Files / tables | Change |
| --- | --- | --- |
| Script | `back/scripts/seed-demo-data.js`, `back/package.json` | New script + `db:data` |
| Data | all business tables but `clips`, `session_captures`, `session_videos`, `devices`, `paired_apps`, `pairing_codes`, `venue_alerts` | Rows inserted (dev only) |
| Docs | `back/CLAUDE.md`, `README.md`, `back/.env.example` | Mention `db:data`, `DEMO_PASSWORD` |

## Out of scope

- Video of any kind (clips, saves, whole-game files, thumbnails, Drive uploads).
- Recorder boxes and paired devices (they hold credentials and would raise offline alerts).
- Alerts: only open ones are shown anywhere (the dashboard), and the alert job resolves any whose
  problem isn't real — and tells staff. Resolved history isn't shown, so it isn't seeded.
- Live or upcoming games: these would move to Recording and wait for a box that doesn't exist.

## Risks

- It deletes real data in whatever `DB_DATABASE` points at: it refuses `NODE_ENV=production`, names
  the database it empties, and is documented as destructive in the README, `back/CLAUDE.md` and
  `.env.example`.
- Seeding fails after the truncate: the database is left empty; the error says to run it again.

## Open questions

- [ ] —

## Revisions

- 2026-11-23: Created.
- 2026-11-23: Built. Alert history dropped (nothing shows resolved alerts, and open ones would be
  resolved and announced by the job). Upcoming bookings are marked as reminded instead of only
  warning, because the dev `.env` has SendGrid set. Checked on a throwaway database: seed, a second
  run stops, `--reset` twice, the booking/clip/alert jobs change nothing, no court overlaps,
  booking payments match prices; Admin and public GET endpoints answer 200 as a demo manager.
- 2026-11-23: Changed at the user's request: `db:data` now empties the database (keeping
  `_migrations`, `permissions` and the Owner) before seeding, instead of adding beside existing data;
  `--reset` is gone. Checked on a throwaway database with extra staff, tokens and keys: two runs in a
  row leave only the Owner, the permissions and the same demo.
