# PLAN-009 · Player app (`web-app/`): a pickleball community app — Checklist

> Tick items as they land. Plan: [plan.md](plan.md). Each phase ships alone, with its own
> changelog entry.

## Phase A: player app at parity

### Backend

- [x] `PLAYER_APP_URL` (fallback `APP_URL`) in `signedInUrl()` (`utils/googleSignIn.js`),
      `bookingManageUrl()` (`utils/clips.js`) and the Xendit `success_redirect_url`
- [x] Player app origin added through `ALLOWED_ORIGINS`; `PLAYER_APP_URL` documented in `back/.env.example`
- [x] Test: with `PLAYER_APP_URL` set, the sign-in return, email booking link and invoice return use it

### Player app

- [x] `web-app/package.json` named, `.env.example` (`VITE_API_URL`, `VITE_STORE_KEY`, app name), dev port `4022`
- [x] Template staff pages removed (Admin, UserManagement, AuditTrail, staff Login, Auth reset pages)
- [x] Player auth store (`Player <token>`, refresh rotation, logout), player axios instance, `requests/` + query keys
- [x] Tab shell (Discover, Play, Profile; Clubs comes in Phase F) — bottom bar on phones, top links from tablets up; `/` opens Discover
- [x] Ported: Venues (`/book`, Near me, directions), Book (`/book/:bookingToken` court grid, order, pay)
- [x] Ported: Booking (`/booking/:manageToken` pay, check in, cancel, move), My games, Profile + complete profile, `/signed-in`
- [x] `web-app/CLAUDE.md`, `frontend-conventions` skill scope, root `CLAUDE.md` layout row, `publish` bumps `web-app/package.json`

### `front/`

- [x] Player routes redirect to `VITE_PLAYER_APP_URL` (path and query kept) when it's set

### Wrap-up

- [x] `cd back && npm run lint && npm test` passes
- [x] `cd front && npm run lint && npm run build` and `cd web-app && npm run lint && npm run build` pass
- [ ] Tried in the browser (checked so far without one: the app is served, every page compiles, venues / booking page / Google sign-in start answer through the proxy): sign in with Google in `web-app/` → book two courts → pay (sandbox) → open the booking from the email → check in
- [x] Changelog entry (`ref: PLAN-009`, Phase A)

## Phase B: sport profile, follows, Book again

### Backend

- [x] Migration: `player_sports`, `venue_follows`, `courts.surface` + `courts.isIndoor`, `venues.amenities` (049)
- [x] `GET/PUT /player/sports` (level ENUM, DUPR ID + rating, shown unverified)
- [x] `GET/POST/DELETE /player/follows/:venueKey`, `GET /player/recent-venues`
- [x] `/public/venues`: each venue's key, amenities, surfaces, indoor / outdoor court counts and followers (no business IDs) — the filters run in the browser, like Near me
- [x] Admin venue and court validators and controllers accept surface, indoor and amenities
- [x] Tests: follows are per player, deleted venue 404, filters, another company's venue untouched

### Frontend

- [x] `front/` Admin: court form surface + indoor, venue form amenities
- [x] `web-app/`: Profile sport card (level, DUPR), follow button, Following + Book again on Play, Discover filters

### Wrap-up

- [x] Lint, tests (566) and both builds pass; migration 049 applied to the dev database
- [x] Demo data: surfaces, indoor flags and amenities for every demo venue (seed checked on a scratch database)
- [ ] Tried in the browser: set level and DUPR → follow a venue → filter Discover by indoor → Book again
- [x] Changelog entry (`ref: PLAN-009`, Phase B)

## Phase C: Open Play sessions

### Backend

- [x] Payments: `utils/playPayments.js` (checkout, settle) on the shared `bookingPayments.js` pieces — `settleInvoice()` routes `play-` invoices, `sendRefunds()` / refund events update spots, `accountForCheckout()` knows spots (booking tests still pass)
- [x] Migration 050: `play_sessions` (`kind` OpenPlay/Clinic), `play_session_courts`, `play_series` + `play_series_courts`, `play_signups`, `court_closures.playSessionId`, `payments.playSignupId`, `open_play` permission (Owner granted; demo roles too)
- [x] A session's courts are taken through closure rows tied to it (`findConflict()` → `OPEN_PLAY`, `ignorePlaySessionId` when moving); create / move lock court rows `FOR UPDATE` (sorted); booking refuses session time; Closures never list or change them
- [x] Admin `/admin/play-sessions` CRUD + series, sign-ups list, add walk-in (Free), check in, cancel and refund (`payments` write), company-scoped
- [x] `jobs/playSessionSeries.js` makes the next 4 weeks; editing a series changes future sessions only
- [x] `GET /public/play-sessions` (near, date, level) and `/:key` (first names + levels only)
- [x] `POST /player/play-sessions/:key/signups` (locks session, capacity, Xendit invoice or free), `POST /player/play-signups/:id/cancel` (cut-off, refund after commit)
- [x] Unpaid `Pending` spots released by `bookingMaintenance`; webhook settles a signup only for its company
- [x] Emails: confirmed, reminder 2 h before, cancelled (claimed on `…SentAt`)
- [x] Tests: capacity race, court conflict both ways, Deleted session 404, another company 404, wrong-company webhook, refund on cancel

### Frontend

- [x] `front/` Admin → Open Play list + Sheet form (with repeat), session detail (sign-ups, walk-in, check in)
- [x] `web-app/` Discover → Open Play list (date chips, level), session page, join + pay, cancel, on the Play tab

### Wrap-up

