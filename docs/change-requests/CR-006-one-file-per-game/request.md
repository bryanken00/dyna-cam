# CR-006 · One file per game — no 5-minute pieces at all

> **Status:** Done · **Requested:** 2026-11-18 · **Requested by:** bryanken00 · **Size:** L
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — (design notes below) · **Related:** [CR-003](../CR-003-whole-game-video-per-camera/request.md) (whole video per camera, joined from pieces), [CR-004](../CR-004-players-never-see-parts/request.md) (players never see pieces), [CR-005](../CR-005-start-stop-from-device/request.md) (pairing starts the game, End game stops it)

## Requested change

> Can we completely remove that? (the backend 5-minute parting)

A game should travel from the court to the player as **one file per camera**, with no 5-minute
pieces anywhere: not for players (already so since CR-004), not for staff, and not inside the
recorder box or the server.

## Today

Since CR-003 / CR-004 / CR-005 (merged to `main`, not released):

1. While a game records, the server makes a job for every finished **5-minute stretch**
   (`SESSION_PART_SECONDS`, `utils/sessions.js`).
2. The recorder box cuts each stretch (re-encoded with the venue logo, capped at ~47 MB) and
   uploads it as it goes.
3. After **End game**, only the last stretch is left; the server **joins** all the pieces with
   ffmpeg into one video per camera (`jobs/sessionJoin.js`) and deletes the pieces.
4. Players see "Saving your game… 25 of 30 minutes saved", then one video — usually **1–2 minutes**
   after End game. Staff see the pieces in the game's detail in Admin.

## Requested (suggestion)

1. While a game records, the recorder box only **keeps** its footage (it already does).
2. After **End game**, the box makes **one file per camera** for the whole game and uploads it
   with a **resumable upload** (8 MB chunks; a dropped connection or a restart continues where
   it stopped instead of starting over).
3. The server stores it as the game's video — no joining, **no ffmpeg on the server**.
4. Players see "Saving your game… uploading 45%", then the video. Staff see the same progress.
5. The 5-minute piece jobs, the join job and the pieces in Admin are **removed**.

### The cost of removing them

| | Today (pieces) | One file |
| --- | --- | --- |
| Video ready after End game | ~1–2 min (only the last piece is left) | **~10–60 min** for a long game: the whole file is made and uploaded after End game (e.g. 2 h × 2 cameras ≈ 2–3.5 GB; at 10 Mbit/s upload ≈ 30–50 min) |
| Upload | ≤ 47 MB pieces, retried one at a time | 0.5–0.9 GB per camera per hour in one resumable upload; the server's 100 MB limit is replaced for game videos |
| Server | needs ffmpeg to join | **no ffmpeg needed** |
| Box disk | keeps the game until 30 min after it ends | keeps the game **until it's uploaded** |
| Camera drop-out | that piece fails; the video skips it | the box skips the gap in the one file and reports it |
| Moving parts | piece jobs, join job, piece rows | one job per camera per game |

## Choices to make

### 1. Make the file by copying or by re-encoding? — copying recommended

- **Copy (recommended):** the box joins its own recorded segments without re-encoding. Takes
  **seconds** even for 3 hours, full camera quality. Costs: **no venue logo** burned into the game
  video (60-second replays keep theirs), and the file is the camera's own size (~1–2 Mbit/s, so
  0.5–0.9 GB per hour).
- **Re-encode:** logo and the same size cap as today (~0.5 GB per hour), but encoding a long game
  takes **5–30 minutes** on a small venue PC before the upload even starts.

### 2. Old recorder boxes — require the update (recommended)

- **Require (recommended):** every venue's box is updated with this release; truly no pieces
  anywhere, one code path.
- **Fallback:** a box not yet updated keeps sending pieces and the server keeps joining them —
  less risk during the rollout, but the piece code and ffmpeg on the server stay.

### 3. Two cameras

Unchanged from CR-003: one file per camera ("Cam 1", "Cam 2"). With copying (choice 1) a stacked
view isn't possible; a box that can't do per-camera files is the fallback case (choice 2).

## Scope

**In**

- Recorder box: after End game, one file per camera (copy or re-encode per choice 1), gaps found
  and reported, resumable chunked upload that survives restarts, footage kept until uploaded.
