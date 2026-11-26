---
type: added
impact: major
audience: user
ref: PLAN-006
---

Players now sign in with their Google account to book a court online. The first time, they confirm
their first, middle (optional) and last name, and can add a phone number, filled in from their
Google account where it can; after that every booking fills in by itself. The new **My games** page lists
their bookings and the Google Drive link of every game they've played, including bookings made
before they signed in with the same email. Booking online without a Google sign-in is no longer
possible: players without one call the venue or book at the front desk.

## Dev notes

- back/: run `npm run db:migrate` — `041_players.sql` adds `players`, `player_refresh_tokens`,
  `player_sign_in_codes` and `bookings.playerId`.
- back/: set `GOOGLE_LOGIN_REDIRECT_URI` in `.env` to this API's `/api/v1/auth/google/callback`
  (office: `https://office.dynamicglobalsoft.com:1342/api/v1/auth/google/callback`). It uses the
  same `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. **Without it nobody can book online** (the
  booking page says to call the venue).
- Google Cloud: the redirect URI above must be an authorised redirect URI on the OAuth client, and
  the scopes `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` listed under Data
  Access.
- back/: new routes `GET /api/v1/auth/google/start|callback` (no login; encrypted `state`) and
  `/api/v1/player/*` (`Authorization: Player <token>`: `POST /session`, `/session/refresh`,
  `/session/logout`, `GET /me`, `PATCH /me` (the profile), `GET /games`). Booking needs a
  completed profile (409 `PROFILE_INCOMPLETE`). `POST /public/book/:bookingToken/bookings` now
  answers 401 `PLAYER_SIGN_IN_REQUIRED` without a player token; `playerName` / `email` in its body
  are ignored (the account's are used).
- front/: new pages `/signed-in`, `/me/profile` and `/me/games`; the player pages show an account menu; `/book`
  asks for the Google sign-in before listing venues (`GET /public/venues` adds `signInAvailable`).
- run.sh / run-mac.sh / update-ip.sh keep `GOOGLE_LOGIN_REDIRECT_URI` on localhost. Locally, sign
  in from the Mac's own browser: Google only returns to `localhost`.
- app/, edge/: no change.
