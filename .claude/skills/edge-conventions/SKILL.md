---
name: edge-conventions
description: The non-negotiable conventions for the Dyna Cam recorder box in edge/ (Node 20 + ffmpeg, run under pm2 at each venue) — module layout, the device API contract (/api/v1/device, Device token, User-Agent, envelope, 401/404/409 handling), the rolling-buffer recorder (stream-copy video, AAC audio, RTSP over TCP, credential masking), segment timing (segments.csv + mtime anchor, irregular keyframe-cut segments), clip cutting/watermark/encoder rules, the LAN court-button listener and press relay, the persisted job queue, and the verification commands. Load BEFORE writing, editing, reviewing or explaining anything under edge/ — recorder, clipper, jobs, buttons, api client, config, tests, smoke script, pm2 or .env files.
---

# Edge conventions (`edge/`)

Node 20.12+ · plain ESM JavaScript · **no runtime dependencies** · ffmpeg 5+ · pm2 ·
`node:test`. Never add runtime dependencies (`node:http` for the listener). The box records each court's RTSP camera into a rolling buffer and cuts the replays
players save. Its only calls to the API are **outbound**; the one listener is LAN-only, for
court buttons. The product context is in
`docs/plans/PLAN-001-court-replay-cameras/plan.md` ("Recorder box"), and the server half is in
`back/server/src/controllers/v1/device/device.controller.js`.

## Module layout (`src/`)

| File | Owns |
| --- | --- |
| `config.js` | `.env` → frozen settings; `ConfigError` for anything missing or invalid; `USER_AGENT`, `AGENT_VERSION` |
| `api.js` | The only place that calls `fetch`. Auth header, UA, timeouts (AbortController), envelope unwrap, `ApiError` |
| `recorder.js` | One ffmpeg per court (`CourtRecorder`), restart/backoff, stall watchdog, pruning, heartbeat status (`RecorderManager`) |
| `segments.js` | Segment files → wall-clock time line (`segments.csv` + `index.json` + `run.json`) |
| `clipper.js` | Pure window and selection math, ffmpeg argument builders, encoder detection, `cutClip`, `makeClip` |
| `jobs.js` | Long-poll → persist → claim → cut → upload / fail, with backoff (`JobRunner`) |
| `queue.js` | `data/queue.json`: atomic, ordered writes |
| `buttons.js` | LAN listener `GET\|POST /press/:code[?key=]`: stamp `Date.now()` first, 202 at once, code regex, constant-time key, 3 s debounce |
| `sync.js` | `/config` refresh, logo download, config cache, heartbeat timer, clock-skew warning |
| `ffmpeg.js` | `runFfmpeg` (arg array, timeout, abort), `probeVideo`/`probeFile`, version parse |
| `log.js` / `util.js` | Logger (masks every line); `maskCredentials`, `safeId`, `backoffMs`, `sleep`, atomic JSON |
| `index.js` | Wiring and graceful shutdown only |

Keep logic in pure exported functions and inject side effects (`api`, `clip`, `spawnImpl`, `now`) so `test/` runs without ffmpeg or internet.

## Device API contract (don't change it from here)

- Base `${API_URL}/api/v1/device`. Every request sends `Authorization: Device <token>` **and**
  `User-Agent: DynaCamRecorder/<version>`. The API returns 403 for a missing UA or one containing
  bot, crawler, spider or scraper.
