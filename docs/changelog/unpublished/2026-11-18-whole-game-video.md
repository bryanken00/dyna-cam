---
type: improved
impact: minor
audience: user
ref: CR-003
---

A recorded game now reaches players as **one video for the whole game**, and **Download** saves a
single file. On a court with two cameras, players get a separate full-size video for each camera,
with **Cam 1** and **Cam 2** buttons on their page. While the game is recording, the page simply
says so; after **End game** the court's recorder sends the game, and the page shows "Saving your
game… uploading 45%", then the video. A dropped connection picks up where it stopped instead of
starting over. Game videos are the camera's own full quality (60-second replays still carry the
venue logo; game videos don't). If the camera missed a stretch, the video skips it and the page
says how many minutes and when ("8 minutes weren't recorded (11:23 – 11:31 AM)"). Staff see each
camera's video, its upload progress and a **Try again** button in Admin → Sessions. With Google
Drive connected, the game's folder gets the whole video. 60-second replays are unchanged.

## Dev notes

- `back/`: run `npm run db:migrate` (migrations `016_whole_game_videos` and
  `018_game_file_uploads`: `session_videos` with upload progress). Games recorded before keep
  their parts.
- `back/`: no ffmpeg is needed on the API server. New settings (optional): `GAME_VIDEO_MAX_MB`
  (largest game file, default 16384) and `GAME_UPLOAD_GIVE_UP_HOURS` (default 24: an unsent game
  video is then failed). The API stores a game while it arrives, so leave room for the largest
  games (about 0.5–0.9 GB per camera per hour).
- `back/`: after a game ends, `/device/jobs` returns a `type: "game"` job per camera; the box
  uploads with `POST /device/game-videos/:id/start`, `PUT …/chunk?offset=N`
  (`application/octet-stream`, 8 MB), `POST …/finish`, `POST …/fail` (CR-006). Retry
  (`POST /admin/sessions/:sessionId/videos/:camera/retry`) asks the box to send a failed video
  again. Public, admin and app session responses carry `videos[]` and `uploadPercent`; no parts.
- `edge/`: **update every venue's recorder box** (no older boxes are deployed yet). After End
  game it copies the game into one file per camera (no re-encoding) and uploads it in resumable
  chunks; it keeps a game's footage until it's sent. Plan disk for the longest games.
- `app/`: the session device's end screen shows "Saving your game… uploading N%". JavaScript
  only: an over-the-air update, no new store build.
- `edge/` (BUG-003): the game file drops the empty H.264 units some cameras send (Android RTSP
  camera apps), which otherwise made the video grey and unplayable. Still a copy, no re-encoding.
