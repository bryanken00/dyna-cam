# Dyna Cam — recorder box

The small computer at each venue that records every court's camera and cuts the replays players
save. It keeps a rolling ~3-minute buffer per court. When a player taps **Save last 60 seconds**,
the API queues a clip job. The box picks the job up, cuts 60 s before the tap plus 5 s after,
burns the venue logo in bottom-right, makes a JPEG thumbnail and uploads both.

The box only makes **outbound** HTTPS calls to the API. The venue needs no port-forwarding and no
public IP. The only thing it listens on is a small LAN port for the court buttons. See [PLAN-001](../docs/plans/PLAN-001-court-replay-cameras/plan.md) for the whole
product.

**Stack:** Node 20.12+ (plain ESM JavaScript, no runtime dependencies) · ffmpeg 5+ · pm2.
Conventions live in the [`edge-conventions`](../.claude/skills/edge-conventions/SKILL.md) skill.

```
IP camera ──RTSP──▶ ffmpeg (-c:v copy) ──▶ data/buffer/<courtId>/<epoch>.ts   (rolling, ~180 s)
                                                         │
API ──GET /jobs (long-poll)──▶ job ──▶ cut + logo + H.264 ──▶ POST /clips/:id/upload
```

---

## Hardware

- **Mini PC:** an Intel N100-class box (4 cores, Quick Sync) with 8 GB RAM. Recording is stream
  copy, so it costs almost no CPU. Only cutting a clip encodes video, and the N100's `h264_qsv`
  encoder does that in a few seconds.
- **SSD:** at least 128 GB. The buffer is small (about 6 courts × 180 s × 2–4 Mbps ≈ 0.5 GB), but
  it is rewritten all day, so don't use an SD card or a USB stick.
- **Wired network:** plug the box into the router with a cable. The cameras may be on Wi-Fi; the
  box should not be.
- **Power:** a small UPS is worth it. The queue survives a reboot, but footage from during the
  outage does not exist.

## Install (Ubuntu 24.04 / Debian 12)

```bash
# Node 20+ (NodeSource or nvm), ffmpeg 5+, and time sync
sudo apt install -y ffmpeg chrony
node -v      # v20.12 or newer
ffmpeg -version | head -1   # 5.x or newer (4.x is handled with -stimeout but untested)

# The clock matters: clips are matched to the camera footage by wall-clock time
sudo systemctl enable --now chrony
chronyc tracking             # "System time" should be within a few ms

sudo npm install -g pm2
git clone <repo> /opt/dyna-cam && cd /opt/dyna-cam/edge
npm install --omit=dev
```

For Intel hardware encoding, also install the VA/QSV drivers:
`sudo apt install -y intel-media-va-driver-non-free vainfo` (check with `vainfo`). With
`ENCODER=auto` the box tries `h264_qsv`, then `h264_vaapi` (then `h264_videotoolbox` on a Mac),
and falls back to `libx264`. The startup log says which encoder it picked.

## Configure

1. In the **Admin portal → Setup → Recorder Boxes**, click **Add box**. It shows a **6-digit
   pairing key**, valid for 10 minutes and usable once.
