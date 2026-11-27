# PLAN-009 · Player app (`web-app/`): a pickleball community app on the DGSports API

> **Status:** In progress · **Created:** 2026-11-27 · **Owner:** bryanken00 · **Checklist:** [checklist.md](checklist.md)
> **Related:** [PLAN-003](../PLAN-003-court-booking/plan.md) (booking, Xendit), [PLAN-006](../PLAN-006-player-google-sign-in/plan.md) (players), [PLAN-007](../PLAN-007-booking-orders/plan.md) (orders), [PLAN-008](../PLAN-008-multi-company-saas/plan.md) (companies), [CR-030](../../change-requests/CR-030-player-booking-entry/request.md) (`/book`), [CR-038](../../change-requests/CR-038-bookings-tv-display/request.md) (TV board), [CR-050](../../change-requests/CR-050-venue-address-map/request.md) (Near me)

## Goal

Players get their own app, **`web-app/`**, served on its own domain. In it they can find a
pickleball venue, book a court, join **Open Play**, play in **tournaments**, join **clubs**, sign
up for **coaching**, and keep a **profile** with their skill level and history. Venues run all of
this from the Admin portal they use today, and the court TV shows the open-play queue and live
matches. Pickleball comes first; other sports come later.

## Reference: Sports360

We're using [Sports360](https://sports360.ph) (app.sports360.ph, by GO8 Technology) as a
**feature reference**. This plan copies what the product does, not how it looks: no Sports360
name, logo, screenshots, copy or layouts. The app keeps the DGSports "Modern" design system.

What we know about Sports360 comes from its marketing site. The web app returned 403 to an
automated fetch, so its real booking flow, sign-in methods and refund rules are unconfirmed.

| Sports360 feature | DGSports today | This plan |
| --- | --- | --- |
| Find venues near you, filter by sport, surface, amenities | `/book` directory with Near me (CR-030, CR-050), no sport, surface or amenity data | Phase A: same list in `web-app/`. Phase B: surface, indoor/outdoor and amenity filters |
| Book a court, instant confirmation, cashless payment | Done: hourly grid, multi-court orders, Xendit per company (PLAN-003/007/008) | Phase A: moved into `web-app/` as is |
| Player account | Google sign-in, profile (name, phone), My games (PLAN-006) | Phase A moves it; Phase B adds the sport profile |
| Skill level, DUPR, match history, follow venues, Book again | — | **Phase B** |
| Open Play sessions (per-head fee, level, slots, recurring) | — | **Phase C** |
| Open Play queue (auto-balance, check-in, walk-ins, court auto-fill, TV) | — | **Phase D** |
| Tournaments (divisions, team sign-up, round robin / knockout, live results, TV) | — | **Phase E** |
| Clubs / communities, coaching sessions | — | **Phase F** |
| Venue dashboard, schedule grid, utilisation | Admin Dashboard + Bookings grid | Each phase adds its own pages to Admin; no separate dashboard |
| POS, equipment rental, shop, chat, giveaways | — | Out of scope |
| Court cameras and game videos | **DGSports-only** (PLAN-001, CR-040) | Open Play games and tournament matches can be recorded later (Open questions) |

## Context

- **`web-app/`** (committed `a5294c8`) is a bare copy of the front-end template: the template's
  Admin, Auth and LandingPage pages, shared components and the PH address list. It has no booking
  code yet, and its `package.json` is still named `frontend-template`.
- **The player pages today live in `front/`**, alongside Admin and the back office:
  [`front/src/pages/Public/`](../../../front/src/pages/Public/) has `Venues` (`/book`), `Book`
  (`/book/:bookingToken`), `Booking` (`/booking/:manageToken`), `MyGames`, `Profile`, `SignedIn`,
  plus the game, clip, stream, payment-sandbox and TV board pages.
