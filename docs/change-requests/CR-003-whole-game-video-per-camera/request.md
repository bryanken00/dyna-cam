# CR-003 · Whole-game video, one per camera

> **Status:** Done · **Requested:** 2026-11-18 · **Requested by:** bryanken00 · **Size:** L
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — (design notes in the checklist) · **Related:** [PLAN-001](../../plans/PLAN-001-court-replay-cameras/plan.md) (sessions in 5-minute parts), [PLAN-002](../../plans/PLAN-002-setup-menu-device-pairing/plan.md) (whole-game recording from the phone, second camera), [CR-001](../CR-001-google-drive-per-court/request.md) (Google Drive copies)

## Requested change

> Can we make it not part? Just whole video. It must be Cam 1? Cam 2? if multiple cam installed.

A recorded game should reach the player as **one video for the whole game**, not as a list of
5-minute parts. The must-have, in the requester's words:

> Just 1 want is: if user download the video, it's not part by part. I mean whole video.

So **Download** always gives one file of the whole game. On a court with two cameras, the player gets **one whole video per camera**:
"Cam 1 – whole game" and "Cam 2 – whole game".

## Today

- A game (a "session") is split into **5-minute parts**. The recorder box cuts and uploads each
  part when its five minutes are over. The player's page lists every part, each with its own
  video and **Download part N** button. A 1-hour game is 12 parts.
- On a court with **two cameras**, every part (and every 60-second replay) is **stacked**: Cam 1 on
  top, Cam 2 below, in one tall video.
- With Google Drive connected (CR-001), the parts go into a folder for the game.

**Why parts exist.** The box uploads over the venue's internet line. A 3-hour game is about 1.7 GB
per camera; as one upload, any hiccup near the end would start it over, and it is far above the
server's 100 MB upload limit. Five-minute parts (≤ ~47 MB each) upload and retry one at a time.

## Suggestions

### 1. Keep the parts behind the scenes; the server joins them into one video ✅ recommended

- The box keeps cutting and uploading 5-minute parts, so uploads stay safe on a weak line.
- When a camera's last part is in, the **server joins its parts into one video**. Every part is
  encoded with the same settings, so joining is a plain copy: a few seconds even for 3 hours, and
  no loss of quality.
- If a part couldn't be saved (camera offline), the whole video skips that stretch and the page
  says so, e.g. *"No footage 10:40–10:45 (camera offline)"*.
- After a successful join, the part files are deleted so the game isn't stored twice. If a join
  fails, the parts stay and staff see the error.

Alternatives considered:

| Option | Why not |
| --- | --- |
| The box uploads one big file at the end | One weak-line hiccup restarts a 1.7 GB upload; needs a much bigger upload limit and resumable uploads; the video only starts uploading after the game. |
| Play the parts back to back on the page, no joining | Looks like one video on the page, but **Download** would still give parts, and Google Drive would still get parts. |

### 2. Two cameras: separate Cam 1 and Cam 2 videos ✅ recommended

| Option | What players get | Notes |
| --- | --- | --- |
| **A. Separate videos** ✅ | "Cam 1 – whole game" and "Cam 2 – whole game", full size, with **Cam 1 / Cam 2** tabs on the page | Easier to watch on a phone; each file is about one camera's size; no stacking work on the box. |
| B. Stacked, as today | One tall video with both views | One file, but each view is half the height on a phone. |
| C. Both | Cam 1, Cam 2 **and** stacked | Most choice; about double the storage, processing and upload. |

A court with one camera gets one whole video; nothing changes for it except "no parts".

### 3. What the player sees while the game is still going ✅ recommended

The whole video only exists after the game ends plus the last part's processing (usually within
15 minutes). Until then:

- **Recommended:** show the parts made so far under *"So far"* (as today), with *"The whole video
  appears here about 15 minutes after the game ends."* When it's joined, the parts disappear and
  the whole video takes their place.