2. In the Admin portal, give each court its camera's RTSP URL (see
   [Tapo C200 setup](#tapo-c200-setup)).
3. On the box, within those 10 minutes:

```bash
cp .env.example .env
nano .env        # API_URL=https://api.your-domain   PAIRING_CODE=123456
pm2 start ecosystem.config.cjs   # or: npm start
```

On first start the box redeems the key, logs `Paired as <name> for <venue> — you can remove
PAIRING_CODE from .env`, and keeps its own token in `data/device.json` (mode 600). After that the
key is not needed: delete the `PAIRING_CODE` line. A key that was used or refused is never sent
again, even after a restart (only its hash is kept, in `data/pairing-used.json`).

The box picks its credentials in this order:

1. `data/device.json` (from an earlier pairing);
2. `DEVICE_TOKEN` in `.env`: **the older way**, for boxes set up before pairing keys, using the
   long token the portal showed once;
3. `PAIRING_CODE`.

With none of these it stops and says: *"Add the box in Admin → Setup → Recorder Boxes and put its
6-digit key in .env as PAIRING_CODE, then restart."*

**Revoked boxes.** If the box is revoked in the Admin portal, a paired box:

1. logs *"This box was revoked — add it again in Admin to get a new pairing key"*;
2. stops recording and job work;
3. deletes `device.json` and the cached camera config.

If `.env` holds a new, unused `PAIRING_CODE`, the box tries it once and restarts with the new
pairing (under pm2). Otherwise it exits until you add a new key and run
`pm2 restart dyna-cam-edge`. A box configured with `DEVICE_TOKEN` behaves as before: it logs the
rejection loudly and keeps retrying slowly.

| Variable | Default | What |
| --- | --- | --- |
| `API_URL` | — (required) | Base URL of the API, without `/api` |
| `PAIRING_CODE` | — | The 6-digit key from Admin → Setup → Recorder Boxes (spaces/dashes OK). Only needed until the box has paired. |
| `DEVICE_TOKEN` | — | The older way: the long token from the portal. Leave empty when pairing. |
| `DATA_DIR` | `./data` | Buffer, job folders, `queue.json` and the cached config |
| `SEGMENT_SECONDS` | `2` | Target segment length. Segments are cut on keyframes, so the real length follows the camera (1.7–6 s on a Tapo C200). |
| `BUFFER_SECONDS` | `180` | Footage kept per court. A clip needs 65 s plus the time the job takes to arrive. |
| `ENCODER` | `auto` | `auto`, `libx264`, `h264_qsv`, `h264_vaapi` or `h264_videotoolbox` |
| `VAAPI_DEVICE` | `/dev/dri/renderD128` | Only for `h264_vaapi` |
| `RECORD_AUDIO` | `true` | Keep camera audio (transcoded to AAC while recording) |
| `CLIP_CONCURRENCY` / `UPLOAD_CONCURRENCY` | `1` / `1` | Clips cut / uploaded at the same time |
| `HEARTBEAT_SECONDS` | `30` | Heartbeat interval (the portal shows a box offline after 90 s) |
| `CONFIG_REFRESH_SECONDS` | `60` | How often courts, camera URLs and the logo are re-read |
| `DISK_WARN_GB` | `2` | Log a warning when free space in `DATA_DIR` drops below this |
| `DISK_CRITICAL_MB` | `500` | Below this, session footage is no longer kept beyond the rolling buffer, so live recording goes on |
| `BUTTON_PORT` | `8089` | LAN port for court buttons. Set it empty or `0` to turn buttons off. |
| `BUTTON_HOST` | `0.0.0.0` | Address the button listener binds to |
| `BUTTON_KEY` | — | If set, buttons must send `?key=<BUTTON_KEY>`. Strongly recommended. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |
| `FFMPEG_PATH` / `FFPROBE_PATH` | `ffmpeg` / `ffprobe` | If they're not on `PATH` |

The box refuses to start without `API_URL`, or without any credentials (above), and says why.

## Run

```bash
npm start                         # foreground, Ctrl-C stops every ffmpeg cleanly
pm2 start ecosystem.config.cjs    # as a service
pm2 save && pm2 startup           # start on boot (run the command it prints)
pm2 logs dyna-cam-edge
pm2 install pm2-logrotate         # keep the logs from filling the disk
```

On start the box loads its config, starts one recorder per court, and begins long-polling for
jobs. Within a minute each court shows **ok** in the Admin portal. If the API can't be reached, it
records from the last cached config (`data/config.json`, mode 600, which holds the camera
passwords).

## Tapo C200 setup

The venues use TP-Link **Tapo C200** cameras (Wi-Fi, indoor pan/tilt). On firmware 1.3.17,
`stream1` is H.264 High 1280×720 at about 30 fps with G.711 A-law audio, and `stream2` is
640×360. Always use `stream1`.

1. **Create the camera account.** In the Tapo app, go to the camera → Settings → Advanced
   settings → **Camera Account**. Set a username and password (6–32 characters). This is a
   separate login just for RTSP, not your Tapo cloud login.
2. **Reserve the camera's IP.** In the venue router, make a DHCP reservation for the camera, so the
   RTSP URL never changes.
3. **The RTSP URL** to enter for the court in the Admin portal is
   `rtsp://<camera-account-user>:<password>@<camera-ip>:554/stream1`. The box always uses TCP.
   The URL is stored encrypted, and the box never logs the password.
4. **Keep the view fixed on the court.** Turn **off** Privacy Mode, Motion Tracking /
   Auto-Tracking and Patrol. Aim the camera, then leave it alone.
5. **Wi-Fi:** the C200 is **2.4 GHz only**. Check the signal at the court (the Tapo app shows it)
   before mounting, and add an access point if it's weak. Drop-outs show in the portal as
   *"Camera not reachable — check Wi-Fi/power"*, and the box reconnects by itself (backoff capped
   at 30 s).
6. **Pick two of three.** Tapo's own rule is that **SD-card recording, Tapo Care (cloud) and
   RTSP/NVR can't all run at once**. Only two of the three work together, and RTSP is the one we
   need.
7. **On-screen text:** the camera burns its own date/time (top-left) and a "tapo" logo
   (bottom-left) into the picture. Our watermark goes bottom-**right** so they don't collide. If
   the venue wants a clean picture, turn the on-screen display (OSD) off in the camera's
   settings in the Tapo app.
8. **Battery Tapo models** (the C4xx battery cameras, C425 and similar) **don't support RTSP** and
   can't be used.

Other RTSP cameras work the same way. H.264 or H.265 is fine, since the clip is re-encoded to
H.264 anyway.

## Camera setup preview

The Admin portal's **Set up camera** page shows whether the camera works, without anyone going to
the box. The box can't open a second connection to the camera to test it, because a Tapo C200
serves one RTSP client and the recorder holds it. So the box reports what its **own recording**
contains:

- **Camera details in the heartbeat.**
  - Each court gets `video {codec, width, height, fps}` and `audio {codec, sampleRate}`, or
    `audio: null` when the camera sends no sound.
  - These are read with `ffprobe` from the court's newest **finished** segment, at most every
    30 s per court and only when a new segment exists. They are dropped once the newest segment
    is more than a minute old.
  - The frame rate is the camera's claim when it matches the frames actually counted in the
    segment; otherwise it is the counted rate. A C200 claims about 30 fps but sends 15.
- **Which address the report is about.** Each heartbeat entry echoes the court's
  `cameraVersion` from `/config`, but only the version the **running** recorder was started with.
  After a new camera address is saved, the report switches once the recorder has restarted on it,
  so the setup page never mistakes a report about the old address for the new one. Camera details
  from the old address's segments are left out.
- **Preview picture.**
  - While someone has a court's setup page open, `/config` marks it `previewWanted`. The box
    then takes one JPEG from that court's newest finished segment every ~30 s (at most 1280 px
    wide) and uploads it with `POST /courts/:courtId/snapshot`. Staff can aim the pan/tilt while
    watching it.
  - It stops when the page closes.
  - While a preview is wanted, config and heartbeat run every 15 s instead of 60/30, so the page
    reacts quickly.
