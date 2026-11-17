---
type: added
impact: minor
audience: user
ref: PLAN-001
---

The website has a new Dyna Cam home page that explains court replays and links staff to sign in.
In the Dyna Cam staff app, staff sign in with their Admin portal account and can change their
password from the Menu. New staff are asked to set their own password on first sign-in.

## Dev notes

- `front/`: `/` is the new landing page (`pages/LandingPage/`); the template's component gallery
  moved to `/components` (`pages/ComponentGallery/`). Set `VITE_APP_NAME=Dyna Cam` in `front/.env`.
- `app/`: identity is now "Dyna Cam", `com.dgsi.dynacam` (Android package + iOS bundle ID) —
  **needs a new build**, and an existing install with the old ID is a different app. Version
  aligned to 1.0.0 to share the product version.
- `app/`: auth now uses the API's envelope, stores the refresh token (rotated on refresh),
  sends CSRF + `Idempotency-Key` on mutations, and holds a flagged account on the new
  change-password screen (403 `PASSWORD_CHANGE_REQUIRED`). The persisted auth shape changed, so
  anyone signed in on a dev build is **signed out once** after updating.
- `app/`: `EXPO_PUBLIC_API_URL` default/example is now port `4021`; `eas.json` production profile
  forces `EXPO_PUBLIC_DEMO_MODE=false`.
- `app/`: `npx expo-doctor` still reports 11 Expo packages behind SDK 58's pinned versions
  (pre-existing) — run `npx expo install --check` before the first store build.
- Repo: the app's docs, skills and CLAUDE.md moved into the root `.claude/skills/`
  (`mobile-conventions`, `new-mobile-module`) and `docs/`; `/publish` now bumps `front/`, `back/`
  and `app/` together. Package names: `dyna-cam-api`, `dyna-cam-web`, `dyna-cam-app`.
