# PLAN-009 · Player community on mobile — Checklist

> Tick items as they land. Plan: [plan.md](plan.md)

## Before starting

- [x] Open questions answered (plan.md — 2026-11-26; skill levels and highlight previews still open)
- [x] Approved (2026-11-26, bryanken00)

## Phase A — The DGSports player app

### A1 — the app's two modes, sign-in, tabs

- [x] `app/`: first-launch choice — "I'm a player" / "Set up a courtside device" (today's Pair →
      Session → Ended flow unchanged behind it, moved to `Screens/Device`); remembered on the
      device (`useAppModeStore`); a device paired before the update stays a courtside device
- [x] Rebrand the app's name to DGSports (`app.json` name, scheme `dgsports`, on-screen text);
      store IDs unchanged so installs update
- [ ] Rebrand the icon and splash to the CR-036 DGPlay brand
- [x] Google sign-in on mobile (in-app browser, PKCE-style verifier), player tokens in
      `expo-secure-store`, refresh rotation (player axios instance); profile completion as on the
      web (PLAN-006), also as Edit profile
- [x] API: `/auth/google/start?app=1&challenge=…` → `dgsports://signed-in`; `POST /player/session`
      takes the `verifier` and burns a code without it (migration 049); `APP_SCHEME` in
      `.env.example`; `tests/app-sign-in.test.js` — player audience only
- [x] Player tabs: Home · Book · Open plays · Communities · Me (Open plays and Communities are
      placeholders until phases B and D)
- [x] Book: venues with Near me (`expo-location`, asked on tap; position stays on the phone),
      today's hours, Directions (Google Maps), Book opens the venue's page in the in-app browser
      (`/public/venues` now returns `bookingUrl`)
- [x] Me: profile, My games (bookings, games and their Drive links), sign out, switch to courtside
- [x] `npx expo-doctor@latest` (20/20, Expo patch versions aligned) · `npx expo export --platform
      android --clear` · `cd back && npm run lint && npm test` (555 pass)
- [ ] Migration 049 applied (`npm run db:migrate`), or noted as pending for deploy
- [ ] Try both modes on a device (dev build — new native modules): Welcome → player → Google
      sign-in → profile → Near me → Directions; Me → courtside → Pair; Pair → player

### A2 — native booking

- [ ] Book: a venue's courts and hours (CR-047 picker, CR-049 late hours), sign-in gate, pay in
      an in-app browser (Xendit), back to the booking

## Phase B — Open plays

- [ ] Migration: `open_plays`, `open_play_players`; permission `openplays` seeded + granted to
      Owners
- [ ] Court timeline: open plays block their courts (`findConflict` kind `OPEN_PLAY`)
- [ ] Admin API + page: create / edit / cancel (refunds), player list, no-shows — company-scoped
- [ ] Player API: list (near me, by venue, by date), detail with who's going, join (pay online),
      waitlist, leave before the cut-off (refund), my open plays
- [ ] Waitlist promotion job; reminder before the start
- [ ] App: Open plays tab, detail, join / pay / leave, my open plays
- [ ] Tests: capacity, waitlist, refunds, cut-off, company scope, timeline conflicts

## Phase C — Follow venues and push

- [ ] Migration: `venue_follows`, `player_devices`, `venue_announcements`
- [ ] Player API: follow / unfollow, register push token; Admin: announcements
- [ ] Push sending (Expo push service) from jobs: new open play, announcement, starts soon,
      waitlist spot
- [ ] App: follow buttons, Home feed (followed venues), notification permission prompt, settings
- [ ] Tests

## Phase D — Communities

- [ ] Migration: `communities` (Venue / Club), `community_members`, `community_posts`,
      `community_reports`; permission `community`
- [ ] Admin: venue communities, members, posts, moderation (hide / remove) — company-scoped
- [ ] Player API: browse, join (open / approval), start a club, club admins (approve, hide, remove),
      posts (text, photo), share a highlight, report a post / club / player
- [ ] Back office: Reports page — hide posts, suspend a club, block a player (platform audit)
- [ ] App: Communities tab, community page (posts, open plays, members), start a club, post
      composer, report
- [ ] Tests (company scope, club admins, reports, privacy)

## Phase E — Players and open spots

- [ ] Migration: `players` profile columns; `booking_spots`
- [ ] Player API: public profile, visibility; open spots on a booking, requests, accept, pay share;
      joiners get the game video
- [ ] App: profiles, "spots open" on bookings, requests
- [ ] Tests

## Phase F — Coaching (optional)

- [ ] Coaches and coaching sessions (timeline, payment) — plan in detail before starting

## Wrap-up

- [ ] `cd back && npm run lint` · `npm test` pass
- [ ] `cd front && npm run lint && npm run build` pass
- [ ] `cd app && npx expo-doctor@latest && npx expo export --platform android --clear` pass
- [ ] Migrations applied, or noted as pending for deploy
- [ ] Tried on a device: sign in → Near me → join an open play and pay → get the push reminder →
      post in a community
- [ ] Changelog entry added in `docs/changelog/unpublished/` (`ref: PLAN-009`)
- [ ] `plan.md` status set to `Done`