- **Previews come last.**
  - A snapshot is skipped whenever a clip is waiting, being cut or uploading, and only one is
    made at a time.
  - A 404 (the court no longer belongs to this venue) stops previews for that court.

## Sessions (full-session recording)

Staff can book a court for a window of 5 min to 3 h (Admin portal → Sessions). The API splits the
booking into **5-minute parts**. Each part becomes an ordinary clip job when its window ends, and
the players get every part as its own clip.

What the box does:

1. **Keeps the footage.** `/config` lists the sessions that start within a day or ended less than
   30 min ago. Every segment that overlaps a session window of its court, ±10 s, is kept until
   30 min after the session ends instead of being pruned after `BUFFER_SECONDS`. A cached config
   keeps this working across a reboot.
2. **Cuts each part exactly.** A part covers `[windowStart, windowEnd]`, with no 60 s before or
   5 s after. The box waits until the window end is in a closed segment, like an ordinary clip.
3. **Caps the size.** Session parts use libx264 `-crf 26 -maxrate 1200k` (hardware encoders:
   `-b:v 1000k -maxrate 1200k`) with 64k audio, so a 5-min part is at most about 47 MB. Ordinary
   clips are capped at 2.3 Mbit/s, so a 65 s clip is at most about 20 MB.
4. **Copes with camera drop-outs.**
   - A part is made if **at least 80 %** of its window was recorded. Holes show as a held frame,
     and footage that starts late or stops early makes the part shorter.
   - Below 80 % the part is failed with "Camera recorded only N% of this part of the session".
   - With no footage at all it fails with "Camera was not recording during this part of the
     session".
