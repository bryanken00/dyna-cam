---
name: edge-conventions
description: The non-negotiable conventions for the Dyna Cam recorder box in edge/ (Node 20 + ffmpeg, run under pm2 at each venue) — module layout, the device API contract (/api/v1/device, Device token, User-Agent, envelope, 401/404/409 handling), the rolling-buffer recorder (stream-copy video, AAC audio, RTSP over TCP, credential masking), segment timing (segments.csv + mtime anchor, irregular keyframe-cut segments), clip cutting/watermark/encoder rules, the LAN court-button listener and press relay, session retention and whole-game files (stream copy + resumable chunked upload), two cameras per court (per-camera recorders, stacked clips), every live stream as a restream of the box's own live view (venue court streams and players' own, Cam 1 / Cam 2 / stacked), the signed LAN HLS live view for session devices, camera-setup details and previews, enrolment from .env (ENROLL_KEY + VENUE_ID) and revoked boxes, the persisted job queue, and the verification commands. Load BEFORE writing, editing, reviewing or explaining anything under edge/ — recorder, clipper, jobs, buttons, api client, config, tests, smoke script, pm2 or .env files.
---

# Edge conventions (`edge/`)

Node 20.12+ · plain ESM JavaScript · **no runtime dependencies, never add one** · ffmpeg 5+ · pm2 ·
`node:test`. The box records each court's RTSP camera into a rolling buffer and cuts the replays
players save. API calls are **outbound** only; the two listeners are LAN-only (court buttons, live view); player streams push RTMP(S) out.
Context: PLAN-001 ("Recorder box"); server half: `back/server/src/controllers/v1/device/`.

## Module layout (`src/`)

| File | Owns |
| --- | --- |
| `config.js` | `.env` → frozen settings; `ConfigError` for anything missing or invalid (`ENROLL_KEY` ≥ 32 + `VENUE_ID` required until `device.json` exists); `USER_AGENT`, `AGENT_VERSION`; warnings for leftover `DEVICE_TOKEN` / `PAIRING_CODE` |
| `credentials.js` | Token: `device.json` (0600) → enrol once with `ENROLL_KEY` + `VENUE_ID` + `BOX_NAME` (`POST /pair/enroll`, no auth); refused pairs remembered as hashes (`enroll-refused.json`); revoked → `revoked.json`, no re-enrol (PLAN-002 Phase I) |
| `api.js` | The only place that calls `fetch`. Auth header, UA, timeouts (AbortController), envelope unwrap, `ApiError` |
| `recorder.js` | One ffmpeg per court **camera** (`CourtRecorder`; camera 2 in `buffer/<safeId>~cam2`), restart/backoff, stall watchdog, pruning, heartbeat status with `camera` (`RecorderManager`) |
| `segments.js` | Segment files → wall-clock time line (`segments.csv` + `index.json` + `run.json`) |
| `clipper.js` | Pure window and selection math, `planClip` (stacked or one camera, wait/fail/cut), `jobCamera`, ffmpeg argument builders, encoder detection, `pinSegments`, `cutClip`, `makeClip` |
| `game.js` | Whole-game videos (CR-006): `planGame` / `selectGameSegments` (gaps, duration), concat-copy args, `makeGameFile`, and `uploadGameFile` (start → chunks → finish state machine) |
| `jobs.js` | Long-poll → persist → claim → cut → upload / fail, with backoff (`JobRunner`); game jobs in their own lane (copy → resumable upload) |
| `queue.js` | `data/queue.json`: atomic, ordered writes |
| `buttons.js` | LAN listener `GET\|POST /press/:code[?key=]`: stamp `Date.now()` first, 202 at once, code regex, constant-time key, 3 s debounce |
| `restream.js` | Every live stream (`Restreams`): venue court streams + players' own, one ffmpeg each reading the box's live HLS on 127.0.0.1; CAM1/CAM2 copied, STACKED encoded; backoff, status, caps, heartbeat `sessionStreams` + camera 1's `streamStatus` |
| `live.js` | LAN live view (HTTP, or HTTPS with `CERT_PATH`) `GET\|HEAD /live/:courtId/[cam2/]{index.m3u8,<epoch>.ts}?exp&sig`: signed HLS of the newest closed segments, timestamp shift, `live-key`, LAN address, heartbeat `live` |
| `stream.js` | Stream-key masking (`maskStreamKey`, `maskStreamUrl`) and `parseLogLine` |
| `camera.js` | Setup: `video`/`audio` for the heartbeat (`MediaProbe`) + preview JPEGs (`PreviewSender`) from the latest CLOSED segment |
| `sync.js` | `/config` refresh, logo download, config cache, heartbeat timer, clock-skew warning, heartbeat `system` |
| `health.js` | The box's own health for the heartbeat (CR-008): disk, memory, load, uptime, clock offset, upload backlog |
| `ffmpeg.js` | `runFfmpeg` (arg array, timeout, abort), `probeVideo`/`probeFile`, version parse |
| `log.js` / `util.js` | Logger (masks every line); `maskCredentials`, `safeId`, `backoffMs`, `sleep`, atomic JSON |
| `index.js` | Wiring and graceful shutdown only |