- API: one game-video job per camera after End game; resumable upload endpoints for the box;
  upload progress; remove the 5-minute piece jobs, the join job and their settling.
- Player's page and session device: "Saving your game… uploading N%".
- Admin: game detail shows each camera's video and upload progress (no pieces).
- Google Drive (CR-001): uploads the one file, as today.

**Out**

- 60-second replays (unchanged: still cut and uploaded right away, with the logo).
- Live view and live streams.
- Games recorded before this change (they keep their videos as they are).

## Acceptance criteria

- During and after a game, no 5-minute piece exists anywhere (box, server, Admin, player's page).
- After End game the player's page shows "Saving your game… uploading N%", then one video per
  camera with one Download.
- Pulling the box's network cable mid-upload and putting it back continues the upload; it doesn't
  start over. Restarting the box mid-upload does the same.
- A camera drop-out during the game shows as a named missing stretch, as today.
- The server needs no ffmpeg.
- 60-second replays work exactly as before.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Player's page and session device: upload progress instead of minutes saved. Admin → Sessions: no pieces list. |
| Data | Migration: upload progress per game video (bytes received, upload id); piece rows no longer made for new games. |
| Build / rollout | **Recorder box update at every venue** (required with choice 2 "require"). Server: migration; ffmpeg can be removed. App: JavaScript only (over-the-air). |
| Permissions | None. |
| Existing users | Players wait longer after End game for long games (see the table). Not released yet. |
| Size | L: box (whole-game file, gap handling, resumable upload with persistence, smoke test), API (upload endpoints, jobs, removal of pieces and join), pages, tests — about 3–5 days. A plan is written before building. |

## Open questions

- [x] Choice 1: **copy** — fast, full camera quality, no logo on the game video (bryanken00, 2026-11-18)
- [x] Choice 2: **no fallback** — "no deployment yet so no need to worry": no box runs at a venue
      yet, so the 5-minute pieces and the join are removed outright (bryanken00, 2026-11-18)
- [x] The longer wait after End game for long games is **OK** (bryanken00, 2026-11-18)

## Design notes (as built)

- **When a game ends** (End game, End in Admin, or a booked end time), the API makes a
  `session_videos` row per camera (one-camera court: camera 0; two cameras: 1 and 2) and the
  box's `GET /device/jobs` returns a `type: "game"` job for each, with the game's window. No
  5-minute pieces are made; the join job and ffmpeg on the server are gone.
- **Upload protocol** (`controllers/v1/device/game-videos.controller.js`, under
  `/api/v1/device/game-videos/:sessionVideoId`): `start` `{ sizeBytes, durationSeconds, gaps }` →
  `{ receivedBytes, chunkBytes: 8 MiB }` (same size resumes, a new size starts over);
  `PUT chunk?offset=N` raw bytes → `{ receivedBytes }`, or 409 `OFFSET_MISMATCH` with where to
  continue; `finish` (multipart, optional JPEG thumbnail) checks every byte is in and that it's an
  mp4, or 409 `INCOMPLETE_UPLOAD`; `fail { reason }`. The bytes on disk (`upload.part`) are the
  truth for resuming. Only the venue's boxes see a video (else 404); once one box started it,
  another is refused (409).
- **Footage on the box:** `/config` keeps listing a finished game while any of its videos is
  still `Pending`/`Uploading`, and the box keeps the footage for every listed game.
- **Giving up:** a video not in 24 h after the game ended (`GAME_UPLOAD_GIVE_UP_HOURS`) is Failed
  by the hourly maintenance, so the game settles. **Try again** in Admin puts it back to Pending
  and the game back to Processing (works while the box still has the footage).
- **Progress:** `uploadPercent` (0–100, null while the box makes the file) on the public, admin
  and app session responses; the missing-footage note comes from the gaps the box reports.

## Revisions

- 2026-11-18: Open questions answered — copy, no fallback (nothing deployed yet), longer wait OK.

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-18 | "now implement this" |
| Signed off — Done | bryanken00 | 2026-11-20 | Bulk sign-off by the requester ("check all CR and plan… mark all complete"); acceptance items ticked on that sign-off, not re-checked one by one |
