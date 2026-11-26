# PLAN-009 · Player community on mobile: open plays, communities, following venues

> **Status:** In progress · **Created:** 2026-11-26 · **Owner:** bryanken00 · **Checklist:** [checklist.md](checklist.md)
> **Related:** [PLAN-006](../PLAN-006-player-google-sign-in/plan.md) (players, Google sign-in, game log), [PLAN-003](../PLAN-003-court-booking/plan.md) (booking, timeline), [PLAN-008](../PLAN-008-multi-company-saas/plan.md) (companies, each company's Xendit), [CR-050](../../change-requests/CR-050-venue-address-map/request.md) (venue pins, Near me), [PLAN-002](../PLAN-002-setup-menu-device-pairing/plan.md) (the app as a session device)

## Goal

Players get a **DGSports mobile app** that is more than booking. They can:

- find and **join open plays** at venues near them;
- **follow venues** and hear about their new open plays and announcements;
- **join communities** (a venue's or a club's) and see their posts and games;
- **find players**: see who's playing, and open the spare spots of their own booking to others.

Venue companies run their open plays and communities from Admin. Throughout, the **recorded game
videos** (this product's difference) show up in the community: a game's players, its highlights,
and "shared to the community".

## Context

**What Sports360 offers** (its App Store listing, Philippines, 2026-11): book courts and **open
plays**, reserve **coaching sessions**, pay by e-wallet, **connect with sports communities**,
**follow favourite venues / branches**, venue maps and nearest-venue search. Reclub, Playo and
Play Player add finding players and group chats.

**What DGSports already has:**

- **Players:** Google sign-in on the web, a profile, and a game log (PLAN-006: `players`,
  `/api/v1/player/*`, `utils/players.js`).
- **Booking:** tap hours on any courts and pay online into the company's own Xendit (PLAN-003,
  CR-047, PLAN-008 phase C); one court timeline for games, bookings and closures
  (`utils/courtTimeline.js`).
- **Venues:** each belongs to a company (PLAN-008), with an address, a pin and "Near me" (CR-050).
- **Games:** recorded games and saved highlights, delivered to the player's Google Drive (CR-040).

**What's missing:**

- **The mobile app is only a courtside session device:** Pair, Session, Ended
  ([app/src/screens](../../../app/src/screens)), branded Dyna Cam, with no sign-in.
- **Players can't do anything social:** no open plays, no communities, no following, and no way
  to find other players.

## Approach

### The app (recommended — see Open questions)

**One DGSports app, built from today's `app/`:**

- **First launch:** "I'm a player" (the new player app, the default) or "Set up a courtside
  device" (today's Pair → Session flow, unchanged and kept on that device).
- **Sign-in:** players sign in with Google in the in-app browser (`expo-web-browser`) against the
  existing `/api/v1/auth/google/*` with `?app=1` and a PKCE-style challenge; the callback sends
  the app to `dgsports://signed-in?code=…`, and the code redeems only with the app's verifier
  (migration `049_app_sign_in.sql`). Tokens use the existing player audience and are kept in
  `expo-secure-store`.
- **Player tabs:**
  - **Home:** open plays near me, and what the venues and communities I follow posted.
  - **Book:** the venue list with Near me, then a venue's courts and hours. These are native
    screens on the existing public booking API, with Xendit checkout in an in-app browser.
  - **Open plays.**
  - **Communities.**
  - **Me:** profile, my games and videos, bookings, following.
- **Rebrand:** DGSports (CR-036 brand). The store IDs stay `com.dgsi.dynacam`, so existing
  installs update in place; a device paired before the update stays a courtside device. A new
  store build is needed, since native modules (web browser, crypto, location, later
  notifications) can't reach existing installs.
- **Phase A ships in two slices:** A1 — the app's two modes, sign-in, the tabs, Book as the venue
  list with Near me and directions (Book opens the venue's web booking page in the in-app
  browser), Me with My games; A2 — native booking screens (courts, hours, pay) on the public
  booking API.

### Open plays (phase B)

- **Staff create them in Admin**, scoped to the company (PLAN-008):
  - venue, court(s), start / end;
  - title, level (e.g. beginner / intermediate / advanced, or a rating range);
  - capacity, price per player, and a cut-off.
- **The open play reserves its courts** on the court timeline (`findConflict` gets a new
  `OPEN_PLAY` kind), so nobody books over it.
- **Joining:** players join from the app and pay online into the venue's company Xendit, one
  payment row per player, reusing `utils/bookingPayments.js`'s order / settle / refund.
  - When it's full, players join a **waitlist** and are promoted when someone cancels before the
    cut-off.
  - Cancelling before the cut-off refunds the player.
- **Who's going:** players see who has joined (name and photo), unless a player hides themselves.
- **At the venue,** staff see the player list and can mark no-shows. The courts are recorded like
  any game, and the joined players find the video in My games.

### Following venues and push notifications (phase C)

- **Follow:** players follow venues, from the venue page or Near me.
- **Push notifications** (`expo-notifications`; push tokens per player device). Followers hear
  about:
  - a new open play at a followed venue;
  - a venue announcement;
  - "your open play starts in 1 hour";
  - a waitlist spot opening.
- **Admin:** announcements per venue (title, text, optional image).

### Communities (phase D)

- **Who runs them (decided):** two kinds.
  - **Venue communities** belong to a company (e.g. "Smash Point BGC Regulars"), managed from
    Admin by staff.
  - **Player clubs** can be started by any player (e.g. "QC Morning Dinkers"). The founder and the
    admins they pick run them. A club can name a home venue, but no company owns it.
- **Members** join (open or by approval), and see:
  - the community's posts (staff and members; text and photos);
  - its open plays;
  - its members.
- **Highlights:** members can share a saved highlight from their game to the community. The
  video link stays the player's Drive link (CR-040: no video in the cloud).
- **Moderation:**
  - staff moderate their venue communities; a club's admins moderate their club;
  - members can report a post or a club;
  - DGSports super admins get a **Reports** page in the back office (PLAN-008) to hide posts,
    suspend a club, or block a player. A club has no company, so DGSports is its final
    moderator.

### Players and finding players (phase E)

- **Profile:** a public profile with name and photo (from Google), a self-rated skill level, a
  home venue, the communities joined, and games played (count only).
- **Open spots:** a booking's owner can open its spare spots, for example "2 spots open, ₱150
  each".
  - Others request a spot, the owner accepts, and the joiner pays their share online.
  - The joiners also get the game video, because they're on the booking.

### Coaching (phase F, optional)

- Coaches as staff of a company. Bookable coaching sessions on the court timeline, like open plays
  with a coach and capacity 1 to n.

### Data (migrations as each phase lands)

| Table | For |
| --- | --- |
| `open_plays` | openPlayId, venueId, courts, startAt / endAt, title, level, capacity, price, cut-off, status |
| `open_play_players` | who joined: Joined / Waitlisted / Cancelled / NoShow, plus the payment |
| `venue_follows` | playerId, venueId |
| `player_devices` | Expo push tokens per player device |
| `venue_announcements` | venueId, title, body, image, author |
| `communities` | kind (Venue / Club), companyId (venue communities) or founder playerId (clubs), homeVenueId?, name, description, join rule, status |
| `community_members` | playerId, role, status |
| `community_posts` | author (staff or player), text, image, shared highlight, status |
| `community_reports` | what was reported (post / club / player), by whom, why, outcome (back office) |
| `booking_spots` | open spots on a booking: requests, accepted, payments |
| `players` columns | `skillLevel`, `homeVenueId`, `bio`, `profileVisibility` |

### Alternatives considered

- **A separate player app (a second Expo project):** this keeps the courtside device untouched,
  but means two store listings, two codebases and two builds. One app with a first-launch choice
  is simpler for venues and players.
- **A mobile web app (PWA) only:** no store review, and the player pages are already responsive.
  But push notifications on iPhone are limited, and the experience is weaker. It could still be
  phase A's quick start (see Open questions).
- **Chat between players:** moderation-heavy and needs real-time infrastructure. Communities with
  posts cover the need first.

## Affected areas

| Area | Files / tables | Change |
| --- | --- | --- |
| Database | new migrations per phase (tables above) | open plays, follows, devices, announcements, communities, spots |
| API — player | `controllers/v1/player/*`, `/public/*` | open plays (list near me, join / leave / pay), follow, communities, posts, profile, spots, push token |
| API — admin | `controllers/v1/admin/*` | open plays, announcements, communities and moderation — company-scoped (PLAN-008) |
| Timeline / payments | `utils/courtTimeline.js`, `utils/bookingPayments.js` | open plays block court time; per-player payments and refunds |
| Jobs | `jobs/*` | reminders, waitlist promotion, push sending (Expo push API) |
| Web — Admin | `front/src/pages/Admin/…` | Open plays, Announcements, Communities pages (+ permissions) |
| Mobile | `app/` | first-launch choice, Google sign-in, player tabs, push, location; DGSports brand; new store build |
| Permissions | new `openplays`, `community` modules | seeded and granted to Owners (`_owner-permissions.js`) |

## Out of scope

- Direct messages and group chat between players.
- Leagues, tournaments, brackets and ratings systems like DUPR (a self-rated level only).
- Coaching (phase F) until phases A–E land.
- Payments between players outside the app.

## Risks

- **App store review and a native rebuild:**
  - push notifications, location and sign-in need store builds;
  - the courtside device mode must keep working after the update;
  - test both modes on Android and iOS.
- **Moderation and privacy:**
  - public profiles and posts carry personal data and abuse risk;
  - mitigations: hide-from-others settings, report and hide, staff moderation, and no phone
    numbers shown.
- **Money:**
  - open plays and shared spots split payments across players;
  - reuse the order / settle / refund code, and test refunds and waitlist promotion carefully.
- **Scope:** this is XL. Ship by phase, each usable on its own: A then B gives the core value.

## Open questions

Answered 2026-11-26 by bryanken00:

- [x] **The app's shape:** one DGSports app with a first-launch choice (player / courtside device).
- [x] **Phase order:** app foundation (A) → open plays (B) first; then follow + push, communities,
      finding players, coaching.
- [x] **Who creates communities:** venue staff **and players** (player clubs), with club admins,
      reports and a back-office Reports page.
- [x] **Open play payments:** online only (CR-046).

Still open:
- [ ] **Skill levels:** a simple level (Beginner / Intermediate / Advanced / Pro) or a numeric
      rating (2.0–5.0, DUPR-style self-rated)? *(Recommended: the numeric self-rating.)*
- [ ] **Shared highlights:** show the Drive link only, or a preview? *(Recommended: Drive link +
      thumbnail; no video stored in the cloud — CR-040.)*

## Revisions

- 2026-11-26: Created.
- 2026-11-26: Decisions — one DGSports app; A then B first; player clubs too (moderation via club
  admins, reports and a back-office Reports page); open plays paid online only.
- 2026-11-26: Approved by bryanken00 ("you can restructure it from the start"). Phase A split into
  A1 / A2; sign-in uses the in-app browser + a PKCE-style verifier instead of
  `expo-auth-session`; `/public/venues` also returns each venue's `bookingUrl`. A1 built: device
  screens moved under `Screens/Device`, new Welcome / Player screens, two navigators.