- Responses are `{ success, message, data }`. `api.js` returns `data` and throws `ApiError`
  (`status` 0 = never answered; `detail` = the server's message).
- Error handling, everywhere:
  - **404 / 409:** the clip is gone or already finished. Drop the job and don't retry.
  - **401:** the token was revoked or is wrong. Log loudly with the fix, back off 30 s → 5 min,
    and keep trying. Recording continues.
  - **429:** honour `Retry-After`.
  - **0 / 5xx:** back off exponentially.
  - **Any other 4xx on upload:** report `POST /fail` with `Upload rejected: <detail>`.
- `logoUrl` is a signed **relative** path. Fetch it as `new URL(logoUrl, API_URL)`. Send the
  device token only to the API's own origin. It expires, so re-read `/config` and download again
  only when the path (without the query) changes.
- Use `requestedAtMs` (epoch ms), never parse `requestedAt`. A job older than 15 min is failed
  server-side, so drop it.
- Claim (`/processing`) is best-effort, but exclusive: another box's claim → 409 → drop.
- Button press: `POST /buttons/:code/press {pressedAtMs}` → 201 or 200 (merged) with `shareUrl`.
  It is queued (`state: "press"`) and retried while under 100 s old (the API refuses > 120 s).
  404, 409, 422 and 400 are final and logged in words.
- Upload: multipart `video` (`video/mp4`, `*.mp4`) + optional `thumbnail` (`image/jpeg`, `*.jpg`) via `fs.openAsBlob`. Fail reasons ≤ 255 chars (`truncate`).

## ffmpeg rules

- **Always an argument array through `spawn`, never a shell string.**
- **The ring buffer is never re-encoded.** Recorder output options are
  `-map 0:v:0 -map 0:a? -c:v copy -c:a aac -b:a 64k`. Tapo cameras send G.711 A-law, which
  `-c copy` into MPEG-TS silently stores as unplayable `bin_data`. Never use a blanket `-c copy`.
- RTSP input: `-rtsp_transport tcp -timeout 10000000` (µs, ffmpeg ≥ 5; `-stimeout` on 4.x,
  where `-timeout` means *listen*). The stall watchdog kills a run with no new video for 20 s.
  Restart backoff is 2 s → 30 s max.
- **Never `-use_wallclock_as_timestamps`.** It clumps frames that arrive together, and the clip
  encoder then drops them, giving choppy clips at half the frame rate. Keep the camera's
  timestamps.
- **Mask credentials.** Never log or report a camera URL without `maskCredentials`. The logger
  masks every line as a safety net, and heartbeat messages go through `describeFailure`.
- Don't rely on `drawtext`, which some ffmpeg builds lack. The watermark is an image overlay:
  12% of the width, bottom-**right** (Tapo burns its own OSD top-left and bottom-left).
- Clip encode:
  - Concat demuxer with per-file `duration` = wall-clock spacing.
  - **Output-side** `-ss/-t`. Input-side seeking on concat started the video ~1.5 s late.
  - Scale to at most 1920×1080, and end the filter chain with `format=yuv420p` (or `nv12` /
    `hwupload` for QSV and VAAPI).
  - `-c:a aac`, `-movflags +faststart`.
  - If a hardware encoder fails, fall back to `libx264 -preset veryfast -crf 23` once.
- `ENCODER=auto` test-encodes each listed hardware encoder. Being listed is not enough.

## Segment timing (`segments.js`)

Segments are cut on keyframes, so lengths are irregular (1.7–6.1 s seen), and the `%s` name is
only the second the file was opened. The real span of a closed segment is:

- **content times** from `segments.csv` (CSV, from 0 per ffmpeg run);
- plus the run's **anchor**, which is the smallest `mtime − content end` within ±120 s of that run.

Rows are merged into `index.json` keyed by the run id in `run.json`, which is written before
each spawn. They are merged before every restart, because ffmpeg truncates the list. A segment
with no row falls back to its name → mtime. The file still being written is never used. Selection
tolerates holes ≤ 7 s, and the window must be inside a closed segment before cutting.

## Data and state

`DATA_DIR` holds `buffer/<courtId>/` (segments, csv, index, run, pid), `jobs/<clipId>/` (segments
hard-linked in so pruning can't pull them away), `queue.json` (clips and button presses),
`config.json` (mode 600, holds camera passwords) and `logo/`.

Every JSON write is atomic (`writeJsonAtomic`). Folder names from IDs go through `safeId`.

## Verification (run in `edge/` before reporting done)

```bash
npm run lint     # eslint (security plugin) + prettier-compatible; must be clean
npm test         # node:test — no network, no ffmpeg
npm run smoke    # ~2 min: real recorder + clipper on a Tapo-like source (pcm_alaw, irregular GOP);
                 # asserts ≈65 s, h264 + aac, every frame kept, faststart, JPEG thumbnail
```

Add a unit test for every new pure function and API error path. What can't be verified here (real RTSP cameras, QSV/VAAPI, the 6-court load test) is reported as unverified.

## Related

- README: install, Tapo C200 setup, troubleshooting, load-test TODO. The server side is backend work (`backend-conventions`); a contract change updates both sides.
- Shipped changes get a `changelog` entry. Plans, CRs and bugs live in the repo-root `docs/`.
