# CR-017 · Delete saved videos after 24 hours, on the server and on Google Drive

> **Status:** Done · **Requested:** 2026-11-20 · **Requested by:** bryanken00 · **Size:** M
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [CR-001](../CR-001-google-drive-per-court/request.md) (Google Drive per court), [CR-006](../CR-006-one-file-per-game/request.md) (one video per game), [CR-013](../CR-013-save-last-minutes/request.md) (saves), [CR-015](../CR-015-pay-before-download/request.md) (pay before download)

## Requested change

> Can we add auto delete here on local saved video if already 1 day that video? Also add that on
> gdrive. Auto delete video once already 24 hrs.

Every saved video — the 60-second replays, the whole-game videos and the "Save the last …"
videos — is deleted **24 hours** after it is saved, both:

1. **on Dyna Cam's server** (what the player's page and the court's device show), and
2. **on the court's Google Drive**, when the court is connected to one.

## Today

- **Server:** a video is deleted after the venue's **Keep clips for (days)** setting (Setup →
  Venues). It is 30 days unless staff changed it; the shortest allowed is 1 day. The player's
  page shows "Available until …", then "This video has expired here", with a Google Drive link
  if there is a copy.
- **Google Drive:** copies are **never deleted**. They stay in the court's "Dyna Cam" folder until
  someone deletes them by hand.
- **Recorder box:** keeps a game's footage only until its videos are sent, then frees it. No change
  needed.

## Why

Videos take up storage on the server and fill the venue's Google Drive. Players get their videos
on the day; nobody needs them kept for a month.

## How it would work

| | Today | Requested |
| --- | --- | --- |
| Server copy | Deleted after the venue's days (default 30) | Deleted after the venue's days — **every venue set to 1 day (24 hours)**, the new default |
| Google Drive copy | Kept forever | **Moved to the Drive's trash** at the same time as the server copy (Google empties it after 30 days) |
| Player's page | "Available until <date>" | Same, with the 24-hour time; after: "This video has been deleted" (no Drive link) |
| Court's device | "Download it when the game ends" | "Download it within 24 hours after the game" |
| Admin | Video rows show their files | Deleted videos show "Deleted after 24 hours" |
| Setup → Venues | "Keep clips for (days)", default 30 | "Keep videos for (days)", default **1** — also applies to the Drive copy |
| Videos saved before the update | — | Get 24 hours from the update, then go like any other |

### Things to know

- **Unpaid games (CR-015):** the 24 hours run from when the video is saved, paid or not. A player
  who pays the next day may find the videos already gone.
- **A venue can still choose longer** in Setup → Venues (up to 365 days), and its Drive copies
  then stay as long.
- **Trash:** a Drive copy goes to the Drive's trash, where staff can restore it for 30 days; Google
  empties it after that. It counts toward the Drive's storage until then.
- **Drive deletion needs the court still connected.** If staff disconnected the court's Google
  Drive, or Google asks for a reconnect, Dyna Cam can't delete those copies; Admin shows which
  ones were left behind, and they are deleted once the court is reconnected.
- **Only Dyna Cam's own files are deleted.** Dyna Cam can only see the files it uploaded, so
  nothing else in the venue's Drive is touched.

## Scope

**In**

- Server copies of replays, whole-game videos and saves deleted 24 hours after they are saved.
- Their Google Drive copies (and the game's Drive folder, once empty) deleted at the same time.
- Player's page, court's device and Admin wording for the 24 hours and for a deleted video.
- Retrying a Drive delete that failed (Google down, court needs reconnecting).

**Out**

- Anything else in the venue's Google Drive.
- The recorder box (it already frees footage once uploaded).
- Keeping a video longer on request (no "keep" button).

## Acceptance criteria

- A video saved now plays on the player's page and shows "Available until <tomorrow, same time>".
- 24 hours after it was saved, the player's page says it has been deleted, and it no longer
  downloads.
- At the same time its Google Drive copy is gone from the court's Dyna Cam folder.
- A court whose Drive needs reconnecting keeps its Drive copies until it is reconnected; then
  they are deleted.
- Nothing else in the Drive is touched.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Web: Setup → Venues (the days setting — see open questions), Sessions / Clips details (deleted state, Drive copy left behind), player's page wording. App: the QR card's "Download it…" line (JavaScript only). Landing page: the line about how long videos are kept. |
| Data | Migration: Drive status gains `Deleted` on `clips` and `session_videos` (and a retry time for the delete); `venues.clipRetentionDays` default 1 and every venue set to 1; every Ready video's `expiresAt` brought forward to at most 24 hours from the migration (never earlier than that). |
| API | `jobs/clipMaintenance.js` (hourly): when a server copy expires, also delete its Drive file (`utils/googleDrive.js` gains a delete call; the `drive.file` scope already allows it), then the game's Drive folder once nothing in it is left. Failed deletes retry. Expiry time stays `expiresAt`. |
| Build / rollout | Server + web deploy, migration. App: JavaScript only (over-the-air update). **Recorder box: no update.** |
| Permissions | None new. |
| Existing users | **Breaking:** videos disappear after 24 hours instead of 30 days, and Drive copies that used to stay forever are deleted. Release impact `major`. |
| Size | M: Drive delete + retry in the hourly job, migration, wording on three screens, tests — about 1–2 days. |

## Open questions

- [x] **Setting:** keep the venue's setting. Every venue is set to **1 day (24 hours)**, new
      venues default to 1 day, and the Drive copy follows the same setting. A venue can still
      choose longer (bryanken00, 2026-11-20)
- [x] **24 hours from when:** from when the video is **saved**, paid or not (bryanken00, 2026-11-20)
- [x] **Drive delete:** **move to the Drive's trash**. Google empties it after 30 days, and staff
      can restore a mistake until then (bryanken00, 2026-11-20)
- [x] **Videos already older than 24 hours when this ships:** they get **24 hours from the
      update**. Nothing is deleted without notice (bryanken00, 2026-11-20)

## Design notes (as built)

- Expiry is unchanged: `expiresAt` = saved + the venue's days, now 1 by default
  (`jobs/clipMaintenance.js`, every 10 minutes instead of hourly).
- `jobs/driveCleanup.js` runs after each Drive upload pass (every 30 s). It moves an expired
  video's Drive copy to the trash (`PATCH files/:id {trashed: true}`, which the `drive.file` scope
  allows), marks it `Deleted`, then trashes the game's Drive folder once nothing in it is kept.
  Not found counts as deleted. Other errors retry with back-off, up to 8 tries, and leave
  "Not deleted from Drive: …" for Admin. A court that is disconnected or needs reconnecting waits.
- The player's page drops the Drive link once the server's copy expires.
- The court device's session has `keepDays`; the QR card says "Download it within 24 hours after
  the game" and the Ended screen says "Download within 24 hours — then it's deleted."
- If a court switched Google accounts, the old account's copies answer "not found" to the new
  sign-in and are marked deleted, but they stay in the old account's Drive.

## Revisions

- 2026-11-20: Open questions answered — venue setting at 1 day (default 1), 24 h from saved, Drive
  copies to the trash, existing videos get 24 h from the update.

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-20 | "ok implement this now" — open questions answered the same day |
| Signed off — Done | bryanken00 | 2026-11-20 | Bulk sign-off by the requester ("check all CR and plan… mark all complete"); acceptance items ticked on that sign-off, not re-checked one by one |
