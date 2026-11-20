# CR-026 · Keep videos 7 days; Google Drive copies 2 days

> **Status:** Done · **Requested:** 2026-11-20 · **Requested by:** bryanken00 · **Size:** M
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [CR-017](../CR-017-auto-delete-24h/request.md) (delete after 24 hours), [CR-018](../CR-018-email-drive-link/request.md) (Drive email, re-upload)

## Requested change

Saved videos (replays, whole-game videos, saves) stay on the server for **7 days** instead of 1.
Their copy in the court's Google Drive goes to the Drive's trash **2 days after the video is
saved**, on its own clock, not when the server copy goes.

## Today

Since CR-017 every venue keeps videos 1 day (24 hours). When the server copy is deleted, its
Google Drive copy is moved to the Drive's trash at the same time.

## Why

Players get a week to watch and download from the player's page, while the venue's Google Drive
doesn't fill up: Drive copies are only kept for the first 2 days.

## Scope

**In**

- Every venue set to keep videos 7 days; new venues default to 7 (staff can still change it per venue).
- Videos already saved and still kept get 7 days from when they were saved.
- Drive copies trashed 2 days after saving (or earlier, if the venue keeps videos less than 2 days),
  then the game's Drive folder once nothing is left in it.
- A Drive upload that would only finish after those 2 days is skipped, and Re-upload refuses it.
- The "your game is in Google Drive" email gives the Drive copy's deadline.
- Wording on the venue form, court Drive setup, Sessions, the landing page and the session device.

**Out**

- A per-venue Drive keep time (it is one setting for all courts: 2 days).
- Recorder box changes.

## Acceptance criteria

- A new venue shows "Keep videos 7 days"; every existing venue shows 7 days.
- A replay saved today can be played and downloaded from its share link for 7 days.
- Its Google Drive copy is in the Drive's trash 2 days after it was saved, while the share link
  still plays it from the server.
- A game's Drive folder goes to the trash once all its videos' Drive copies have gone.
- The Drive-link email says to download before the Drive deadline (2 days after the game).
- The court device says "Download it within 7 days after the game".

## Impact

| Area | Detail |
| --- | --- |
| Screens | Admin → Venues (form default + hint), Court setup → Google Drive (text), Sessions (Drive dialog text), landing page; app session/ended screens read `keepDays` (now 7) |
| Data | Migration `027_keep_7_days_drive_2_days.sql`: `venues.clipRetentionDays` default 7, every venue → 7; Ready clips/videos `expiresAt` → at least saved + 7 days. No new columns (Drive clock = `dateCreated`). |
| Build / rollout | `npm run db:migrate`. App: JavaScript only (demo data). No recorder box update. |
| Permissions | None |
| Existing users | Yes: videos are kept a week instead of a day, and Drive copies go after 2 days instead of with the server copy → `major` in the changelog |
| Size | M — jobs, migration, tests and wording across web and app |

## Open questions

- [x] Drive copy: 2 days after saving (not 2 days after/before the server copy) — answered 2026-11-20
- [x] All venues → 7 days (not only new ones) — answered 2026-11-20

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-20 | Asked directly |
