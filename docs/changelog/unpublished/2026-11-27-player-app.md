---
type: added
impact: minor
audience: user
ref: PLAN-009
---

Players get their own DGSports app. On a computer or tablet its places are in a sidebar on the
left; on a phone they're in a bottom tab bar (Discover, Play, Clubs, Profile). In it they can find a venue near them, book and pay, check in, cancel or move a booking,
see their games, and edit their profile. Links in booking emails and the return from paying or
signing in now open it, and the old booking addresses still work.

## Dev notes

- web-app/: new player app (port 4022, `npm run dev`; `/api/v1` proxied to the API). Copy
  `.env.example` → `.env`: `VITE_API_URL`, `VITE_MAIN_APP_URL` (the main app's origin, for game
  pages), `VITE_STORE_KEY`. Production: serve its `dist/` on its own domain and proxy `/api/v1`
  and `/public/uploads` to the API, as for the main app.
- back/: new `PLAYER_APP_URL` (`utils/clips.js` `playerAppUrl()`). It's where venue booking links,
  booking links in emails, the Xendit return and the end of a Google sign-in go. Empty = `APP_URL`
  (nothing changes). Add the player app's origin to `ALLOWED_ORIGINS`. A sign-in may now also
  return to `/me/profile`. Test: `tests/player-app-url.test.js`.
- front/: new `VITE_PLAYER_APP_URL`. Set it and `/book…`, `/booking/…`, `/me/games`,
  `/me/profile` and `/signed-in` redirect there with the same path and query
  (`components/PlayerAppRedirect.jsx`). Leave it empty until the player app is live.
- Turn it on in this order: deploy web-app/, set `PLAYER_APP_URL` on the API, then
  `VITE_PLAYER_APP_URL` on front/ and rebuild front/.
- Venue booking links already shown in Admin are rebuilt from `PLAYER_APP_URL` the next time the
  page loads. Signs or QR codes already printed with the old `/book/…` address keep working
  through the redirect.