- **The API already has a player surface** that `web-app/` can use unchanged:
  - `/api/v1/auth/google/start|callback` (sign-in)
  - `/api/v1/player/session|session/refresh|session/logout|me|games`
    ([player.controller.js](../../../back/server/src/controllers/v1/player/player.controller.js),
    `Authorization: Player <token>`)
  - `/api/v1/public/venues`, `/public/book/:bookingToken[/availability|/bookings]` and
    `/public/bookings/:manageToken[/cancel|/move-options|/move|/pay|/check-in]`
    ([booking.controller.js](../../../back/server/src/controllers/v1/public/booking.controller.js))
- **Every link the API builds points at `front/`'s `APP_URL`.** That covers the Google sign-in
  return (`signedInUrl()` in
  [googleSignIn.js](../../../back/server/src/utils/googleSignIn.js)), booking links in emails
  (`bookingManageUrl()` in [clips.js](../../../back/server/src/utils/clips.js)) and the Xendit
  `success_redirect_url` ([xendit.js](../../../back/server/src/lib/payments/xendit.js)). CORS
  reads `FRONTEND_URL` + `ALLOWED_ORIGINS`
  ([config/express.js](../../../back/server/config/express.js)).
- **Data that's missing:**
  - `players` has names, phone and photo, but no sport, level or rating.
  - `courts` has no surface or indoor/outdoor flag, and venues have no amenities.
  - Nothing models a per-head session, a queue, a tournament or a club.
  - `payments` is keyed to `clipId` / `sessionId` / `bookingId` (one nullable FK each). New things
    people pay for need their own key.
- **Court time is one timeline.** [courtTimeline.js](../../../back/server/src/utils/courtTimeline.js)
  `findConflict()` covers games, bookings, holds, closures and opening hours. Any writer locks the
  court row `FOR UPDATE` first. Open Play sessions and tournament court blocks must join that rule,
  or a court gets booked under them.

## Approach

### Shape

- **`web-app/` is the player app only.** It has no staff login: the template's Admin,
  UserManagement and AuditTrail pages are removed. Staff keep working in `front/` Admin, which
  gets the new venue-side pages (Open Play, Queue, Tournaments, Clubs, Coaching).
- **The design is mobile-first** with a bottom tab bar: **Discover** (venues, sessions, events),
  **Play** (my upcoming bookings, sessions and matches), **Clubs**, **Profile**. It works on a
  desktop browser too. It uses the same "Modern" tokens, shadcn/ui and lucide as `front/`.
- **It follows `frontend-conventions`.** The skill and `web-app/CLAUDE.md` are widened to cover
  `web-app/src`, and the root `CLAUDE.md` layout table gets a `web-app/` row. `web-app` joins the
  one product version: `/publish` bumps its `package.json` with the others.
- **One API, one database.** Everything new goes in `back/`. Player endpoints go under
  `/api/v1/player/*` (signed in) and `/api/v1/public/*` (open to anyone, read-only lists). Venue
  endpoints go under `/api/v1/admin/*`, company-scoped as in PLAN-008. Players stay global across
  companies.
- **Links go to the player app.**
  - A new `PLAYER_APP_URL` env var sets where player links go: sign-in return, booking links in
    emails, Xendit return, and the new invite and session links.
  - `utils/clips.js` and `googleSignIn.js` read `PLAYER_APP_URL || APP_URL`, so nothing changes
    until it's set.
  - `ALLOWED_ORIGINS` gets the player app's origin.
  - Dev ports: front `4020`, API `4021`, web-app `4022`.
- **`front/` hands players over.** Once Phase A reaches parity and `PLAYER_APP_URL` is set,
  `front/`'s player routes (`/book…`, `/booking/:manageToken`, `/my-games`, `/profile`,
  `/signed-in`) redirect there, path and query kept, so old emails and QR signs still work. A
  follow-up CR deletes them. The game, clip, stream, payment-sandbox and TV board pages stay in
  `front/` for now.
- **One way to pay.** Open Play spots, coaching spots and tournament entries are paid like
  bookings: a Xendit invoice on the venue's company account, believed only after reading the
  invoice back (`utils/bookingPayments.js`), with refunds sent after commit.
  - `payments` gets two new nullable keys, `playSignupId` and `tournamentTeamId`.
  - The payment code moves into a small helper both flows share, so the read-back and the
    `WRONG_COMPANY` check exist only once.