Pure functions + injected side effects (`api`, `clip`, `spawnImpl`, `now`): `test/` needs no ffmpeg or internet.

## Device API contract (don't change it from here)

- Base `${API_URL}/api/v1/device`. Every request sends `Authorization: Device <token>` **and**
  `User-Agent: DynaCamRecorder/<version>`. The API returns 403 for a missing UA or one containing
  bot, crawler, spider or scraper.
- Envelope → `data`; failures throw `ApiError` (`status` 0 = no answer).
- Errors: **404/409** clip gone or done → drop (game uploads: see below — a 409 may be a resume). **401**: the box was revoked — stop all work, delete
  device.json + config cache, write `revoked.json` (`{ revokedAt, deviceId, name }`, 0600), log "This box was
  revoked — delete …/revoked.json (and check .env) to enrol it again", wait 1 min, exit 1. **429** →
  `Retry-After`. **0/5xx** → exponential backoff. Other 4xx on upload → `POST /fail` with `Upload rejected: <detail>`.
- Enrolment (`POST /api/v1/pair/enroll { enrollKey, venueId, name?, agentVersion }`, no auth, same UA) →
  201 `{ token, device, venue }` → device.json. **400/422** final: hash of (key, venue) kept, never resent
  until `.env` changes. **403** (`ENROLLMENT_DISABLED`) / **404** → retry every 5 min. **429** → `Retry-After`
  or 60 s. 0/5xx → backoff 2 s → 5 min. Never enrol while `revoked.json` exists (log, wait 1 min, exit 1).
  A person-must-act exit always waits a minute first (pm2 `restart_delay` is only 5 s).
- Never log a token or key: `dcb_…` masked; `ENROLL_KEY` is `registerSecret`ed so `maskCredentials`
  (every log line) hides it.
- `logoUrl` is signed and **relative** (`new URL(logoUrl, API_URL)`, token only to the API's own
  origin); re-download only when its path (without the query) changes.