- [x] Lint, tests (586) and both builds pass; migration 050 applied to the dev database
- [x] Demo data: a weekly series and one-off sessions with walk-ins (`npm run db:data`, checked on a scratch database)
- [x] Admin Payments lists Open Play payments (kind Open Play; refunds through the spot)
- [ ] Tried in the browser: staff make a weekly session → player joins and pays → the court is not bookable then → player cancels and is refunded
- [x] Changelog entry (`ref: PLAN-009`, Phase C)

## Phase D: Open Play queue and TV

### Backend

- [x] Migration 051: `play_games`, `play_game_players`, signup `queueEnteredAt` + `isResting`, session `queuePaused`
- [x] `utils/openPlayQueue.js`: longest-waiting four, level-balanced teams, fewest repeat partners, reason text; unit tests
- [x] Admin queue endpoints: state, next game, start on court, end + score, pause / pause after, rest, manual swap; session row `FOR UPDATE`; audited
- [x] `GET /player/play-signups/:id/queue` (my place, my next court)
- [x] Board: a Queue view for a live session (first names only)
- [x] Finished games in the player's Open Play history (`/player/play/signups?when=past` → games with partner, opponents, score)
- [x] Tests: two screens can't start the same game, ended game frees the court for the next, Deleted session 404

### Frontend

- [x] `front/` Admin → Open Play → session → Queue (tablet layout: waiting line, next games, courts)
- [x] `front/` TV board Queue view
- [x] `web-app/` Play tab: place in line, next court (10 s poll); history shows scores

### Wrap-up

- [x] Lint, tests (600) and both builds pass; migration 051 applied to the dev database
- [ ] Tried in the browser: 9 check-ins on 2 courts → auto-fill both → end a game with a score → next game takes the court, TV updates
- [x] Changelog entry (`ref: PLAN-009`, Phase D)

## Phase E: tournaments

### Backend

- [x] Migration 052: `tournaments`, `tournament_courts`, `tournament_divisions`, `tournament_teams`, `tournament_team_players`, `tournament_matches`, `court_closures.tournamentId` (the court hold), `payments.tournamentTeamId`, `tournaments` permission
- [x] `utils/tournamentBrackets.js`: round robin, group standings, seeded knockout with byes, group → knockout; unit tests
- [x] The court hold: closures tied to the tournament for each day (`findConflict()` → `TOURNAMENT`, `ignoreTournamentId` when re-held); hidden from Closures
- [x] Admin `/admin/tournaments` CRUD, divisions, teams (withdraw, refund), generate draw (locks division), schedule (court + time), scores (winner advances); company-scoped, audited
- [x] `GET /public/tournaments`, `/:key` (divisions, bracket, standings, schedule; no business IDs)
- [x] `POST /player/tournaments/:key/teams` (captain pays), `POST /player/team-invites/:token` (partner joins); `Registered` when paid and full
- [x] Board: a Tournament view (on court, up next, results)
- [x] Emails: registered, draw out, match called
- [x] Tests: capacity, invite single-use, draw locks registration, score advances bracket, Deleted tournament 404, another company 404

### Frontend

- [x] `front/` Admin → Tournaments list + form, divisions, teams, draw, match schedule + score entry
- [x] `front/` TV board Tournament view
- [x] `web-app/` Discover → Events, tournament page (bracket, standings, schedule), register + pay, invite partner, my matches on Play

### Wrap-up

- [x] Lint, tests (618) and both builds pass; migration 052 applied to the dev database
- [x] Demo data: an open tournament with two divisions and staff-added teams; demo roles get the permission
- [x] Admin Payments lists tournament entries (kind Tournament; refunds by withdrawing the team)
- [ ] Tried in the browser: 8 teams in a round robin → knockout division → generate draw → score every match → winner shown on page and TV
- [x] Changelog entry (`ref: PLAN-009`, Phase E)

## Phase F: clubs and coaching

### Backend

- [x] Migration 053: `clubs`, `club_members`, `play_sessions.clubId` + `coachName`, `play_series.clubId` + `coachName`, `clubs` permission
- [x] Admin `/admin/clubs` CRUD, members (approve, take out, make admin) — no club photo yet (see Revisions)
- [x] `GET /public/clubs`, `/:key`; `POST /player/clubs/:key/join`, `/leave`
- [x] Members-only sessions refuse non-members' sign-ups
- [x] Clinics: `kind = 'Clinic'` sessions with coach name, no queue; `GET /public/play-sessions?kind=Clinic`
- [x] Tests: approval flow, members-only refusal, Deleted club 404, another company 404

### Frontend

- [x] `front/` Admin → Clubs list + form, members; Open Play form gets Club + Clinic (coach name)
- [x] `web-app/` Clubs tab (my clubs, find clubs, club page), Discover → Coaching

### Wrap-up

- [x] Lint, tests (625) and both builds pass; migration 053 applied to the dev database
- [x] Demo data: two clubs, a members-only session and a clinic; demo roles get the permission
- [ ] Tried in the browser: player asks to join an Approval club → staff approve → player joins a members-only session; player books a clinic
- [x] Changelog entry (`ref: PLAN-009`, Phase F)
## Design change: sidebar navigation

- [x] `web-app/`: a left sidebar from tablets up (Discover's four lists, Play, Clubs, Profile; account + theme at the bottom); no top nav there
- [x] Phones keep the slim top bar, Discover's segmented tabs and the bottom tab bar
- [x] A top bar from tablets up: fold the sidebar to an icon rail (remembered) and the page's place ("Discover / Courts")
- [x] Lint and build pass; changelog entry updated

- [ ] `plan.md` status set to `Done`
