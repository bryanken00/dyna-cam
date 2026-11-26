# PLAN-006 · Player sign-in with Google

> **Status:** In progress · **Created:** 2026-11-26 · **Owner:** bryanken00 · **Checklist:** [checklist.md](checklist.md)
> **Related:** [PLAN-003](../PLAN-003-court-booking/plan.md) (court booking), [CR-030](../../change-requests/CR-030-player-booking-entry/request.md) (`/book`, Find my booking), [CR-040](../../change-requests/CR-040-videos-local-drive-only/request.md) (games on Google Drive), [CR-001](../../change-requests/CR-001-google-drive-per-court/request.md) (the Google Cloud client)

## Goal

Players sign in with their Google account. Once signed in they can book a court online and see a
log of their games (each booking, its games, and each game's Google Drive link). **Booking online
needs a sign-in**; staff booking at the desk doesn't change.

## Context

Players have no accounts today. Online booking
([booking.controller.js](../../../back/server/src/controllers/v1/public/booking.controller.js),
`POST /public/book/:bookingToken/bookings`) takes a typed name, email and phone
([bookings.validator.js](../../../back/server/src/validators/bookings.validator.js)
`publicBookingSchema`). It returns the booking's own link (`manageToken`), which is also emailed.
A player who loses it uses **Find my booking** (booking code plus the booking's phone or email).
Nothing ties a player's bookings or games together, and anyone can book under any name or email.

What already exists:
- **Staff sign-in:** JWT access and refresh tokens
  ([utils/jwt.js](../../../back/server/src/utils/jwt.js), `refresh_tokens`, passport with
  `ExtractJwt.fromAuthHeaderAsBearerToken()` and `audience = AUDIENCE` in
  [passport.jwt.config.js](../../../back/server/src/middlewares/passport.jwt.config.js)). The
  staff site sends `Authorization: Bearer …` from `authStore`
  ([axios.js:205](../../../front/src/services/api/axios.js#L205)).
- **A Google OAuth client and flow** for courts' Drive
  ([utils/googleDrive.js](../../../back/server/src/utils/googleDrive.js),
  [controllers/v1/oauth/](../../../back/server/src/controllers/v1/oauth/)): an encrypted 10-minute
  `state`, then `/callback`.
- **Google Console** (done 2026-11-26): redirect URIs
  `http://localhost:4021/api/v1/auth/google/callback` and
  `https://office.dynamicglobalsoft.com:1342/api/v1/auth/google/callback`.
- **Player pages:** `/book`, `/book/:bookingToken`
  ([pages/Public/Book/](../../../front/src/pages/Public/Book/)), `/booking` (Find my booking),
  `/booking/:manageToken`, `/session/:shareToken`, registered in
  [routes/index.jsx](../../../front/src/routes/index.jsx).

## Approach

### Data

New migration:
- **`players`:**
  - `playerId` UUID (business ID), `googleSub` VARCHAR(64) UNIQUE;
  - `email` VARCHAR(255), `name` VARCHAR(100), `photoUrl` VARCHAR(500) NULL;
  - `lastPhone` VARCHAR(20) NULL, filled in on the next booking;
  - `status` ENUM('Active','Blocked','Deleted') default `Active`;
  - `lastSignInAt`, `dateCreated`, `dateUpdated`.
- **`player_refresh_tokens`:** `jti`, `playerId`, `expiresAt`, `revokedAt` NULL, dates. Same
  rotation as staff `refresh_tokens`.
- **`player_sign_in_codes`:** `codeHash` (SHA-256), `playerId`, `returnPath`, `expiresAt`,
  `usedAt` NULL. Single-use, 60 seconds.
- **`bookings.playerId`:** VARCHAR(50) NULL, with an index and a FK to `players(playerId)`. Desk
  bookings and bookings from before this plan stay NULL.

### Sign-in flow

1. **The player clicks Sign in with Google.** The browser opens
   `GET /api/v1/auth/google/start?return=/book/<token>`. `return` must be one of the player pages
   (`/book…`, `/booking…`, `/me/games`); anything else falls back to `/me/games`. The API sets an
   encrypted 10-minute `state` (return path and a nonce) and redirects to Google with
   `openid email profile` and `prompt=select_account`.
2. **Google sends the browser back** to `GET /api/v1/auth/google/callback?code&state`. The API:
   - swaps the code with `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and `GOOGLE_LOGIN_REDIRECT_URI`;
   - checks the ID token: issuer, audience = client ID, expiry, nonce, and `email_verified = true`;
   - finds the player by `googleSub`, or creates one, and updates their name, email and photo
     (a `Deleted` player starts fresh; a `Blocked` one is refused);
   - stores a single-use code and redirects to the front `/signed-in?code=…`.

   Cancelled, refused or any failure → `/signed-in?error=cancelled|refused|failed`.
3. **The front's `/signed-in` page** calls `POST /api/v1/player/session { code }` and gets a player
   access token (15 min) and refresh token (30 days, rotated on each refresh, reuse revokes the
   family). It then goes to the return path. No token ever appears in a URL.

### Player tokens

- Signed with the same keys as staff tokens, with **their own audience** (`${AUDIENCE}-player`)
  and `typ: "player"`, `sub: playerId`.
- Sent as **`Authorization: Player <token>`**, like `Device` and `App`. The staff `Bearer`
  interceptor and passport never see it.
- Passport (audience `AUDIENCE`) refuses a player token. The new `requirePlayer` middleware
  refuses a staff token, a non-`Active` player, and a wrong audience.

### API

- **`/api/v1/auth/google/start`, `/callback`:** a new controller `controllers/v1/auth/google.controller.js`,
  mounted before the staff auth router. It's rate-limited. Without `GOOGLE_LOGIN_REDIRECT_URI`,
  it answers 404 `PLAYER_SIGN_IN_OFF`.
- **`/api/v1/player/*`** behind `requirePlayer`:
  - `POST /session` (no auth, takes `{ code }`, rate-limited);
  - `POST /session/refresh`, `POST /session/logout`;
  - `GET /me` (name, email, photo, `lastPhone`);
  - `GET /games?page&limit`: the player's **game log**, newest first. Each booking has its venue,
    court, time, status, payment status, its own link (`/booking/<manageToken>`), and its games
    (`recording_sessions` by `bookingId`): start, end, status, the game page link
    (`/session/<shareToken>`) and `driveUrl` once on Drive.
  - Includes bookings where `bookings.playerId = me`, plus older ones with no `playerId` whose
    `email` = the player's verified Google email (case-insensitive).
- **Booking online needs a sign-in:** `POST /public/book/:bookingToken/bookings` requires
  `requirePlayer` (401 `PLAYER_SIGN_IN_REQUIRED` without it). Name and email come from the
  account, so the body's `playerName` / `email` are ignored. `phone` stays optional and is saved
  as `lastPhone`. The booking gets `playerId`. Viewing the booking page and availability stays
  open to everyone.
- **`GET /public/book/:bookingToken`** adds `signInRequired: true` and `signInAvailable`. When
  sign-in isn't set up, the page says online booking is unavailable and shows the venue's phone,
  as it does for a venue whose week isn't open.
- **Unchanged:** the booking's own link and everything on it (pay, check in, cancel, move), Find
  my booking, game pages, the court QR check-in, and desk bookings in Admin.

### Web (`front/`)

- **`store/playerStore.js`:** Zustand with persist. Holds the refresh token and the player; the
  access token stays in memory. Kept apart from `authStore`.
- **`services/api/public/player.js`:** its own axios instance that sends `Player <token>` and
  refreshes once on a 401. `services/requests/public/player.js` with keys `["player", "me"]` and
  `["player", "games"]`.
- **`components/player/`:**
  - `GoogleSignInButton.jsx`, following Google's button style rules;
  - `PlayerAccountMenu.jsx`: photo and name, **My games**, **Sign out**.
- **New pages, registered in `routes/index.jsx`:**
  - `pages/Public/SignedIn/`: trades the code, shows "Signing you in…", handles the error codes;
  - `pages/Public/MyGames/` (`/me/games`): the game log, upcoming bookings first, then past ones
    with their games and Drive links, with Load more. Signed-out visitors see the sign-in button.
- **Book page** ([pages/Public/Book/](../../../front/src/pages/Public/Book/)):
  - the court and time can be picked first;
  - **Book** asks a signed-out visitor to sign in, returning to this page with the chosen slot
    kept in the URL;
  - once signed in, name and email show as read-only from Google, and the phone is pre-filled
    from `lastPhone`.
- **`/book` and Find my booking:** the account menu or a sign-in button in the header, and a
  **My games** link.

## Affected areas

| Area | Files / tables | Change |
| --- | --- | --- |
| Database | `back/database/migrations/041_players.sql` | `players`, `player_refresh_tokens`, `player_sign_in_codes`, `bookings.playerId` |
| API | `utils/jwt.js` or new `utils/playerTokens.js`, new `middlewares/playerAuth.middleware.js` | player tokens and `requirePlayer` |
| API | new `controllers/v1/auth/google.controller.js`, new `controllers/v1/player/player.controller.js`, `routes/route.js` | the sign-in flow and `/player/*` |
| API | `controllers/v1/public/booking.controller.js`, `validators/bookings.validator.js` | booking requires a player; name and email from the account |
| API | `utils/googleDrive.js` (shared OAuth helpers) | reuse the code swap; add an ID-token check |
| UI | `pages/Public/Book/`, `pages/Public/Venues/`, `pages/Public/FindBooking/` | sign-in, the account menu, the booking form |
| UI | new `pages/Public/SignedIn/`, `pages/Public/MyGames/`, `components/player/`, `store/playerStore.js`, `services/*/public/player.js`, `routes/index.jsx` | the new pages and plumbing |
| Settings | `back/.env.example` | `GOOGLE_LOGIN_REDIRECT_URI` |
| Docs | root `CLAUDE.md`, `docs/cloud-deployment-runbook.md` | the new route families, Google Console steps |
| Permissions | — | none: players aren't staff and have no roles |

## Out of scope

- Staff signing in to Admin with Google.
- Other sign-in methods (Facebook, Apple, an email and password).
- Deleting an account from the player pages (staff can block it; a self-service delete can come later).
- An Admin page listing players, or showing which bookings came from a signed-in player.
- Groups: only the person who booked sees the game in their log.
- The session device app and the TV court board.

## Risks

- **Online booking stops when Google sign-in is down or not set up.** The booking page says so
  and shows the venue's phone; staff can still book at the desk. Check `GOOGLE_LOGIN_REDIRECT_URI`
  on every server before release.
- **Breaking for players:** booking online without a Google account is no longer possible. That
  makes the release `major`. The landing page and booking page text must say "sign in with
  Google to book".
- **Token mix-up between staff and players:** separate audience, separate header scheme, and
  tests both ways.
- **Linking old bookings by email:** someone else's booking typed with your email would show in
  your log. Google has verified the email belongs to you, so this is acceptable (agreed 2026-11-26).
- **Open redirect through `return`:** an allow-list of player paths, kept inside the encrypted
  `state`.
- **Personal data** (Data Privacy Act): name, email and photo from Google. The landing page's
  privacy text mentions it, and staff block or delete on request.

## Open questions

Answered 2026-11-26 by bryanken00:

- [x] **Earlier bookings in the game log:** yes. Bookings made before signing in show when their
      email matches the player's verified Google email.
- [x] **How long a sign-in lasts:** 30 days, extended on each visit, unless they sign out.
- [x] **Players without Google:** call the venue or book at the desk. No guest online booking.
- [x] **Production address:** stays on `https://office.dynamicglobalsoft.com:1342`. Its callback
      is already in Google Console, so nothing to add for release.

## Revisions

- 2026-11-26: Fixed during the build: booking from the player pages over plain `http` (the LAN
  address in development) failed with "Couldn't reach DGSports": the player request's
  `Idempotency-Key` used `crypto.randomUUID()`, which browsers only offer on https / localhost.
  It now uses the app's existing `generateIdempotencyKey()`.
- 2026-11-26: **First-sign-in profile** (requested by bryanken00). Right after the first Google sign-in the player is asked for first name, middle name (optional), last name and phone number (optional — changed the same day), pre-filled from Google (`given_name`, `family_name`; Google doesn't share a phone). New page `/me/profile` (also "Your profile" in the account menu), `PATCH /api/v1/player/me`.
  - `players` gets `firstName`, `middleName`, `lastName`, `phone` (replacing `lastPhone`) and `profileCompletedAt`, changed in `041_players.sql` itself (not yet applied or committed anywhere).
  - Until the profile is complete, the names follow Google at each sign-in and booking is refused (409 `PROFILE_INCOMPLETE`); `/book` and a venue's page send the player to the profile first.
  - After it's complete, only the email and photo follow Google. Bookings carry the full name ("First Middle Last") and the booking's phone, else the profile's; a booking no longer changes the saved phone.
- 2026-11-26: `/book` asks a signed-out player to sign in with Google before showing the venues
  (requested by bryanken00); `GET /public/venues` says whether sign-in is set up
  (`signInAvailable`), and without it `/book` says online booking isn't available. A venue's own
  booking link still shows its times first and asks for the sign-in at **Book**.
- 2026-11-26: Built (branch `plan-006-player-google-sign-in`). Changes from the design above:
  - `player_sign_in_codes` has no `returnPath`: the return path rides in the redirect as `next`
    (it came out of the encrypted `state`, checked against the allow-list again).
  - `/auth/google/start` with sign-in off redirects to `/signed-in?error=off` instead of a JSON
    404, since it's a browser navigation.
  - `playerName` / `email` are dropped from `publicBookingSchema`; an older page's values are
    simply stripped.
  - The dev scripts (`run.sh`, `run-mac.sh`, `update-ip.sh`) keep `GOOGLE_LOGIN_REDIRECT_URI` on
    localhost, because Google refuses LAN IPs.
  - The landing page says booking needs a Google sign-in, and its privacy note covers player
    accounts.
- 2026-11-26: Open questions answered: old bookings by email, 30-day sign-in, desk/phone for
  players without Google, production stays on office.dynamicglobalsoft.com.
- 2026-11-26: Created, from CR-045 (draft, never approved, removed): narrowed to sign-in, the game
  log, and booking online requiring a sign-in.