- Use `requestedAtMs`, never parse `requestedAt`; a clip job > 15 min old is failed server-side →
  drop. Claim is best-effort but exclusive (another box's claim → 409 → drop).
- **No session parts** (CR-006): clip jobs never carry `sessionId`/`partIndex`; a clip job that does
  is ignored, and one left in an older box's `queue.json` is dropped at start-up with a log line.
  60 s clips are always "the box chooses": both cameras stacked on a two-camera court, else the one
  with footage (`planClip`); a clip's `camera` field is ignored.
- **Game jobs** (CR-006): `GET /jobs` also returns `{ type: "game", sessionVideoId, sessionId, courtId,
  camera, windowStartMs, windowEndMs }` — the window is the whole game, or (CR-013) a "save the last N
  minutes" from the courtside device, which ends at the moment of Save, often while the game is still
  recording; nothing on the box treats them differently, repeated on later polls until finished — dedupe by
  `sessionVideoId` (queue key `game:<id>`). `camera` 0 = the court's only camera (camera 1's buffer),
  1/2 = that camera only (`jobCamera`), never stacked, never the other camera. Wait until `windowEndMs`
  is in a closed segment (or ≥ 60 s past it), then **stream-copy** (see ffmpeg rules) into
  `jobs/<safeId(sessionVideoId)>/game.mp4` + `thumb.jpg` (~1 s in; a failed thumbnail is only logged).
  Holes ≤ 7 s are held frames; longer ones are left out and reported as `gaps: [{ startMs, endMs }]`;
  `durationSeconds` = window − gaps (integer). No footage → `POST /game-videos/:id/fail` "Camera N was
  not recording during this game" (camera 1/2) / "The camera was not recording during this game" (0);
  a camera-2 job on a court without camera 2 in `/config` and no camera-2 footage → at once "This
  court has no camera 2". `planGame` decides.
- **Resumable upload** (`uploadGameFile`): `POST /game-videos/:id/start { sizeBytes, durationSeconds,
  gaps }` → `{ receivedBytes, chunkBytes }` (8 MiB; same size resumes, a different one restarts at 0) →
  `PUT /game-videos/:id/chunk?offset=N` (`application/octet-stream`, bytes `[N, N+len)` read with a
  file handle at the offset — never the whole file in memory) → `{ receivedBytes }`; 409
  `OFFSET_MISMATCH` + `data.receivedBytes` → continue from there → `POST /game-videos/:id/finish`
  (multipart, optional `thumbnail` `image/jpeg` `thumb.jpg`) → `{ status: "Ready" }`; a 409 with
  `data.receivedBytes` < size → send chunks from there. 404 or any other 409 → drop job + folder.
  0/5xx/timeout → backoff 5 s → 5 min and resume via `/start` (never from zero); 429 → `Retry-After`;
  401 → the revoked flow; other 4xx → `/fail` "Upload rejected: <detail>". `ApiError.data` carries the
  error envelope's `data`.
- **Game lane:** one game job at a time (`limits.game = 1`), sorted after clips; before every chunk it
  waits while a clip is uploading or ready to upload (`clipsFirst`). `UPLOAD_CONCURRENCY` is clips only;
  game jobs don't make the box "busy" for previews. Phase persisted in `queue.json`: `waiting` →
  `copying` → `uploading` → `finishing` (+ `failing`). Restart: `copying` → `waiting`; `uploading`/
  `finishing` with the file → resume via `/start`; without it → `waiting` (copied again). The folder
  goes after `/finish` or a drop.
