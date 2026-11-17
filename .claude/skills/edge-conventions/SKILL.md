---
name: edge-conventions
description: The non-negotiable conventions for the Dyna Cam recorder box in edge/ (Node 20 + ffmpeg, run under pm2 at each venue) — module layout, the device API contract (/api/v1/device, Device token, User-Agent, envelope, 401/404/409 handling), the rolling-buffer recorder (stream-copy video, AAC audio, RTSP over TCP, credential masking), segment timing (segments.csv + mtime anchor, irregular keyframe-cut segments), clip cutting/watermark/encoder rules, the LAN court-button listener and press relay, session retention and session parts, live streaming via the recorder's tee output, camera-setup details and previews, the persisted job queue, and the verification commands. Load BEFORE writing, editing, reviewing or explaining anything under edge/ — recorder, clipper, jobs, buttons, api client, config, tests, smoke script, pm2 or .env files.
---

# Edge conventions (`edge/`)

Node 20.12+ · plain ESM JavaScript · **no runtime dependencies, never add one** · ffmpeg 5+ · pm2 ·
`node:test`. The box records each court's RTSP camera into a rolling buffer and cuts the replays
players save. API calls are **outbound** only; the one listener is LAN-only (court buttons).
Context: PLAN-001 ("Recorder box"); server half: `back/server/src/controllers/v1/device/`.

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
| `stream.js` | RTMP via the recorder's own ffmpeg (tee + fifo slave): escaping, key masking, stderr → stream status, restart rule |
| `camera.js` | Setup: `video`/`audio` for the heartbeat (`MediaProbe`) + preview JPEGs (`PreviewSender`) from the latest CLOSED segment |
| `sync.js` | `/config` refresh, logo download, config cache, heartbeat timer, clock-skew warning |
| `ffmpeg.js` | `runFfmpeg` (arg array, timeout, abort), `probeVideo`/`probeFile`, version parse |
| `log.js` / `util.js` | Logger (masks every line); `maskCredentials`, `safeId`, `backoffMs`, `sleep`, atomic JSON |
| `index.js` | Wiring and graceful shutdown only |

Pure functions + injected side effects (`api`, `clip`, `spawnImpl`, `now`): `test/` needs no ffmpeg or internet.

## Device API contract (don't change it from here)

- Base `${API_URL}/api/v1/device`. Every request sends `Authorization: Device <token>` **and**
  `User-Agent: DynaCamRecorder/<version>`. The API returns 403 for a missing UA or one containing
  bot, crawler, spider or scraper.
- Envelope `{ success, message, data }` → `data`; failures throw `ApiError` (`status` 0 = no answer).
- Errors: **404/409** clip gone or done → drop. **401** token revoked → log loudly, back off
  30 s → 5 min, keep trying (recording continues). **429** → `Retry-After`. **0/5xx** →
  exponential backoff. Other 4xx on upload → `POST /fail` with `Upload rejected: <detail>`.
- `logoUrl` is signed and **relative** (`new URL(logoUrl, API_URL)`, token only to the API's own
  origin); re-download only when its path (without the query) changes.