5. **Puts players first.** A player's clip is always cut before a session part, because a part's
   footage is kept and a clip's isn't.

**Disk sizing.** A C200 `stream1` records at about 1–2 Mbit/s, which is about 0.45–0.9 GB per
court-hour, so a 3 h session keeps up to about 2.7 GB until 30 min after it ends. Plan for:

> free space ≥ (courts booked at the same time) × (longest session in hours) × 0.9 GB + 2 GB margin

For example, 6 courts with 3 h sessions at once is about 16 GB, so use a 128 GB SSD or larger.
The box checks free space every minute:

- Below `DISK_WARN_GB` (2 GB) it logs a warning every 10 min.
- Below `DISK_CRITICAL_MB` (500 MB) it logs an error and stops keeping session footage, so
  recording never stops.

**Throughput.** At every 5-minute boundary each court in a session produces a part to encode. The
API fails a part that isn't finished within 15 min, so with several courts in sessions use a
hardware encoder (QSV/VAAPI). Measuring this is in the load test below.

## Live streaming

A court can be streamed live to YouTube or Facebook. In the **Admin portal → Courts**, turn
streaming on and paste the **ingest URL with the stream key**:

| Service | Ingest URL (stream key at the end) |
| --- | --- |
| YouTube Live | `rtmp://a.rtmp.youtube.com/live2/<stream key>` (YouTube Studio → Go live → Stream) |
| Facebook Live | `rtmps://live-api-s.facebook.com:443/rtmp/<stream key>` (Live Producer → Streaming software) |

The stream key is a secret. The box never logs it; it shows at most the last 4 characters
(`rtmp://a.rtmp.youtube.com/live2/****mnop`). The Admin portal shows each court's stream status
(off, starting, live or error) from the heartbeat.

How it works, and the rules:

- **One camera connection.** A Tapo C200 serves only **one** RTSP client at a time; a second
  connection is refused. So the stream is a second output of the court's **recorder** ffmpeg
  (the `tee` muxer), never a second connection to the camera.
- **Recording comes first.**
  - The RTMP output runs in its own queue (`fifo`). On a slow uplink it drops stream packets
    rather than slowing the recording.
  - If the streaming service is unreachable or refuses the key, recording carries on and the
    court shows *"Can't reach the streaming service"* or *"Stream rejected — check the stream
    key"*.
  - ffmpeg reconnects to the service by itself every 10 s.
- **Restarts are rare and careful.** Turning streaming on or off, or changing the key, restarts
  that court's recorder. So does an RTMP output that closed for good, at most every 5 min. A
  restart leaves a few seconds' gap, so it only happens when no clip or session part that isn't
  cut yet reaches into the last ~70 s.
- **The picture is the camera's own.** Video is copied as-is (H.264, as the C200 sends it), with
  the Tapo's on-screen time and logo but **without the venue watermark** in v1. Audio is AAC at
  44.1 kHz. An H.265 camera can't be streamed this way.
- **Bandwidth:** each streamed court sends about the camera's bitrate **up** (about 1–2 Mbit/s for
  a C200 at 720p, more at 1080p), on top of clip uploads. Check the venue's upload speed before
  turning on several courts. YouTube/Facebook may warn that the bitrate is low for their
  recommended settings; the stream still works.

## Court buttons