### Phase A: the player app, at parity

1. Set up `web-app/`:
   - Name it in `package.json`; set `VITE_STORE_KEY` and the app name from the Open question on
     the name.
   - Remove the template's staff pages.
   - Add the player auth store (`Player <token>`, refresh rotation, the same calls `front/` makes),
     a player axios instance and React Query client.
   - Add the bottom tab shell, and a landing page that sends signed-in players to Discover.
2. Port the player flows from `front/src/pages/Public/` against the same endpoints:
   - Venues (Near me, directions)
   - Book (court grid, multi-court order, pay)
   - Booking (pay, check in, cancel, move)
   - My games, Profile with complete-your-profile, Signed in
3. Backend changes:
   - `PLAYER_APP_URL` in the three link builders, and its origin in `ALLOWED_ORIGINS`.
   - An `.env.example` line and a test that the links follow it.
4. `front/` redirects its player routes once `PLAYER_APP_URL` is set.

### Phase B: player sport profile, follows, Book again

- **`player_sports`** (migration): `playerSportId`, `playerId`, `sport` ENUM(`'Pickleball'`),
  `skillLevel` ENUM(`'Beginner','Low Intermediate','Intermediate','High Intermediate','Advanced'`),
  `duprId` VARCHAR NULL, `duprRating` DECIMAL(4,3) NULL, `duprVerifiedAt` NULL, `status`,
  timestamps. One row per player per sport.
- **DUPR:** in this phase the player types their DUPR ID and rating, and it shows **unverified**.
  Real DUPR sync needs DUPR partner API access (Open questions).
- **`venue_follows`** (migration): `playerId`, `venueId`, unique pair.
- **Court and venue details** (migration):
  - `courts.surface` ENUM(`'Hard','Synthetic','Wood','Concrete','Other'`) NULL and
    `courts.isIndoor` TINYINT NULL, edited in Admin → Venues → Courts.
  - `venue_amenities` (`venueId`, `amenity` ENUM(`'Parking','Showers','Lockers','Restrooms','Food','Pro shop','Lights','Aircon'`)),
    edited in the venue form.
