# CR-004 · Players never see parts — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered

## Build

### API (`back/`)

- [x] `utils/sessions.js` `settleSessions`: missing-footage reason in minutes and times
      ("8 minutes weren't recorded (11:23 – 11:31)") instead of "N of M parts"
- [x] Public `GET /public/sessions/:shareToken`: no `parts` for players; add `savedSeconds` /
      `totalSeconds` (and `percent`) for the progress; keep `videos`
- [x] `/app/*` session: same progress figures (`savedSeconds`, `totalSeconds`); keep
      `partsReady`/`partsTotal` for old app builds
- [x] Tests: public page never lists parts; progress figures; reason wording

### Web (`front/`)

- [x] Player game page: remove PartCard / "So far"; "Recording now" text; "Saving your game…"
      with a progress bar; "check back soon" when the join failed
- [x] Admin → Sessions: unchanged except the new reason wording

### App (`app/`)

- [x] `Screens/Ended`: "Saving your game… 25 of 30 minutes saved" (no "parts")
- [x] `npx expo-doctor@latest && npx expo export --platform android --clear`

## Acceptance

- [x] No videos during the game, "Recording now" only
- [x] After Stop / End: progress, then one video per camera, one Download each
- [x] Session device end screen never says "parts"
- [x] Missing footage named in minutes and times
- [x] Failed join: "check back soon" for players; Try again in Admin
- [x] Admin still lists the parts

## Wrap-up

- [x] `cd back && npm run lint && npm test` passes (215/215)
- [x] `cd front && npm run lint && npm run build` passes
- [x] `cd app && npx expo export --platform android --clear` passes; `expo-doctor` flags 11
      out-of-date packages (already so before this change — no dependency touched here)
- [x] Changelog: CR-003 is unreleased, so update its entry
      (`docs/changelog/unpublished/2026-11-18-whole-game-video.md`) instead of a new one
- [x] Requester shown the result and signed off
- [x] `request.md` status set to `Done`