A Wi-Fi button at each court saves the replay just like the QR code does. The button calls the
box on the LAN, and the box notes the press time the moment the request arrives. It answers `202`
at once, so the button never waits on the internet, and then relays the press to the API. If the
internet is slow or down, the press is kept in `data/queue.json` and retried for about 100 s
(the API refuses presses older than 2 minutes).

```
GET  http://<box-ip>:8089/press/<buttonCode>?key=<BUTTON_KEY>     (POST works too)
GET  http://<box-ip>:8089/health
```

- **Button code:** set it per court in the **Admin portal → Courts** (3–32 letters, digits, `-`
  or `_`, for example `court-1`). One code per button.
- **Key:** set `BUTTON_KEY` in `.env` to a long random string (`openssl rand -hex 16`). Without a
  key, anyone on the venue Wi-Fi can save clips.
- **Box address:** give the box a fixed LAN IP (a DHCP reservation in the router), like the
  cameras.
- **Bounces:** a second press of the same button within 3 s is ignored. The API also merges
  presses on one court within 20 s into the same clip.
- **Answers:**

  | Status | Meaning |
  | --- | --- |
  | `202 {"ok":true}` | Accepted |
  | `202 {"ok":true,"duplicate":true}` | Bounce, ignored |
  | `400` | Bad code |
  | `401` | Wrong or missing key |
  | `404` | Unknown path |

- **The log** shows each press and its result:
  - `button court-1: clip saved <clipId> — <share link>`;
  - `Button code X is not set on any court of this venue — set it in Admin → Courts` (404);
  - court has no camera (409), or press too old (422).

### Shelly Button 1

1. Add the button to the venue Wi-Fi with the Shelly app (or its own access point at
   `192.168.33.1`).
2. Open the button's web UI → **Actions** → **Button Short Press URL**, and enter
   `http://<box-ip>:8089/press/court-1?key=<BUTTON_KEY>`. Enable it and save.
3. Press it. The box log shows `button court-1 pressed`, and the clip appears in the Admin portal.

The Shelly Button 1 sleeps between presses and needs a second or two to join Wi-Fi. The press time
is when the request reaches the box, so the clip ends that much later. Every clip already
includes 5 s after the press.

### ESP32 (outline)

Any ESP32 with a momentary push button works:

```cpp
#include <WiFi.h>
#include <HTTPClient.h>
const char* URL = "http://192.168.1.10:8089/press/court-1?key=YOUR_BUTTON_KEY";
const int PIN = 0;                       // button to GND, internal pull-up
void setup() { pinMode(PIN, INPUT_PULLUP); WiFi.begin("venue-ssid", "wifi-password"); }
void loop() {
  if (digitalRead(PIN) == LOW) {         // pressed
    HTTPClient http; http.begin(URL); http.setTimeout(3000);
    http.POST("");                       // 202 = accepted
    http.end();
    delay(3000);                         // simple debounce (the box debounces too)
  }
  delay(20);
}
```

Keep the board on wired USB power. Reconnect Wi-Fi in `loop()` if `WiFi.status() != WL_CONNECTED`.

## Test without real hardware

```bash
npm run lint
npm test          # node:test, no internet: window math, segment selection, ffmpeg args, masking, queue, job loop, buttons, API client
npm run smoke     # ~2 min, ffmpeg only, no API, no camera (includes camera details + preview, and a local RTMP streaming test)
```

`npm run smoke` makes a Tapo-like source (H.264 with keyframes 1.7–6.1 s apart + **pcm_alaw**
audio). It plays the source in real time through the real recorder (only the RTSP input is
swapped for a pipe), cuts a 65 s clip with a logo, and checks:

- the duration is about 65 s;
- there is H.264 video and AAC audio;
- every frame is kept;
- `moov` comes before `mdat` (faststart);
- the thumbnail is a JPEG.

In parallel, a second recorder records **and** streams to a local ffmpeg RTMP server. The smoke
checks that segments keep coming, the receiver gets video, killing the receiver leaves recording
running with stream status *error*, and a new receiver is picked up again.

