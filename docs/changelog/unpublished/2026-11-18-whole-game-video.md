---
type: improved
impact: minor
audience: user
ref: CR-003
---

A recorded game now reaches players as **one video for the whole game** instead of a list of
5-minute parts, and **Download** saves a single file. On a court with two cameras, players get a
separate full-size video for each camera, with **Cam 1** and **Cam 2** buttons on their page.
While the game is still going, the page shows what's recorded so far, and the whole video replaces
it shortly after the game ends. If the camera missed a stretch, the video skips it and the page
says when. Staff see the whole video, its status and a **Try again** button in Admin → Sessions.
With Google Drive connected, the game's folder gets the whole video instead of parts. 60-second
replays are unchanged.

## Dev notes

- `back/`: run `npm run db:migrate` (migration `016_whole_game_videos`: `session_videos`,
  `clips.camera` / `clips.joinedAt`, `recording_sessions.partCameras` / `wholeVideo`). Games
  recorded before it keep their parts.
- `back/`: **install ffmpeg on the API server** (`sudo apt install ffmpeg`), or set `FFMPEG_PATH`.
  Without it, games longer than one part stay as parts. Joining needs free disk for one extra
  copy of a game while it runs (up to ~1.7 GB per camera for 3 h).
- `back/`: new job `jobs/sessionJoin.js` (every 20 s); new
  `POST /admin/sessions/:sessionId/videos/:camera/retry`; the public and admin session responses
  gain `videos[]`; device jobs carry `camera`; the heartbeat accepts `capabilities`.
- `edge/`: **update every venue's recorder box**. It now cuts whole-game parts per camera on a
  two-camera court and reports the `session-part-camera` capability. Boxes not yet updated keep
  working: their two-camera games are joined as one stacked whole video.
- `app/`: no change.
