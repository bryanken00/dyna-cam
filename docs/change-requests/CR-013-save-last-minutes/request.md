# CR-013 · Save the last few minutes of a game from the courtside device

> **Status:** In progress · **Requested:** 2026-11-19 · **Requested by:** bryanken00 · **Size:** L
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** CR-005 (pairing starts the game), CR-006 (one file per game), CR-012 (app look)

## Requested change

During a game, the paired phone or tablet lets players pick how many minutes to keep and tap
Save. "0 mins ——— 10 mins: you select 2 mins at 10 mins, then it makes a separate copy, from 8
mins to 10 mins." Each save is its own video, on top of the whole-game video.

## Today

- The whole game is saved as one video per camera after End game (CR-006).
- A 60-second replay can be saved from the court's QR code or button, but the courtside device
  can't save anything, and nothing longer than 60 seconds can be saved during a game.

## Why

Players want a short video of a great stretch of play (a long rally, a comeback) without waiting
for and scrubbing through the whole game.

## Scope

**In**

- On the courtside device during a game: a "Save the last …" slider in 15-second steps from 1
  minute up to the time played so far, showing the stretch it covers (e.g. 8:00 – 10:00), and a Save button.
- Each save makes a separate video of that stretch, one per camera on a two-camera court, made
  like the whole-game video (a copy of the camera footage: full quality, no logo, ready fast).
- Free, part of the game (decided 2026-11-19).
- The device lists the saves with their progress, and plays a finished save right there
  (preview, Cam 1 / Cam 2 on a two-camera court); the game's page (the QR link) lists them under
  the whole game, ready to watch and download. They go to the court's Google Drive like the
  game, and expire with the venue's retention period.
- Admin → Sessions shows them on the game.

**Out**

- Saving a stretch that isn't the latest (e.g. 3:00–5:00 when it's 10:00 now).
- Saves after the game has ended.
- A price for saves.

## Acceptance criteria

- At 10 minutes into a game, choosing 2 minutes and tapping Save makes a video of 8:00–10:00 of
  the game; the device shows it saving, then ready.
- A two-camera court gives one video per camera for each save.
- The game's page lists every save with its stretch of the game, and plays and downloads them.
- The whole-game video still arrives after End game, and the game finishes as before.
- Saving is refused before the first minute, after the game ends, and once the game has 5 saves.
  A save tapped while another is being made waits its turn ("In queue"); a double tap doesn't
  make a second one.
- Each save can be deleted from the device; it disappears from the game's page and frees a slot.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Courtside app: the game screen. Web: the player's game page, Admin → Sessions detail. |
| Data | Migration `020`: new `session_captures` table; `session_videos.captureId` (NULL = the whole game) and a new unique key (one video per camera per save). |
| Build / rollout | App: JavaScript only (next app update). **No recorder box change**: a save is the same "copy this stretch" job the box already does for whole games. Boxes need CR-006 ("game-file"). |
| Permissions | None. The device can only save on its own game. |
| Existing users | Nothing changes for games that don't use it. |
| Size | L: schema, API (device save, jobs, game page, Admin), whole-game logic made to ignore saves, the app's slider and list, the player page, tests. |

## Open questions

- [x] Cap on saves: 5 per game at once, deleting frees a slot (2026-11-19). Length: up to the whole
      game so far.

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-19 | Asked directly; copy like game videos, free |

## Revisions

- 2026-11-19: The length moves in **15-second steps**, still from a 1-minute minimum (requester:
  "Can we add by 15secs? but minimum is 1min?"): 1 min, 1 min 15 s, 1 min 30 s, … The API already
  took any length in seconds from 60.
- 2026-11-19: After trying it on a phone (requester): **no "Just saved" refusal** — saves queue
  instead (the box makes them one at a time; the device and the game page say "In queue"), and a
  double tap returns the save already made; **at most 5 saves** per game; a **delete button** on
  each save (soft delete: its videos and files go, the box stops making it, a pending Drive copy is
  skipped). "Saving 100%" while the box finishes the file now reads "Finishing…" (99%).
- 2026-11-19: **Preview on the device** (requester: "add preview on app what they save"): a
  finished save shows its picture in the list; tapping it opens a player on the device with the
  saved video (native controls, Cam 1 / Cam 2 on a two-camera court). No API change — the device
  already receives each save's signed video and picture links.
- 2026-11-19: **Game minutes under the preview** (requester: "add minute on below that can adjust on
  preview"; chosen: jump within the video, viewing only). Below the video: a scrubber labelled in
  game time (8:00 … 10:00, "now at 9:12 of the game"), −15 s / play-pause / +15 s; drag or tap the
  scrubber to jump. The save itself doesn't change.
- 2026-11-19: **Maximum saves per game on New game** (requester: "add here maximum clip. by default
  5"): staff choose 1–20 when creating a game (default 5); the device's "N of M saves" and the
  limit follow it. Games created without it (older ones, booked ones) keep `CAPTURE_MAX_PER_GAME`.
  Migration `022`.