Options: `-- --no-stream`, `-- --encoder libx264`, `-- --bursty` (packets arrive in ~1 s bursts, like bad Wi-Fi),
and `-- --keep` (keep the temp folder).

### A fake RTSP camera (end-to-end with a local API)

Use [mediamtx](https://github.com/bluenviron/mediamtx) as the RTSP server and ffmpeg as the
camera:

```bash
./mediamtx &                                   # listens on rtsp://localhost:8554
ffmpeg -re -f lavfi -i testsrc=size=1280x720:rate=30 -f lavfi -i sine=sample_rate=8000 \
  -pix_fmt yuv420p -c:v libx264 -preset ultrafast -g 60 -bf 0 -c:a pcm_alaw \
  -f rtsp -rtsp_transport tcp rtsp://localhost:8554/court1
```

Point a court's camera URL at `rtsp://localhost:8554/court1` (on a test API, `cd back && npm run
dev`), add a recorder box in the Admin portal, put its token in `.env`, `npm start`, then save a
clip from the court's QR page.

## How it works (short)

- **Recording** (`src/recorder.js`): one ffmpeg per court, `-rtsp_transport tcp -timeout 10s
  -c:v copy -c:a aac -f segment`. Video is never re-encoded, and audio is transcoded because
  MPEG-TS can't carry the Tapo's A-law. When ffmpeg exits or produces no video for 20 s, it is
  restarted with backoff from 2 s up to 30 s. Segments older than `BUFFER_SECONDS` are deleted.
- **Timing** (`src/segments.js`): segment lengths are irregular and the `%s` file name drifts. So
  each closed segment's real wall-clock span comes from ffmpeg's `segments.csv` (camera content
  times) anchored by when the segment was closed (its mtime). This is kept in `index.json`.
- **Clips** (`src/clipper.js`):
  1. Wait until the window `[tap − 60 s, tap + 5 s]` is on disk.
  2. Pick the covering segments; holes up to 7 s are allowed.
  3. Concat them on a wall-clock timeline, then trim.
  4. Overlay the logo at 12% of the width, bottom-right.
  5. Encode H.264 at up to 1080p with AAC audio and `+faststart`.
  6. Make the thumbnail from the middle frame.
- **Camera setup** (`src/camera.js`): camera details and preview JPEGs read from the buffer, never
  from the camera.
- **Sessions:** session windows from `/config` protect their segments from pruning
  (`segments.js` `retentionWindows`); part jobs cut their exact window (`clipper.js`
  `selectPartSegments`).
- **Streaming** (`src/stream.js`): tee-muxer arguments and escaping, stream-key masking,
  reading ffmpeg's stream messages, and the restart rule.
- **Buttons** (`src/buttons.js`): a `node:http` listener on the LAN. It stamps the press, answers
  202, and the job loop relays the press with `pressedAtMs`.
- **Jobs** (`src/jobs.js`):
  1. Long-poll `GET /jobs?wait=25`.
  2. Persist the job to `data/queue.json`, then claim it.
  3. Cut the clip, then upload it, retrying with backoff.
  4. A window the buffer doesn't cover is reported with `POST /fail` (for example "Camera was not
     recording at that time").
  5. 404 or 409 means the clip is gone or already done, so the job is dropped.
  6. A cut clip that wasn't uploaded yet is re-uploaded after a reboot.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `[config] Missing API_URL` | `.env` is in `edge/` and filled in |
| *The pairing key was not accepted* | The key was mistyped, expired (10 min) or already used. Make a new one in Admin → Setup → Recorder Boxes, put it in `.env` as `PAIRING_CODE`, then `pm2 restart dyna-cam-edge`. |
| *The PAIRING_CODE in .env was already used* | The box only tries a key once. Put a new key in `.env`. |
| *pairing is paused by the API* | Too many wrong keys (here or anywhere). The box waits as the API asks and tries again. |
| *This box was revoked* | Someone removed the box in Admin. Add it again, put the new key in `.env`, then `pm2 restart dyna-cam-edge`. |
| `DEVICE TOKEN REJECTED (401)` in the log | A `DEVICE_TOKEN` box was revoked or the token is wrong. Add it again in Admin, put its key in `.env` as `PAIRING_CODE`, empty `DEVICE_TOKEN`, then restart. The box keeps retrying slowly until then. |
| 403 `BOT_BLOCKED` | Something stripped the `User-Agent` (a proxy?). The box sends `DynaCamRecorder/<version>`. |
| Court shows *Camera not reachable — check Wi-Fi/power* | Camera powered? Same network? `ping <camera-ip>`. Weak 2.4 GHz signal at the court? |
| *Camera rejected the username/password* | Use the Tapo **Camera Account**, not the cloud login |
| *Camera stream not found* | The path must be `/stream1` |
| Clips fail with *Camera was not recording at that time* | The court was in error at that moment. Check the camera and the heartbeat history. |
| Clips fail with *…too late — already overwritten* | The box was busy or offline for minutes. Raise `BUFFER_SECONDS` or check the network. |
| `box clock is …s behind/ahead of the server` | NTP isn't working: `chronyc tracking`, `timedatectl` |
| Clips cut a few seconds off | Check the clock (above), then the camera's own time. |
| Slow cuts / high CPU | Check that the startup log says `h264_qsv`/`h264_vaapi`, and that `vainfo` works |
| Button does nothing | `curl "http://<box-ip>:8089/health"` from the same Wi-Fi. Is the box firewall open on 8089 (`sudo ufw allow 8089/tcp`)? Check `pm2 logs` for `401` (key) or "not set on any court". |
| Session part failed "Camera recorded only N%…" | The camera dropped out for over a minute in that part. Check Wi-Fi and the heartbeat history. |
| `low disk` / `session footage is no longer kept` | Free space: `df -h`, then `du -sh data/*`. See [disk sizing](#sessions-full-session-recording). |
| Setup page shows no preview / details | The court must be **Recording** first. Previews wait while clips are being made, and the page updates every 15–30 s. |
| Stream *Can't reach the streaming service* | Venue internet up? Is the ingest URL right (`rtmp://` vs `rtmps://`, port)? The box keeps retrying every 10 s. |
| Stream *rejected — check the stream key* | The key was reset or the live event ended. Paste the new ingest URL in Admin → Courts. |
| Stream on, but the camera shows *not reachable* | Something else is connected to the camera (NVR, VLC, Tapo's own NVR mode). The C200 allows one RTSP client. |
| Disk filling | `du -sh data/*`. The buffer prunes itself. Leftover `data/jobs/*` are cleared on restart. |

Test a camera by hand (the password stays out of the box's logs, but not your shell history):

```bash
ffprobe -rtsp_transport tcp -i 'rtsp://user:pass@192.168.1.50:554/stream1'
```

## Load test (6 courts) — TODO

Not done yet. Run it on the real N100 box with 6 cameras (or 6 mediamtx test streams at 1080p)
before the first venue goes live.

| Measure | Target | Result |
| --- | --- | --- |
| CPU while recording 6 courts (no clips) | < 15% | TODO |
| RAM (node + 6 ffmpeg) | < 1 GB | TODO |
| Disk write rate / buffer size | ~0.5 GB steady | TODO |
| Time to cut one 65 s clip, `h264_qsv` | < 15 s | TODO |
| Time to cut one 65 s clip, `libx264` | < 60 s | TODO |
| 6 clips saved at once: last clip Ready after | < 2 min | TODO |
| Clip size (65 s, 720p / 1080p) | ≤ 20 MB | TODO |
| Upload time on the venue's uplink | < 60 s | TODO |
| Recording gaps during a clip burst | none | TODO |
| 6 courts in sessions: 6 × 5-min parts encoded per 5 min | < 5 min total | TODO |
| 5-min session part size (720p / 1080p) | ≈ 40–50 MB | TODO |
| 6 courts recording, 2 streaming: CPU, upload use | < 20%, ≈ 2 × camera bitrate | TODO |
| 24 h soak: memory growth, restarts | flat, 0 | TODO |