- Simpler: show only *"Saving your game… 3 of 12 parts in"* until the whole video is ready.

### 4. Out of this change (recommended)

- **60-second replays stay as they are** (stacked on two-camera courts).
- Live views and live streams don't change.

## Scope

**In** (if the recommendations are accepted)

- Whole-game video per camera, joined on the server from the 5-minute parts.
- Two-camera courts: whole-game parts cut **per camera** instead of stacked.
- Player's game page: one video per camera (tabs when there are two), **Download**, **Share**,
  a note for missing stretches, and the "so far" parts while the game is going.
- Admin → Sessions: the whole video(s) per camera, join status, and a **Try again** for a failed
  join.
- Google Drive (CR-001): the game's folder gets the whole video per camera instead of parts.

**Out**

- 60-second replays (stay stacked), live views and live streams.
- Games recorded before this change (they keep their parts).
- Editing or trimming the whole video.

## Acceptance criteria

- A 1-hour game on a one-camera court shows **one** video on the player's page, about 15 minutes
  after it ends, and **Download** saves **one file of the whole game**, never separate parts.
- On a two-camera court, the page has **Cam 1** and **Cam 2** tabs, each with its own whole-game
  video, both full size (not stacked).
- If the camera was offline for a stretch, the whole video skips it and the page names the
  missing time.
- While the game is still going, the page shows the parts made so far, then switches to the whole
  video on its own.
- 60-second replays look exactly as before.
- With Google Drive connected, the game's folder holds one file per camera, not parts.
- A 3-hour game plays on a phone without downloading the whole file first.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Web: player's game page (rebuilt around one video per camera), Admin → Sessions detail. App: none required (the session device's "Saving your game… N of M parts" keeps working; optional wording tweak). |
| Data | New migration: whole-game videos per session and camera (status, file, size, length, missing stretches, retention, Drive copy); a `camera` column on session parts (unique per session + part + camera). Existing games keep their parts. No local SQLite. |
| Build / rollout | **Recorder box update at every venue**: it must cut session parts per camera instead of stacked. An old box keeps working: the API only asks for per-camera parts from a box that reports the new version, and joins old stacked parts into one stacked whole video. **Server:** needs **ffmpeg** installed (`sudo apt install ffmpeg`) and free disk for one extra copy of a game while joining (up to ~1.7 GB per camera for 3 h). No app build. |
| Permissions | None new: Sessions' permission for the Admin side; the share link for players. |
| Existing users | Players see one whole video instead of parts (better, not breaking). Staff downloading individual parts from Admin get the whole video instead. Not breaking. |
| Size | L: box (per-camera parts), API (join job with ffmpeg, new table, endpoints, tests), player page and Admin, Google Drive. About 4–5 days; a plan is written before building. |

## Open questions

- [x] **Suggestion 1** (server joins parts into one video): **yes**. The must-have is that
      **Download gives one whole-game file**, never part by part (bryanken00, 2026-11-18)
- [x] **Suggestion 2** (two cameras): **A, separate Cam 1 / Cam 2 videos** (bryanken00, 2026-11-18, as recommended)
- [x] **Suggestion 3** (during the game): **show the parts "so far"**, replaced by the whole video (as recommended)
- [x] Part files after joining: **deleted** (as recommended)
- [x] Replays: **unchanged** (as recommended)
- [x] ffmpeg on the server: **yes**

## Revisions

- 2026-11-18: Suggestion 1 accepted; the must-have is one whole-game file on Download.
- 2026-11-18: The rest accepted as recommended; approved and started.
- 2026-11-18: First real game (Court 1): once a camera's whole video is made, its failed parts no
  longer show under "So far" — the video's "No footage …" note already covers them.

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-18 | "ok start implementing" — recommendations accepted |
| Signed off — Done | bryanken00 | 2026-11-20 | Bulk sign-off by the requester ("check all CR and plan… mark all complete"); acceptance items ticked on that sign-off, not re-checked one by one |
