# CR-004 · Players never see parts — one game, one video

> **Status:** Done · **Requested:** 2026-11-18 · **Requested by:** bryanken00 · **Size:** S
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [CR-003](../CR-003-whole-game-video-per-camera/request.md) (whole-game video per camera — this finishes its player side), [BUG-002](../../bug-reports/BUG-002-camera-lock-reconnect-loop/bug.md) (camera locking)

## Requested change

> Can we remove the part? Just straight video without parting out? Stop if stop on app or on CMS.

The requester wants a game to be **one straight video** that ends when staff press **Stop** on
the session device (app) or **End** in the Admin portal (CMS), with no "parts" anywhere.

This CR is the suggested way to get there: **players and the session device never see a part**.
They see "Saving your game…" and then one whole video per camera. The 5-minute pieces stay
inside the recorder box and the server only, as safe upload chunks.

## Today

Since CR-003 (not released yet):

- A game is already **one video per camera**, and **Download** saves one file.
- **Stop** on the session device and **End** in Admin already end the recording at that moment;
  the whole video is made from what was recorded.
- Parts still show in a few places:
  - the player's game page lists the pieces recorded so far under **"So far"** while the game is
    going and while the whole video is being made, each with its own player and
    **Download part N**;
  - the session device's end screen says **"Saving your game… 2 of 5 parts"**;
  - when footage is missing, the game's note says **"2 of 3 parts could not be saved"** (the
    session device, Admin, and the player's page all show it);
  - the page's text during recording says what's recorded "shows below every 5 minutes".

## Why

To a player, a game is one video. "Parts" is an internal detail; showing it, or a list of
5-minute videos while the game is going, reads as if the game was cut up.

**Note on the lost footage seen on 2026-11-18:** the parts weren't the cause. On that day the Tapo
camera ended its stream by itself about 6 minutes after each connection, refused all connections
for 5+ minutes ("400 Server is locked"), then stopped answering. That's being looked at
separately (camera firmware, Third-Party Compatibility setting, power; a 10-minute VLC test
without Dyna Cam). A straight, unsplit recording would have had the same gaps.

## Suggestion

| Where | Today | Requested |
| --- | --- | --- |
| Player's game page, while recording | "Recording now", then the pieces so far, one per 5 min | "Recording now — your whole game appears here as one video when it ends." No videos until the end. |
| Player's game page, after Stop / End | Pieces "So far" until the whole video is made | "Saving your game… 25 of 30 minutes saved" with a progress bar, then the whole video |
| Session device end screen | "Saving your game… 2 of 5 parts" | "Saving your game… 25 of 30 minutes saved", then "Ready — scan to download" |
| Missing footage note | "2 of 3 parts could not be saved" | "8 minutes weren't recorded (11:23 – 11:31)" |
| Admin → Sessions | Parts list + Whole video | Unchanged: staff keep the parts for troubleshooting |

### Alternative considered: the box records one single file

The recorder box would keep the whole game on disk and upload one file after Stop. Not
recommended now:

- **Same gaps.** A camera drop-out leaves the same hole in one file as in parts.
- **Risky upload.** A 1-hour game is about 0.5–0.9 GB per camera; one hiccup restarts the upload
  unless uploads are made resumable.
- **Slower.** The video can only start uploading after Stop; with parts, most of it is already on
  the server when the game ends.
- **Cost.** Resumable uploads on box and API, a much larger upload limit, and new disk rules on
  the box: about 2–3 days.

**Parked** (2026-11-18): it can be its own CR later if a venue's upload line proves fast and
stable enough.

## Scope

**In**

- Player's game page: no part list or part downloads at any time; progress while saving; one
  video per camera at the end (the CR-003 tabs and Download stay).
- Session device (app) end screen: progress without the word "parts".
- Missing-footage wording in minutes and times, wherever the game's note shows.
- Part fallback: if a whole video can't be made (join failed), the player sees "We're still
  putting your video together — check back soon", and staff use **Try again** in Admin. No part
  list for players.

**Out**

- How the box records and uploads (still 5-minute pieces behind the scenes).
- Admin → Sessions part list (stays for staff).
- 60-second replays.
- The camera drop-outs (separate investigation; a bug report if Dyna Cam turns out to be the
  cause).

## Acceptance criteria

- During a game, the player's page shows "Recording now" and no videos.
- After Stop on the session device or End in Admin, the page shows "Saving your game…" with
  progress, then one video per camera with one Download each.
- The session device's end screen never mentions parts.
- A game with missing footage says how many minutes and which times, not "parts".
- If the whole video can't be made, the player sees a "check back soon" message (no parts), and
  staff can **Try again** in Admin.
- Staff still see the parts in Admin → Sessions.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Web: player's game page. App: session device end screen (text only). Admin: missing-footage wording only. |
| Data | None (no migration). The API adds a "saved so far" figure in minutes/percent and words the missing-footage note in minutes. |
| Build / rollout | Web build; the app change is JavaScript only (over-the-air update, no new store build). No recorder box update. |
| Permissions | None. |
| Existing users | None released yet (CR-003 is unreleased). |
| Size | S: about half a day to a day. |

## Open questions

- [x] During the game: **nothing yet**, only "Recording now" (bryanken00, 2026-11-18)
- [x] Progress: **minutes saved**, e.g. "Saving your game… 25 of 30 minutes saved" (bryanken00, 2026-11-18)
- [x] Single-file recording: **parked** as a possible later CR (bryanken00, 2026-11-18)

## Revisions

- 2026-11-18: Open questions answered as recommended (nothing during the game · minutes saved ·
  single file parked).

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-18 | "implement this all now" |
| Signed off — Done | bryanken00 | 2026-11-20 | Bulk sign-off by the requester ("check all CR and plan… mark all complete"); acceptance items ticked on that sign-off, not re-checked one by one |