- Heartbeat `system` (CR-008, `health.js` `sampleHealth`, optional on the API): `diskFreeMb`/`diskTotalMb`
  (`fs.statfs` of `DATA_DIR`), `memFreeMb`/`memTotalMb`, `load1`, `cpus`, `uptimeSeconds`, `clockOffsetMs`
  (server − box, from `/config` and the heartbeat reply's `serverTime`), `pendingClips`/`pendingGames`/
  `oldestPendingSeconds` (presses don't count). Whole non-negative numbers (`load1` and `clockOffsetMs`
  aside); a value that can't be read is left out, a failed sample sends the heartbeat without `system`.
- Heartbeat body always has `capabilities: DEVICE_CAPABILITIES` (`config.js`; today `["game-file"]`).
  `/config` `sessions` keep their segments (± 10 s) **for as long as they are listed** — the API keeps a
  finished game listed until its videos are uploaded, so there is no box-side cut-off
  (`retentionWindows`); dropped below `DISK_CRITICAL_MB` so recording never stops.
- Button press: `POST /buttons/:code/press {pressedAtMs}` → 201/200 (merged), queued (`state: "press"`),
  retried while < 100 s old (API refuses > 120 s); 404/409/422/400 final, logged in words.
- Setup (PLAN-002): heartbeat entries add `video {codec,width,height,fps}` + `audio {codec,sampleRate}|null`
  (probed ≤ every 30 s, counted fps beats the claim) + the running recorder's `cameraVersion` + `camera: 1 | 2`
  (one entry per camera). `/config` court `previewWanted` → one JPEG per camera per ~30 s to
  `POST /courts/:id/snapshot` (`snapshot`, ≤ 3 MB; `?camera=2` for camera 2), skipped while clips are
  busy; config/heartbeat every 15 s meanwhile; 404 → stop that camera.
- Two cameras (PLAN-002 §7): `/config` courts `camera2RtspUrl` + `camera2Version` (null = none),
  `stream: { rtmpUrl, layout } | null`; sessions `stream: { url, layout } | null`. `layout` ∈
  CAM1/CAM2/STACKED; missing/unknown → CAM1; CAM2/STACKED without camera 2 → CAM1.
- Clip upload: multipart `video` (`video/mp4`, `*.mp4`) + optional `thumbnail` (`image/jpeg`, `*.jpg`) via `fs.openAsBlob`. Fail reasons ≤ 255 chars (`truncate`).

## ffmpeg rules

- **Always an argument array through `spawn`, never a shell string.**
- **The ring buffer is never re-encoded.** Recorder output options are
  `-map 0:v:0 -map 0:a? -c:v copy -c:a aac -b:a 64k`. Tapo cameras send G.711 A-law, which
  `-c copy` into MPEG-TS silently stores as unplayable `bin_data`. Never use a blanket `-c copy`.
- RTSP: `-rtsp_transport tcp -timeout 10000000` (µs, ffmpeg ≥ 5; `-stimeout` on 4.x). No new
  video for 20 s → kill; restart backoff 2 s → 30 s — **except a refused sign-in** (BUG-002,
  `failureKind` + `restartDelayMs`): 401 → 2/5/10/15 min, 400 / "locked" → 5/10/15 min, counted
  separately and reset by a good run. Every try is a camera sign-in: quick retries lock a Tapo
  and keep it locked. A changed camera address still restarts at once.
- **Never `-use_wallclock_as_timestamps`**: it clumps frames that arrive together and the clip
  encoder drops them (half the frame rate). Keep the camera's timestamps.
- **Mask credentials** (`maskCredentials`) in every log line and heartbeat message — RTSP passwords
  and RTMP stream keys (≤ last 4 chars shown; `maskStreamKey` on every stderr line).
- **One RTSP connection per camera** (a C200 refuses a second): probes, previews and streams read
  the buffer (segment files / the live view). **The recorder has one output, the segment muxer —
  never a tee, never RTMP**; a stream change never restarts a recorder. Recorders log `level+warning`.
- No `drawtext` (missing in some builds). Watermark = image overlay, 12% width, bottom-**right**.
- Clip encode:
  - Concat demuxer with per-file `duration` = wall-clock spacing.
  - **Output-side** `-ss/-t`. Input-side seeking on concat started the video ~1.5 s late.
  - **Stacked** (2-camera court, both cover the window — else the camera that does, logged): one
    concat per camera, each `trim`med to the window in the filter (own offset) → 1280×720 (keep
    aspect, pad) at the slower fps → `vstack` → logo (`logoLayout(1280)`) → 1280×1440 (no 1080 cap),
    audio `atrim` from Cam 1 (Cam 2's if Cam 1 has none). `QUALITY.clipStacked` (max 4200k).
  - Scale to ≤ 1920×1080, end the filter with `format=yuv420p` (`nv12`/`hwupload` for QSV/VAAPI); `-c:a aac`, `+faststart`.
  - Bitrate caps (`QUALITY`): clips crf 23 / max 2300k (≤ 20 MB per 65 s). Hardware encoders use
    `-b:v` with the same maxrate. There is no session quality any more.
  - A failing hardware encoder → `libx264` once. `ENCODER=auto` test-encodes (listed ≠ working).
- **Game videos are never encoded** (CR-006): concat demuxer over the pinned segments →
  `-map 0:v:0 -map 0:a? -c:v copy -c:a copy -bsf:a aac_adtstoasc [-t <game end in the file>]
  -movflags +faststart -f mp4` (the buffer's audio is already AAC). No filter, no logo, no scaling, no
  cap. The list keeps `duration` = wall-clock spacing across holes ≤ 7 s and has **no** `duration`
  after a gap or on the last file, so gaps are left out. The start is the first segment's keyframe
  (no input-side trim with copy); `-t` cuts at the game's end.

## Live view (`live.js`, PLAN-002 §5.4)

- `LIVE_PORT` (8090; empty/0 = off) on `0.0.0.0`; a taken port warns and recording goes on. Never a camera connection, never encoding.
- `sig` = hex HMAC-SHA256(**the hex key string**, `${courtId}.${exp}`), `timingSafeEqual`; bad/expired → 403,
  bad path → 404 (court id `[A-Za-z0-9_-]{1,64}`, file `index.m3u8` or `^\d{9,11}\.ts$`, folder `safeId`), not GET/HEAD → 405.
  Never log the URL, `sig` or the key. Key: `DATA_DIR/live-key` (0600, made once).
- Playlist: newest 5 CLOSED segments, VERSION 3, TARGETDURATION = ceil(longest), no ENDLIST, `no-store`.
  MEDIA-SEQUENCE: first numbered segment = its name (epoch s), then +1 per segment (never goes back,
  even after a restart); DISCONTINUITY on a new run / gap / untimed file, with DISCONTINUITY-SEQUENCE.
  Newest closed segment > 30 s old → 404.
- Buffer files restart their clock at 0 (`reset_timestamps`): segments are served with PTS/DTS/PCR
  + the csv content start (90 kHz) — a Transform over `createReadStream`, in place, no remux.
- Heartbeat: `live: { url: "http(s)://<LIVE_HOST | first private IPv4>:<port>", key } | null`.
- HTTPS (CR-002): optional `CERT_PATH` (`privkey.pem`, `cert.pem`, optional `chain.pem`, the API's `certPath` layout) →
  LIVE_PORT is HTTPS, `url` is `https://`. One `createLiveHandler` shared by that server and a loopback-only plain-HTTP
  listener (127.0.0.1, ephemeral port) that `localPlaylistUrl` uses, so restreams never need TLS. Unreadable/unusable
  cert → warn, live view off, recording goes on. Warn on expiry or a cert not covering LIVE_HOST (or the detected IP).
  Renewals: file stamps checked every 6 h → `setSecureContext`; a broken one keeps the old. Buttons stay plain HTTP.

## Streams (`restream.js`, PLAN-002 §6.1, §7.3)

- **Every stream is a restream** of the box's OWN signed live playlist (`LiveView.localPlaylistUrl(courtId,
  exp, camera)`): the venue's court stream (`courts[].stream`, runs while the court is recorded, `exp` =
  now + 24 h) and a player's (`sessions[].stream`, in `[startMs, endMs)`, `exp` = end + 10 min); re-signed
  with a restart 1 min before expiry. Input `-extension_picky 0 -live_start_index -3 -re`.
  **Never** touch or restart the recorder, never a camera connection.
- CAM1/CAM2: `-map 0:v:0 -map 0:a? -c:v copy -c:a aac -ar 44100 -b:a 96k -f flv -flvflags no_duration_filesize`.
  STACKED: both cameras' playlists → each `scale=1280:720:force_original_aspect_ratio=decrease,pad,fps=<slower ≤ 30>`
  → `vstack` → `encoderSettings(<box encoder>, quality "stream")` (~3000k, no crf) + `-g 2·fps
  -force_key_frames expr:gte(t,n_forced*2)`; audio from Cam 1 (Cam 2's if Cam 1 has none) → AAC 44.1 kHz.
  One camera down → the other alone with a note; switches layout at most every 30 s (`planLayout`).
- Start/stop on window / stream added/removed / session gone; new url or layout → restart. Exit → backoff
  5 s → 60 s; no output 30 s → kill. Caps: 4 player streams (`MAX_SESSION_STREAMS`); `MAX_STACKED_STREAMS`
  (default 2) stacked across court + player streams → "Too many stacked streams on this box — choose Cam 1
  or Cam 2"; logged once. A failure never reaches recording, clips or the live server.
- Status from `-progress pipe:1`: `starting` → `live` after 5 s of moving output (pauses > 3 s reset) →
  `error` + `describeRestreamFailure(all error lines of the run)`. `LIVE_PORT=0` → error "Live view is off
  on this box (LIVE_PORT=0)".
- Heartbeat: players' in `sessionStreams: [{ sessionId, status, message }]` (`[]` when none); the venue
  stream's as `streamStatus`/`streamMessage` on camera 1's `cameras[]` entry (`off` when none). Config +
  heartbeat every 15 s while a player stream is due. Every stderr line → `maskRestreamLine` (key, URL,
  `sig=`) before use; the config cache drops sessions' `stream`.

## Segment timing (`segments.js`)

Segments are cut on keyframes (1.7–6.1 s seen) and the `%s` name is only when the file opened.
A closed segment's real span = **content times** from `segments.csv` (from 0 per ffmpeg run) +
the run's **anchor** (smallest `mtime − content end` within ±120 s of that run).

Rows merge into `index.json` keyed by the run id in `run.json` (written before each spawn; merged
before every restart, as ffmpeg truncates the list). No row → name → mtime. The file still being
written is never used. Clips tolerate holes ≤ 7 s; the window must end in a closed segment.

## Data and state
`DATA_DIR` holds `buffer/<courtId>/` and `buffer/<courtId>~cam2/` (segments, csv, index, run, pid; camera 2's
pruned, kept for sessions and aged out like camera 1's), `jobs/<clipId>/` and
`jobs/<sessionVideoId>/` (segments hard-linked into `parts/` while ffmpeg reads them, so pruning can't
pull them away; a game folder keeps `game.mp4` + `thumb.jpg` until `/finish`), `queue.json` (clips,
game jobs with their phase, and button presses),
`config.json` (mode 600, holds camera passwords), `device.json` (0600, the token), `enroll-refused.json`
(hashes), `revoked.json` (0600, blocks enrolment until a person deletes it), `live-key` (mode 600) and `logo/`. Every JSON write is atomic
(`writeJsonAtomic`). Folder names from IDs go through `safeId`.

## Verification (run in `edge/` before reporting done)

```bash
npm run lint     # eslint (security plugin) + prettier-compatible; must be clean
npm test         # node:test — no network, no ffmpeg
npm run smoke    # ~2 min: two real recorders on ONE court (Tapo-like cam 1: pcm_alaw, irregular GOP;
                 # cam 2: 25 fps, no audio): stacked 65 s clip 1280x1440 (h264+aac, all frames,
                 # faststart, JPEG) + whole-game copies of one window (camera 0 and camera 2: h264,
                 # faststart, ≈ window, codec params = the recording, JPEG) uploaded to a local
                 # stand-in (forced OFFSET_MISMATCH + a dropped connection, bytes equal) + the live view played by
                 # ffprobe (clock never goes back, bad sig 403, /cam2/) + restreams to local RTMP:
                 # venue STACKED → CAM2 and a player CAM1, recorders never restarted
```

Unit-test every new pure function and API error path; report what can't be verified here (real cameras, QSV/VAAPI, load test).

## Related

- README: install, Tapo, setup preview, sessions, streaming, buttons, troubleshooting, load test. The server side is backend work; a contract change updates both sides.
- Shipped changes get a `changelog` entry; plans/CRs/bugs live in the repo-root `docs/`.