- Use `requestedAtMs`, never parse `requestedAt`; a clip job > 15 min old is failed server-side →
  drop. Claim is best-effort but exclusive (another box's claim → 409 → drop).
- Session parts are clip jobs with `sessionId`, `partIndex`, `windowStartMs` and `windowEndMs`
  (null for ordinary clips). Cut exactly that window. It must be ≥ 80 % covered (holes → held
  frames), otherwise fail with the coverage. Players' clips are cut before parts. `/config`
  `sessions` keep their court's segments (window ± 10 s) until end + 30 min
  (`retentionWindows`). Below `DISK_CRITICAL_MB` that keep is dropped, so recording never stops.
- Button press: `POST /buttons/:code/press {pressedAtMs}` → 201 or 200 (merged) with `shareUrl`.
  It is queued (`state: "press"`) and retried while under 100 s old (the API refuses > 120 s).
  404, 409, 422 and 400 are final and logged in words.
- Setup (PLAN-002): heartbeat entries add `video {codec,width,height,fps}` + `audio {codec,sampleRate}|null`
  (probed ≤ every 30 s, counted fps beats the claim) + the running recorder's `cameraVersion`. `/config` court
  `previewWanted` → one JPEG per ~30 s to `POST /courts/:id/snapshot` (`snapshot`, ≤ 3 MB),
  skipped while clips are busy; config/heartbeat every 15 s meanwhile; 404 → stop that court.
- Upload: multipart `video` (`video/mp4`, `*.mp4`) + optional `thumbnail` (`image/jpeg`, `*.jpg`) via `fs.openAsBlob`. Fail reasons ≤ 255 chars (`truncate`).

## ffmpeg rules

- **Always an argument array through `spawn`, never a shell string.**
- **The ring buffer is never re-encoded.** Recorder output options are
  `-map 0:v:0 -map 0:a? -c:v copy -c:a aac -b:a 64k`. Tapo cameras send G.711 A-law, which
  `-c copy` into MPEG-TS silently stores as unplayable `bin_data`. Never use a blanket `-c copy`.
- RTSP: `-rtsp_transport tcp -timeout 10000000` (µs, ffmpeg ≥ 5; `-stimeout` on 4.x). No new
  video for 20 s → kill; restart backoff 2 s → 30 s.
- **Never `-use_wallclock_as_timestamps`**: it clumps frames that arrive together and the clip
  encoder drops them (half the frame rate). Keep the camera's timestamps.
- **Mask credentials** (`maskCredentials`) in every log line and heartbeat message — RTSP passwords
  and RTMP stream keys (≤ last 4 chars shown; `maskStreamKey` on every stderr line).
- **One RTSP connection per camera** (a C200 refuses a second): probes and previews read segment files. Streaming is a `tee` output of the
  recorder: `[f=segment:…]…%s.ts|[f=flv:onfail=ignore:use_fifo=1:fifo_options=…]rtmp://…` —
  never a second ffmpeg on the camera. Tee values are escaped twice, file names once (`stream.js`).
  Recorders log `level+info`; stream lines set `streamStatus`, never the recording error.
  Restart for streaming only on a config change or a closed output (≤ every 5 min), and never
  while an uncut clip/part window reaches into the last 70 s (`streamRestartAllowed`).
- No `drawtext` (missing in some builds). Watermark = image overlay, 12% width, bottom-**right**.
- Clip encode:
  - Concat demuxer with per-file `duration` = wall-clock spacing.
  - **Output-side** `-ss/-t`. Input-side seeking on concat started the video ~1.5 s late.
  - Scale to ≤ 1920×1080, end the filter with `format=yuv420p` (`nv12`/`hwupload` for QSV/VAAPI); `-c:a aac`, `+faststart`.
  - Bitrate caps (`QUALITY`): clips crf 23 / max 2300k (≤ 20 MB per 65 s), session parts crf 26
    / max 1200k with 64k audio (≈ 45 MB per 5 min). Hardware encoders use `-b:v` with the same
    maxrate.
  - If a hardware encoder fails, fall back to `libx264 -preset veryfast -crf 23` once.
- `ENCODER=auto` test-encodes each listed hardware encoder (being listed is not enough).

## Segment timing (`segments.js`)

Segments are cut on keyframes (1.7–6.1 s seen) and the `%s` name is only when the file opened.
A closed segment's real span = **content times** from `segments.csv` (from 0 per ffmpeg run) +
the run's **anchor** (smallest `mtime − content end` within ±120 s of that run).

Rows merge into `index.json` keyed by the run id in `run.json` (written before each spawn; merged
before every restart, as ffmpeg truncates the list). No row → name → mtime. The file still being
written is never used. Clips tolerate holes ≤ 7 s; the window must end in a closed segment.

## Data and state
`DATA_DIR` holds `buffer/<courtId>/` (segments, csv, index, run, pid), `jobs/<clipId>/` (segments
hard-linked in so pruning can't pull them away), `queue.json` (clips and button presses),
`config.json` (mode 600, holds camera passwords) and `logo/`. Every JSON write is atomic
(`writeJsonAtomic`). Folder names from IDs go through `safeId`.

## Verification (run in `edge/` before reporting done)

```bash
npm run lint     # eslint (security plugin) + prettier-compatible; must be clean
npm test         # node:test — no network, no ffmpeg
npm run smoke    # ~2 min: real recorder + clipper on a Tapo-like source (pcm_alaw, irregular GOP):
                 # 65 s clip (h264+aac, all frames, faststart, JPEG) + a 60 s session part (capped)
```

Unit-test every new pure function and API error path; report what can't be verified here (real cameras, QSV/VAAPI, load test).

## Related

- README: install, Tapo, setup preview, sessions, streaming, buttons, troubleshooting, load test. The server side is backend work; a contract change updates both sides.
- Shipped changes get a `changelog` entry; plans/CRs/bugs live in the repo-root `docs/`.