- **Endpoints:**
  - `GET/PUT /player/sports`
  - `GET/POST/DELETE /player/follows/:venueKey`
  - `GET /player/recent-venues` (from the player's bookings, for **Book again**)
  - `/public/venues` gains `surface`, `indoor` and `amenity` filters plus `followers`
- **Match history:** `/player/games` stays the game log. Phases D and E add Open Play games and
  tournament matches to it.

### Phase C: Open Play sessions (the listing and paying side)

- **`play_sessions`** (migration): `playSessionId`, `venueId`, `kind`
  ENUM(`'OpenPlay','Clinic'`) (Clinic is used in Phase F), `title`, `startAt`, `endAt`,
  `minLevel` / `maxLevel` (NULL = all levels), `capacity`, `pricePerHead` DECIMAL (0 = free),
  `hostAccountId` (staff) NULL, `coachName` NULL, `seriesId` NULL, `status`
  ENUM(`'Scheduled','Live','Ended','Cancelled','Deleted'`), timestamps.
- **`play_session_courts`**: the courts a session uses.
- **`play_session_series`**: a weekly repeat (days, times, until date). A nightly job,
  `jobs/playSessionSeries.js`, makes the next 4 weeks of sessions. Editing the series changes
  future sessions only.
- **`play_signups`**: `playSignupId`, `playSessionId`, `playerId` NULL, `walkInName` NULL,
  `status` ENUM(`'Pending','Confirmed','CheckedIn','Cancelled','Refunded'`), `holdExpiresAt`,
  `paidAt`, timestamps. Unique on (session, player) while live.
- **Courts:** a session's courts are blocked on the timeline, as a new source in
  `findConflict()`. Creating or moving a session locks each court row `FOR UPDATE` and refuses
  booked time. Booking refuses session time.
- **Capacity:** signing up locks the session row and counts `Confirmed` + unexpired `Pending`.
  When full, the player gets "Full" (a waitlist is an Open question). An unpaid `Pending` spot
  is released by the existing `bookingMaintenance` job, the same way booking holds are.
- **Player endpoints:**
  - `GET /public/play-sessions?near=&date=&level=`
  - `GET /public/play-sessions/:key`, showing who's going (first name + level only)
  - `POST /player/play-sessions/:key/signups`, which answers with a Xendit invoice or confirms a
    free spot
  - `POST /player/play-signups/:id/cancel`, which refunds before the venue's cut-off
    (`venues.bookingCancelHours` reused)
- **Admin:** a new **Open Play** page under the `open_play` permission (migration, Owner
  granted).
  - The list and Sheet form follow `modern-module-pattern.md`, with the repeat options in the
    form.
  - Session detail lists sign-ups, lets staff add a walk-in, and check people in.
  - Recording a walk-in's payment is not possible. Since CR-046 there's no cash, so a walk-in is
    added as Free.
- **Emails:** confirmation, reminder 2 h before, and cancellation, through `bookingEmails.js`'s
  pattern (claimed on `…SentAt`).

### Phase D: the Open Play queue and TV

- **`play_games`**: `playGameId`, `playSessionId`, `courtId` NULL, `status`
  ENUM(`'Queued','Playing','Done','Void'`), `queuedAt`, `startedAt`, `endedAt`, `scoreA`,
  `scoreB`.
- **`play_game_players`**: `playGameId`, `playSignupId`, `team` ENUM(`'A','B'`).
- **Queue state per signup:** `queueEnteredAt`, `isResting`, and `gamesPlayed` (derived).
- **The queue runner is a staff screen in Admin → Open Play → session → Queue.** It's built for a
  tablet at the court.
  - It shows a **Waiting line** in queue order, the **Next games**, and each court's **Playing**
    card.
  - When a court's game ends (enter the score, or just End), the next queued game takes that
    court.
  - Pause, and "pause after this game".
  - Rest a player, or bring them back.
  - Staff can swap players by hand.
- **Auto-balance** is a pure, tested function in `utils/openPlayQueue.js`.
  - It always takes the four who have **waited longest**.
  - It splits them so the teams' summed level (or DUPR, where every player has one) is closest.
  - It breaks ties by fewest repeat partners.
  - It returns a short "why these 4" reason that the screen shows.
  - It uses `FOR UPDATE` on the session row, so two staff screens can't both start the same game.
- **TV:** the venue's board (`/board/:displayToken`, CR-038) gains a **Queue** view for a live
  session: courts with first names on court, the next 2 games and the waiting count. It still
  shows no surnames, codes or IDs.
- **Players see the queue:** players see their place in line and their next court in `web-app/`
  (Play tab). They poll every 10 s; there's no socket in this phase.
- **History:** a finished game, with its score, goes into each player's match history.

### Phase E: tournaments

- **`tournaments`**: `tournamentId`, `venueId`, `name`, `startDate`, `endDate`,
  `registrationClosesAt`, `description`, `status`
  ENUM(`'Draft','Open','Closed','Live','Finished','Cancelled','Deleted'`).
- **`tournament_divisions`**:
  - Basics: `name` (e.g. "Mixed Doubles 3.5"), `teamSize` (1 or 2), `minLevel` / `maxLevel`,
    `capacity` (teams), `entryFee` (per team).
  - Format: `format` ENUM(`'RoundRobin','SingleElimination','RoundRobinThenKnockout'`),
    `groupSize`, `advancePerGroup`, `pointsToWin`, `winBy`.
- **`tournament_teams`**: `tournamentTeamId`, `divisionId`, `captainPlayerId`, `name`,
  `inviteToken` (the partner joins by link), `status`
  ENUM(`'Pending','Registered','Withdrawn','Refunded'`), `seed` NULL.
  **`tournament_team_players`** holds the team's players.
  - The captain pays the team entry by Xendit.
  - The team counts as `Registered` once paid **and** full.
- **`tournament_matches`**: `matchId`, `divisionId`, `stage` (`'Group','Knockout'`), `groupNo`,
  `round`, `slot`, `teamAId` / `teamBId` NULL (bye or not yet decided), `nextMatchId` + `nextSlot`
  (for the bracket), `courtId` NULL, `scheduledAt`, `status`, `games` JSON (scores per game),
  `winnerTeamId`.
- **`tournament_court_blocks`**: the courts and times the tournament holds on the timeline, a
  `findConflict()` source.
- **Bracket logic** lives in `utils/tournamentBrackets.js`. It's pure and unit-tested:
  - round-robin pairing (circle method)
  - group standings (wins, then point difference, then head-to-head)
  - a seeded single-elimination tree with byes
  - group-to-knockout advancement
- **Admin, under the `tournaments` permission:**
  - Tournament list and form, divisions, and a teams list (withdraw, refund).
  - **Generate draw** locks the division, so there are no new teams after that.
  - Match schedule: assign court and time, enter scores, and the winner advances automatically.
- **Player side:**
  - `GET /public/tournaments`, and `GET /public/tournaments/:key`, which shows divisions, the
    bracket, standings and the schedule.
  - `POST /player/tournaments/:key/teams` registers and pays; `POST /player/team-invites/:token`
    lets a partner join.
  - My matches appear on the Play tab.
- **TV:** a **Tournament** view on the board shows matches now on court, up next, and results.
  Players see live results by polling.
- **Notifications:** email when the team registers, when the draw is out, and "your match is
  next" (when staff call it).

### Phase F: clubs and coaching

- **Clubs belong to a venue** (staff create them in Admin under the `clubs` permission) in this
  phase; player-created clubs are an Open question.
  - `clubs`: `clubId`, `venueId`, `name`, `description`, `photo` (upload, signed), `joinPolicy`
    ENUM(`'Open','Approval'`).
  - `club_members`: `playerId`, `role` ENUM(`'Member','Admin'`), `status`
    ENUM(`'Pending','Active','Removed'`).
- **Club pages:** a club's page lists its members (first name + level) and its sessions.
- **Members-only sessions:** a club can own Open Play sessions (`play_sessions.clubId` NULL) that
  only its members can join.
- **Coaching:** a **Clinic** is a `play_session` with `kind = 'Clinic'`, a `coachName`, and a
  short description. It has no queue. It reuses everything in Phase C: listing, sign-up, payment,
  check-in, emails. It's listed under **Coaching** on Discover.

### Permissions (new rows, each by migration; setup grants them to every Owner)

| module | submodule | Used by |
| --- | --- | --- |
| `open_play` | `null` | Admin → Open Play (sessions, sign-ups, queue), Clinics too |
| `tournaments` | `null` | Admin → Tournaments |
| `clubs` | `null` | Admin → Clubs |

Money actions in each (refund) also need `payments` write, as bookings do.

### Alternatives considered

- **Build the new player pages into `front/`.** This is less work and needs no URL or CORS
  changes. You chose `web-app/` so the player app has its own domain, look and pace. The cost is a
  parity port (Phase A) and the redirect period.
- **A separate backend for the player app.** This would mean two databases of venues, courts and
  players, with booking kept in sync between them. Rejected.
- **A standalone queue tool with no account,** like Sports360's Queue Master. It's not needed:
  the queue runs on a session the venue already owns, and walk-ins cover people without an
  account.
- **Real-time sockets for the queue and live results.** Polling (10 s) is enough at court scale
  and needs no new infrastructure. Socket.io can come later; `VITE_SOCKET_URL` already exists.
- **A separate table for clinics.** A clinic is an Open Play session without a queue, so it
  shares `play_sessions` (`kind`).

## Affected areas

| Area | Files / tables | Change |
| --- | --- | --- |
| Player app | `web-app/` | New player app: shell, auth, ported booking flows, then each phase's screens |
| Database | `back/database/migrations/049…` | `player_sports`, `venue_follows`, `courts.surface/isIndoor`, `venue_amenities`, `play_sessions`, `play_session_courts`, `play_session_series`, `play_signups`, `play_games`, `play_game_players`, `tournaments`, `tournament_divisions`, `tournament_teams`, `tournament_team_players`, `tournament_matches`, `tournament_court_blocks`, `clubs`, `club_members`, `payments.playSignupId/tournamentTeamId`, three permission rows |
| API, player | `back/server/src/controllers/v1/player/`, `…/public/` | Sports profile, follows, sessions, sign-ups, queue view, tournaments, teams, clubs |
| API, admin | `back/server/src/controllers/v1/admin/` | Open Play, queue, tournaments, clubs (company-scoped) |
| API, shared | `utils/courtTimeline.js`, `utils/bookingPayments.js`, `utils/bookingEmails.js`, `utils/clips.js`, `utils/googleSignIn.js`, `jobs/bookingMaintenance.js`, `config/express.js` | New timeline sources, shared online-payment helper, new emails, `PLAYER_APP_URL` |
| New utils | `utils/openPlayQueue.js`, `utils/tournamentBrackets.js`, `jobs/playSessionSeries.js` | Pure logic and the series job, unit-tested |
| Admin UI | `front/src/pages/Admin/DynaCam/…` (new Open Play, Tournaments, Clubs pages), Venues → Courts form | Venue-side pages; court surface and amenities |
| TV board | `front/src/pages/Public/Board/`, `controllers/v1/public/board.controller.js` | Queue and Tournament views |
| `front/` player routes | `front/src/routes/…` | Redirect to `PLAYER_APP_URL` (Phase A) |
| Docs and skills | root `CLAUDE.md`, `web-app/CLAUDE.md`, `frontend-conventions` skill, `publish` skill | `web-app/` row, conventions scope, version bump |
| Permissions | `open_play`, `tournaments`, `clubs` | New, Owner-granted |

## Out of scope

- Sports other than pickleball (the `sport` ENUMs start with one value), and tennis, padel or
  badminton scoring.
- POS, equipment rental and inventory, online shop, chat, giveaways, a feed, a wallet or credits,
  memberships and packages.
- The mobile app (`app/`) and native player apps; `web-app/` should work well as a saved
  home-screen web app.
- Push notifications and SMS (email only).
- Real DUPR sync (needs DUPR partner access; see Open questions).
- Recording Open Play games or tournament matches with the court cameras (see Open questions).
- Moving the game, clip, stream and TV board pages out of `front/`.

## Risks

- **Two copies of the player pages during the move:** keep `front/`'s pages frozen once Phase A
  starts, set `PLAYER_APP_URL` as soon as parity is reached, and delete the old pages in a
  follow-up CR.
- **Court double-booking across bookings, sessions and tournaments:** every new writer joins
  `findConflict()` and the court-row lock, with concurrency tests like the booking ones.
- **Paying for new things repeats subtle Xendit code:** move it into one shared helper first
  (Phase C, step 1) and keep the existing booking payment tests green.
- **Queue disputes at the court ("I was next"):** the order is strictly by time entered and shown
  on the TV, the "why these 4" reason is shown, and every manual change is in the audit trail.
- **Size:** six phases is several weeks of work. Each phase ships alone, with its own changelog
  entry. Phase A is useful by itself, and B–F can be reordered.
- **Copying a competitor too closely:** features only. No Sports360 name, branding, screenshots,
  text or page layouts.

## Open questions

- [ ] **Name and domain** of the player app (e.g. `play.dgsports.ph`)? Is it branded DGSports?
- [ ] **Order of phases** after A: is B → C → D → E → F right, or do tournaments come before
      Open Play?
- [ ] **DUPR:** do we apply for DUPR partner API access (verified ratings and match uploads), or
      stay with self-entered and unverified?
- [ ] **Open Play waitlist** when a session is full, with automatic promotion and a pay link?
- [ ] **Who runs the queue:** only staff with `open_play`, or also a player "host" named on the
      session?
- [ ] **Cut-off and refunds** for Open Play, clinics and tournament entries: reuse the venue's
      booking cut-off, or set one per session or tournament?
- [ ] **Convenience fee:** Sports360 adds one on top of the venue's rate. Do we add a DGSports fee
      to player payments?
- [ ] **Clubs:** venue-owned only, or can players create their own clubs?
- [ ] **Coaches:** a free-text name, or real coach accounts with their own pages and schedule?
- [ ] **Record games with the court cameras:** should Open Play games and tournament matches start
      recordings and land in the player's history with a Drive link?
- [ ] **`front/` player pages:** delete them right after the redirect, or keep them for a
      release?

## Revisions

- 2026-11-27: Created. You chose: player app in `web-app/` on the DGSports API; scope is
  Open Play + queue, player profile + levels, tournaments, clubs + coaching.
- 2026-11-27: Approved and started on branch `plan-009-player-app`. Phase A built: the app's name
  is DGSports for now (Open question on the name still stands). `front/` redirects with its own
  `VITE_PLAYER_APP_URL` (a build-time variable) rather than reading the API's `PLAYER_APP_URL`;
  the player app links to game pages with `VITE_MAIN_APP_URL`.
- 2026-11-27: Phase B built. Two changes from the approach above: a venue's amenities are a
  `venues.amenities` SET column, not a `venue_amenities` table (a fixed list, saved whole with the
  venue form, no soft-deleted rows); and Discover filters in the browser on the facts
  `/public/venues` now returns, the same way Near me sorts, so there are no `surface` / `indoor` /
  `amenity` query filters. Venues are named on player pages by `venueKey()`, a hash of the venue
  ID (`utils/venueFacts.js`).
- 2026-11-27: Phase C built. Changes from the approach above: a session blocks its courts with
  `court_closures` rows tied to it (`playSessionId`), not a new `findConflict()` source, so every
  reader of the timeline (availability, day grid, TV board) sees it without changes; the Closures
  API hides them. Editing a weekly series isn't offered: a series is saved, made 4 weeks ahead and
  can be stopped; each session is edited on its own. Cancelling a whole session needs `payments`
  write too (it refunds). Walk-ins are free. No waitlist yet (Open question stands). Player paths:
  `/open-play` (Discover → Open Play) and `/open-play/:playToken`; API `/player/play/*`.
- 2026-11-27: Phase D built. The queue lives in `utils/openPlayQueue.js` (pure: oldest four,
  closest teams on DUPR or level, new partners on a tie) and `utils/openPlayGames.js` (the
  session row locked for every action). A finished game's history is on the player's Open Play
  list (`/player/play/signups?when=past`), not merged into the booking game log. A walk-in joins
  the line once checked in. The TV board refreshes every 15 s while a session runs.
- 2026-11-27: Phase E built. The court hold is `court_closures` rows tied to the tournament (one
  per court per day, `dailyStart`–`dailyEnd`), like Open Play, instead of a `tournament_court_blocks`
  table. A match is one game (`scoreA` / `scoreB`, checked against the division's points-to-win and
  win-by), not a `games` JSON. Staff can add a team by names only (free, Registered). The partner
  joins at `/team-invite/:token`; the player app's tournaments are `/events` and `/events/:key`.
  A team in the draw can't be withdrawn (staff enter its matches instead).
- 2026-11-27: Phase F built. Clubs have no photo yet (the upload flow is staff-only; left for a
  CR). The Open Play form takes Type (Open Play / Clinic), Coach and Who can join (anyone, or one
  club's members); the options list each venue's clubs. Player app: a Clubs tab (`/clubs`,
  `/clubs/:key`) and Discover → Coaching (`/coaching`, the clinics). Every phase's code is in and
  tested (625 API tests); the plan stays In progress until each phase's "Tried in the browser"
  line is ticked.
- 2026-11-27: Design change (asked after Phase F): the player app's navigation moves from the top
  bar to a left sidebar from tablets up — brand, Discover (Courts, Open Play, Tournaments,
  Coaching), You (Play, Clubs, Profile), and the account and theme at the bottom. Discover's
  segmented tabs show on phones only; phones keep the slim top bar and the bottom tab bar.
- 2026-11-27: From tablets up, a top bar like the Admin portal's: a button that folds the sidebar
  to an icon rail (with tooltips; remembered in the browser) and where you are ("Discover /
  Courts").
