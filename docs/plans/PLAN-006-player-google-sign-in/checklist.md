# PLAN-006 · Player sign-in with Google — Checklist

> Tick items as they land. Plan: [plan.md](plan.md)

## Before starting

- [x] Plan approved (bryanken00, 2026-11-26: "implement this now")
- [x] Open questions answered (2026-11-26, see plan.md)
- [x] Google Console: redirect URIs for localhost and office added (2026-11-26)
- [ ] Google Console: scopes `openid`, `email`, `profile` (Data Access); branding home, privacy and terms links (check in the console)

## Backend

- [x] Migration `041_players.sql`: `players`, `player_refresh_tokens`, `player_sign_in_codes`,
      `bookings.playerId` (NULL, index, FK)
- [x] Player tokens: audience `${AUDIENCE}-player`, `typ: "player"`, access 15 min, refresh
      30 days with rotation and reuse revocation
- [x] `middlewares/playerAuth.middleware.js` `requirePlayer`: `Authorization: Player <token>`,
      `Active` player only
- [x] `controllers/v1/auth/google.controller.js`:
  - `GET /start`: `return` allow-list, encrypted `state` with a nonce;
  - `GET /callback`: code swap, ID-token checks, find or create by `googleSub`, single-use code →
    `/signed-in`; errors → `/signed-in?error=…`;
  - rate-limited;
  - 404 `PLAYER_SIGN_IN_OFF` without `GOOGLE_LOGIN_REDIRECT_URI`.
- [x] `controllers/v1/player/player.controller.js`:
  - `POST /session` (code → tokens, rate-limited), `/session/refresh`, `/session/logout`;
  - `GET /me`;
  - `GET /games` (the game log: my bookings plus older ones by verified email, their games, links,
    `driveUrl`).
- [x] `routes/route.js`: mount `/v1/auth/google` and `/v1/player` (`/session` routes without
      `requirePlayer`)
- [x] `POST /public/book/:bookingToken/bookings` requires `requirePlayer` (401
      `PLAYER_SIGN_IN_REQUIRED`); name and email from the account; `phone` saved as `lastPhone`;
      `playerId` set
- [x] `GET /public/book/:bookingToken`: `signInRequired`, `signInAvailable`
- [x] `back/.env.example`: `GOOGLE_LOGIN_REDIRECT_URI` with the Google Console steps
- [x] Tests (`back/tests/`):
  - start/callback with a mocked Google: bad or expired `state`, wrong audience, unverified email,
    cancelled, Blocked player;
  - a `return` outside the allow-list falls back to `/me/games`;
  - the code is single-use and expires;
  - refresh rotation, and reuse revokes;
  - passport refuses a player token; `requirePlayer` refuses a staff token;
  - booking without a token → 401, with one → `playerId` set and the account's name/email used;
  - the game log returns only mine; a booking with another email never shows; a `Deleted`
    booking is left out;
  - a `Deleted` player is refused and starts fresh on the next sign-in.
- [x] `cd back && npm run lint && npm test` (498 pass; lint 0 errors, its 12 warnings were there before)

## Frontend

- [x] `store/playerStore.js` (refresh token and player persisted; access token in memory)
- [x] `services/api/public/player.js` (own axios instance, `Player <token>`, one refresh on 401) +
      `services/requests/public/player.js` (`["player", "me"]`, `["player", "games"]`)
- [x] `components/player/GoogleSignInButton.jsx`, `PlayerAccountMenu.jsx`
- [x] `pages/Public/SignedIn/` (`/signed-in`): trade the code, go to the return path, error messages
- [x] `pages/Public/MyGames/` (`/me/games`): upcoming bookings, then past bookings with their games
      and Drive links, Load more, empty state, sign-in for signed-out visitors
- [x] `pages/Public/Book/`:
  - slot first, then **Book** asks for a sign-in (slot kept in the URL);
  - signed in: name and email read-only, phone pre-filled;
  - "online booking unavailable" when sign-in is off.
- [x] `/book` (Venues) and Find my booking: account menu or sign-in button, and a My games link
- [x] First-sign-in profile (2026-11-26): `PATCH /player/me` (first, middle optional, last name,
      phone optional — pre-filled from Google), booking refused until complete (409 `PROFILE_INCOMPLETE`),
      `/me/profile` page, `/signed-in` → profile on a first sign-in, `/book` and venue pages send an
      incomplete profile there, "Your profile" in the account menu; tests
- [x] `/book`: signed out → "Sign in to book a court" first, the venues after; `GET /public/venues` → `signInAvailable` (2026-11-26)
- [x] Routes registered in `routes/index.jsx`
- [x] Wording: the booking page and landing page say "Sign in with Google to book"; privacy text
      mentions player accounts
- [x] `cd front && npm run lint && npm run build`

## Docs

- [x] Root `CLAUDE.md`: route families `/api/v1/auth/google/*` and `/api/v1/player/*`
      (`Player <token>`), and that booking online needs a sign-in
- [x] `docs/cloud-deployment-runbook.md`: Google Console steps and `GOOGLE_LOGIN_REDIRECT_URI`

## Wrap-up

- [x] `cd back && npm run lint` passes
- [x] `cd front && npm run lint && npm run build` passes
- [ ] Migration applied, or noted as pending for deploy — **pending**: `cd back && npm run db:migrate` (041) locally and on each server
- [ ] Tried in the browser: sign in on a venue's booking page → book → the booking and later its
      game show in My games → sign out
- [x] Changelog entry added in `docs/changelog/unpublished/` (`ref: PLAN-006`, `impact: major`:
      booking online now needs a sign-in)
- [ ] `plan.md` status set to `Done`
