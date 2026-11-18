# Dyna Cam — recorder box

The small computer at each venue that records every court's camera and cuts the replays players
save. It keeps a rolling ~3-minute buffer per court. When a player taps **Save last 60 seconds**,
the API queues a clip job. The box picks the job up, cuts 60 s before the tap plus 5 s after,
burns the venue logo in bottom-right, makes a JPEG thumbnail and uploads both.

The box only makes **outbound** HTTPS calls to the API. The venue needs no port-forwarding and no
public IP. It listens only on the venue LAN: a small port for the court buttons and one for the
[live view](#live-view-on-the-venue-wi-fi) on session devices. See [PLAN-001](../docs/plans/PLAN-001-court-replay-cameras/plan.md) for the whole
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

Recorder boxes are set up from `.env` only — there is no screen for them in the Admin portal.

1. In the Admin portal, give each court its camera's RTSP URL (see
   [Tapo C200 setup](#tapo-c200-setup)).
2. Get the venue's ID: **Admin portal → Setup → Venues → the venue → Copy ID**.
3. Get the **enrol key**: the API's `RECORDER_ENROLL_KEY` (in `back/.env`, 64 hex characters; ask
   whoever runs the API). Treat it like a password.
4. On the box:

```bash
cp .env.example .env
nano .env        # API_URL=https://api.your-domain
                 # ENROLL_KEY=<the API's RECORDER_ENROLL_KEY>
                 # VENUE_ID=<Copy ID from the venue page>
                 # BOX_NAME=Bry's Table      (optional; default the hostname)
pm2 start ecosystem.config.cjs   # or: npm start
```

On first start the box enrols (`POST /api/v1/pair/enroll`), logs `Enrolled as <name> for
<venue>`, and keeps its own token in `data/device.json` (mode 600). After that it never sends the
enrol key again; it stays in `.env` only so the box can enrol again after a reset. The key never
appears in the log.

The box picks its credentials in this order:

1. `data/device.json` (from an earlier enrolment — boxes paired before Phase I keep working);
2. `ENROLL_KEY` + `VENUE_ID` in `.env`.

- **Refused** (*"The API refused this box's ENROLL_KEY / VENUE_ID"*): the key doesn't match the
  API's, or the venue ID is wrong or deleted. The box remembers that pair (only a hash, in
  `data/enroll-refused.json`) and won't send it again — fix `.env`, then
  `pm2 restart dyna-cam-edge`. A changed key or venue is tried at once.
- **Enrolment turned off** (*"Enrolment is turned off on the API"*): the API has no
  `RECORDER_ENROLL_KEY`. The box tries again every 5 min.
- **Paused** (429): too many wrong keys from somewhere; the box waits as the API asks.
- `PAIRING_CODE` and `DEVICE_TOKEN` (older setups) are no longer read: a box that still has one in
  `.env` logs a warning and ignores it.

**Revoked boxes.** A box is blocked from the API's command line
(`npm run boxes:revoke -- <name or id>` in `back/`). The revoked box:

1. stops recording and job work;
2. deletes `data/device.json` and the cached camera config (it holds the camera passwords);
3. writes `data/revoked.json` (`revokedAt`, `deviceId`, `name`; mode 600);
4. logs *"This box was revoked — delete data/revoked.json (and check .env) to enrol it again"*
   and exits.

It does **not** enrol again by itself: while `data/revoked.json` exists, every start logs the same
line, waits a minute (so pm2 doesn't restart it in a tight loop) and exits. To bring it back,
delete `data/revoked.json` and run `pm2 restart dyna-cam-edge`: it enrols again as a new box.

**A stolen box** holds the enrol key. Revoke it **and** rotate the key: set a new
`RECORDER_ENROLL_KEY` in `back/.env` (`openssl rand -hex 32`) and restart the API. Enrolled boxes
keep working (they don't need the key again); update `ENROLL_KEY` in the other boxes' `.env` so
they can enrol again after a reset.

| Variable | Default | What |
| --- | --- | --- |
| `API_URL` | — (required) | Base URL of the API, without `/api` |
| `ENROLL_KEY` | — (required until enrolled) | The API's `RECORDER_ENROLL_KEY` (at least 32 characters). Never logged. |
| `VENUE_ID` | — (required with `ENROLL_KEY`) | The venue's ID: Admin → Setup → Venues → the venue → **Copy ID** |
| `BOX_NAME` | the hostname | How the box is named in the API (≤ 100 characters) |
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
| `LIVE_PORT` | `8090` | LAN port of the [live view](#live-view-on-the-venue-wi-fi). Set it empty or `0` to turn it off. Must differ from `BUTTON_PORT`. |
| `MAX_STACKED_STREAMS` | `2` | Stacked (two-camera, re-encoded) live streams at once, court and player streams together. `0` = never stack. |
| `LIVE_HOST` | detected | The box's LAN address as phones reach it (e.g. `192.168.1.50`). Leave empty to detect it; set it when the box has several networks (Docker, VPN) or detection picks the wrong one. |
| `CERT_PATH` | — | Folder with `privkey.pem`, `cert.pem` and (optional) `chain.pem`, the same files as the API's `certPath`. Set it to serve the [live view over HTTPS](#https-cert_path). `LIVE_HOST` must then be the certificate's host name. |
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
booking into **5-minute parts**. Each part becomes an ordinary clip job when its window ends. The
box cuts and uploads the parts one by one (safe on a weak venue line); the API then **joins each
camera's parts into one whole-game video** (CR-003), so players download one file, not parts.

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
6. **Cuts one camera per part when asked (CR-003).** A part job may carry `camera`:
   - `0` or absent: as before — stacked on a two-camera court (see below), else the one camera.
   - `1` or `2`: **that camera only**, never stacked and never the other camera: a normal
     single-camera video (up to 1080p, 720p for a C200) with the session caps above, the logo and a
     thumbnail. On a two-camera court the API sends one job per camera for each 5-minute window
     (separate clip ids, cut in any order) and joins them into "Cam 1 – whole game" and
     "Cam 2 – whole game".
   - The 80 % rule applies to that camera alone, and the reason names it: "Camera 2 was not
     recording during this part of the session", "Camera 2 recorded only N% of this part of the
     session".
   - A camera-2 job for a court that has no camera 2 (in `/config`) and no camera-2 footage for the
     window fails at once with "This court has no camera 2". Footage camera 2 recorded before it was
     removed is still cut.
   - The box tells the API it understands this with `capabilities: ["session-part-camera"]` in every
     heartbeat; an older box never gets per-camera jobs. Jobs saved in `data/queue.json` by an older
     box (no `camera`) still run, as `0`.

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

- **A restream, not part of the recorder.** The court stream is its own small ffmpeg that reads
  the court's [live view](#live-view-on-the-venue-wi-fi) from the box itself and sends it to the
  ingest URL, the same way as a [player's own stream](#players-own-live-stream). It never opens
  the camera (a Tapo C200 serves one RTSP client) and never touches the recorder: turning the
  stream on or off, or changing its key or layout, **never restarts the recording** and leaves no
  gap in clips or session parts. It runs about 10 s behind the court.
- **It needs the live view** (`LIVE_PORT`, on by default). With `LIVE_PORT=0` the court shows
  *"Live view is off on this box (LIVE_PORT=0)"*.
- **Recording comes first.** If the streaming service is unreachable or refuses the key,
  recording carries on and the court shows the reason (*"YouTube refused the stream key"*,
  *"Can't reach youtube.com"*, …). The stream retries after 5 s, 10 s, … up to 60 s.
- **Layouts** on a court with [two cameras](#two-cameras-on-one-court): *Cam 1*, *Cam 2* or
  *Both (stacked)*. A one-camera court always streams Cam 1.
- **The picture is the camera's own** for Cam 1 / Cam 2: video copied as-is (H.264, as the C200
  sends it), with the Tapo's on-screen time and logo but **without the venue watermark**. Audio is
  AAC at 44.1 kHz. An H.265 camera can't be streamed this way.
- **Bandwidth:** each streamed court sends about the camera's bitrate **up** (about 1–2 Mbit/s for
  a C200 at 720p, more at 1080p; ~3 Mbit/s stacked), on top of clip uploads. Check the venue's
  upload speed before turning on several courts.

## Two cameras on one court

A court can have a second camera (PLAN-002 §7), for example one behind each baseline.

- **Setup:** Admin portal → the court → **Camera 2 (optional)**, with the same guided steps, live
  check and preview as camera 1. Use the same kind of camera account and `/stream1` path. **Remove
  camera 2** there to go back to one camera.
- **Recording:** each camera has its own recorder and rolling buffer — camera 1 in
  `data/buffer/<court>/`, camera 2 in `data/buffer/<court>~cam2/` — with its own status, camera
  details and preview (`camera: 1 | 2` in the heartbeat). **Losing camera 2 never stops camera
  1.** Removing camera 2 stops its recorder; its folder ages out like any other.
- **60-second clips** are **stacked**: Cam 1 above Cam 2, each scaled to 1280×720, one
  1280×1440 video with the venue logo bottom-right. If one camera has no footage for that window,
  the clip is the other camera alone (the log says so).
- **Session parts** (whole-game recording) are cut **per camera** when the API asks for it
  (`camera: 1 | 2` on the job, CR-003): each part is one camera, full size, and the API joins each
  camera's parts into its own whole-game video ("Cam 1 – whole game", "Cam 2 – whole game"). A
  part job without a camera (an older API) is stacked like a clip. See
  [Sessions](#sessions-full-session-recording).
- **Live streams** (the venue's court stream and a player's own stream) can be *Cam 1*, *Cam 2*
  or *Both (stacked)*:
  - *Cam 1* / *Cam 2* copy that camera's video: no extra CPU.
  - *Both* decodes both cameras and encodes one 1280×1440 H.264 stream at ~3 Mbit/s with a
    keyframe every 2 s (which also ends Facebook's keyframe warning), at the slower camera's frame
    rate. It uses the box's clip encoder (`ENCODER`: VAAPI/QSV on an Intel box, VideoToolbox on a
    Mac, else `libx264 veryfast` — about one CPU core per stream on an N100).
  - If one camera of a stacked stream has no video, the stream shows the other camera alone
    (*"Live on YouTube (Camera 2 has no video — showing Camera 1)"*) and goes back to stacked
    when both are up again (checked at most every 30 s).
  - At most `MAX_STACKED_STREAMS` (default 2) stacked streams run at once on a box, court and
    player streams together. More show *"Too many stacked streams on this box — choose Cam 1 or
    Cam 2"*.
- **Sync:** the two cameras have their own clocks, so the halves can be up to about 1 s apart.
- **Sound** comes from Cam 1 (Cam 2's if Cam 1 has none).
- **Storage:** a second camera doubles that court's buffer and session footage (about
  0.5–1 GB per camera per hour at 720p). Stacked clips and parts are about twice the size of
  one camera's (a 5-min part stays under ~75 MB).
- **Upload:** stacked clips and parts upload about twice the bytes; per-camera session parts are
  two single-camera parts (≤ ~47 MB each) per window. A stacked live stream sends ~3 Mbit/s.
- **The session device's live view** stays Cam 1 (`/live/<courtId>/index.m3u8`); camera 2's is
  `/live/<courtId>/cam2/index.m3u8`, with the same signature.

## Live view on the venue Wi-Fi

A phone or tablet paired to a session (PLAN-002) shows the court live, about 5–10 s behind. The
video comes from the box over the venue Wi-Fi, not from the internet and not from a second camera
connection: the box serves the newest segments of its own buffer as an HLS live playlist, without
re-encoding.

```
GET http://<box-ip>:8090/live/<courtId>/index.m3u8?exp=<unix seconds>&sig=<hex>   → last 5 segments (~10 s)
GET http://<box-ip>:8090/live/<courtId>/<epoch>.ts?exp=…&sig=…                   → one segment
GET http://<box-ip>:8090/live/<courtId>/cam2/index.m3u8?exp=…&sig=…              → camera 2 (same signature)
```

- **Signed links only.** On first start the box makes a random key, `data/live-key` (mode 600),
  and sends it with its LAN address in every heartbeat (`live: { url, key }`). The API signs
  `courtId.exp` with it (HMAC-SHA256) when it hands a paired device its link; the box refuses a
  bad signature or an expired link (403). The key and signatures are never logged. Delete
  `data/live-key` to make a new key; the next heartbeat sends it.
- **Same Wi-Fi.** The device must be on the **same network as the box**. A guest network with
  **client isolation** (common on venue Wi-Fi) blocks it. The device then shows *"Live view needs
  the venue Wi-Fi"*; recording is not affected.
- **Firewall:** open TCP 8090 on the box: `sudo ufw allow 8090/tcp`.
- **Address:** the box picks its first private LAN IPv4 (192.168.x, 10.x, 172.16–31.x), skipping
  Docker and VPN interfaces. Give it a fixed address (DHCP reservation), or set `LIVE_HOST`.
- **Off:** `LIVE_PORT=0` (the heartbeat then sends `live: null`). If the port is taken, the box logs
  *"live view could not start on port 8090 … recording goes on without live view"* and keeps
  recording.
- A court that hasn't recorded for 30 s answers 404, so a stopped camera never shows a frozen
  picture as live.
- **Timestamps:** each buffer file starts its clock at 0 (`reset_timestamps`, for clip cutting).
  The live view moves each segment's clock forward by its start time in `segments.csv` as it
  sends it, so players see one running clock; a recorder restart is marked
  `#EXT-X-DISCONTINUITY`.

### HTTPS (`CERT_PATH`)

Set `CERT_PATH` to the certificate folder (for Let's Encrypt, `/etc/letsencrypt/live/<name>`) to
serve the live view as `https://<LIVE_HOST>:8090`. Use it when the session device or page can't
load plain-HTTP video.

- **`LIVE_HOST` must be a name the certificate covers** (e.g. `box1.example.com`), and that name
  must resolve to the box's **LAN** address on the venue Wi-Fi (local DNS, or a public DNS record
  pointing at the LAN IP). Phones refuse the certificate otherwise. At start the box warns if the
  certificate doesn't cover `LIVE_HOST` (or the detected IP), or has expired.
- **Readable by the box's user:** `privkey.pem` under `/etc/letsencrypt` is root-only. Copy the
  files to a folder the pm2 user can read (a renewal hook), or grant read access.
- **Renewals** are picked up within 6 hours, without a restart. A renewed file that can't be loaded
  is logged, and the previous certificate stays in use.
- **Unreadable certificate:** the box logs *"live view off — could not read privkey.pem and
  cert.pem in CERT_PATH …"* and keeps recording, without live view.
- Court and player live streams keep reading the box's own live view over plain HTTP on
  `127.0.0.1` (a second listener, loopback only). The court-button listener stays plain HTTP.

Check it from a laptop on the venue Wi-Fi (with a link from the API, which carries the signature):
`ffplay '<hlsUrl>'`. Note that ffmpeg tools need `-extension_picky 0` for segment links that end
in a query string: `ffprobe -extension_picky 0 '<hlsUrl>'`.

## Player's own live stream

A player can stream **their session** to **their own** Facebook or YouTube (PLAN-002 §6). They
scan a QR on the session device and paste their stream key on their phone; the API then sends
the session's stream address in `/config` (only while the session is recording), and the box
reports its status in the heartbeat (`sessionStreams`).

How the box does it:

- **Its own small ffmpeg per session**, reading the court's [live view](#live-view-on-the-venue-wi-fi)
  from the box itself (`http://127.0.0.1:<LIVE_PORT>/live/…`, signed with the box's own key)
  and sending it to the player's `rtmp://` / `rtmps://` address. With *Cam 1* or *Cam 2* the video
  is copied (only the audio is re-encoded to 44.1 kHz); *Both* is stacked and encoded (see
  [two cameras](#two-cameras-on-one-court)). **No second camera connection and no recorder
  restart**, so turning a player's stream on or off, or changing its layout, never leaves a gap
  in the recording, a clip or a session part.
- It starts when the session starts (or when the player adds the stream), stops when the session
  ends or the player stops it, and restarts on a new address or layout. If ffmpeg fails it retries after
  5 s, 10 s, … up to 60 s. A failure only affects that player's stream.
- It runs about 10 s behind the court.
- **At most 4** player streams per box; more show *"Too many player streams on this box"*.
- While a player's stream is due, the box reads its config and sends its heartbeat every 15 s,
  so a start or stop shows up within about 15 s.
- **Status** per session: *starting* (until output has flowed steadily for 5 s), *live*, or
  *error* with a reason: *Facebook refused the stream key*, *Can't reach facebook.com*,
  *Connection to youtube.com dropped*, *No video from the camera yet*, or *Live view is off on this
  box (LIVE_PORT=0)*: player streams need the live view.
- **The stream key is a secret:** logs and statuses show at most its last 4 characters
  (`rtmps://live-api-s.facebook.com:443/rtmp/****k2N9`). The box doesn't write it to disk: the
  cached config drops it.

Things to know:

- **Upload:** each player stream sends about the camera's bitrate **up** (1–2 Mbit/s for a C200 at
  720p), on top of a venue court stream and clip uploads. Check the venue's upload speed.
- **Facebook keyframes:** Facebook wants a keyframe at least every 2 seconds. With *Cam 1* /
  *Cam 2* the video is the camera's own (copied), and a Tapo C200 sends one every 2–6 s, so
  Facebook may show a *"keyframe frequency"* warning or buffer now and then (*Both* is encoded with
  a keyframe every 2 s and doesn't). The stream still runs. Where the camera allows it,
  set its keyframe interval (I-frame / GOP) to 2 s or less.
- **Audio** is re-encoded to AAC 44.1 kHz (the camera sends 8 kHz, which Facebook and YouTube may
  warn about or play silent). It's one small mono track, so it costs almost no CPU. (Not yet tried
  against the real services.)

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

- **Recording** (`src/recorder.js`): one ffmpeg per camera (two on a 2-camera court), `-rtsp_transport tcp -timeout 10s
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
  5. Encode H.264 at up to 1080p with AAC audio and `+faststart`. On a 2-camera court both
     cameras' segments are trimmed to the same window and stacked (1280×1440) in one ffmpeg.
  6. Make the thumbnail from the middle frame.
- **Camera setup** (`src/camera.js`): camera details and preview JPEGs read from the buffer, never
  from the camera.
- **Sessions:** session windows from `/config` protect their segments from pruning
  (`segments.js` `retentionWindows`); part jobs cut their exact window (`clipper.js`
  `selectPartSegments`), from the camera the job names (`planClip`, CR-003).
- **Stream keys** (`src/stream.js`): stream-key masking and reading ffmpeg's log lines.
- **Live view** (`src/live.js`): a `node:http` server on the LAN that turns the newest closed
  segments into a signed HLS live playlist and streams the files with their timestamps shifted.
- **Streams** (`src/restream.js`): one ffmpeg per venue court stream and per player stream,
  reading the box's own live view: one camera copied, or both stacked and encoded; backoff,
  status, caps and key masking.
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
| `[config] Missing ENROLL_KEY` | Set `ENROLL_KEY` and `VENUE_ID` in `.env` (a box with `data/device.json` doesn't need them). |
| *The API refused this box's ENROLL_KEY / VENUE_ID* | `ENROLL_KEY` must be exactly the API's `RECORDER_ENROLL_KEY` (no quotes, no spaces) and `VENUE_ID` the venue's **Copy ID**. Fix `.env`, then `pm2 restart dyna-cam-edge`. |
| *The API already refused this ENROLL_KEY / VENUE_ID* | The same values were refused before, so they aren't sent again. Fix `.env` and restart. |
| *Enrolment is turned off on the API* | Set `RECORDER_ENROLL_KEY` in `back/.env` and restart the API. The box retries every 5 min. |
| *enrolling is paused by the API* | Too many wrong keys (here or anywhere). The box waits as the API asks and tries again. |
| *This box was revoked* | It was blocked with `npm run boxes:revoke`. If that was a mistake (or it's back from repair), delete `data/revoked.json` and `pm2 restart dyna-cam-edge` — it enrols as a new box. |
| `DEVICE TOKEN REJECTED (401)` in the log | The box was revoked; it records that in `data/revoked.json` and stops. See the row above. |
| *DEVICE_TOKEN / PAIRING_CODE in .env is no longer used* | Harmless — delete the line. Boxes enrol with `ENROLL_KEY` and `VENUE_ID` now. |
| 403 `BOT_BLOCKED` | Something stripped the `User-Agent` (a proxy?). The box sends `DynaCamRecorder/<version>`. |
| Court shows *Camera not reachable — check Wi-Fi/power* | Camera powered? Same network? `ping <camera-ip>`. Weak 2.4 GHz signal at the court? |
| *Camera rejected the username/password* | Use the Tapo **Camera Account**, not the cloud login. The box tries again only every 2 → 15 min (each try is a sign-in, and too many lock the camera); saving the court's camera address in Admin retries at once. |
| *The camera is locked* | The camera refuses everyone after too many failed sign-ins (a Tapo answers `400 Server is locked`). Restart the camera (unplug 10 s, or Tapo app → Restart), then `pm2 restart dyna-cam-edge` to connect at once. Otherwise the box waits 5 → 15 min between tries, so the lock can clear (BUG-002). |
| *Camera stream not found* | The path must be `/stream1` |
| Clips fail with *Camera was not recording at that time* | The court was in error at that moment. Check the camera and the heartbeat history. |
| Clips fail with *…too late — already overwritten* | The box was busy or offline for minutes. Raise `BUFFER_SECONDS` or check the network. |
| `box clock is …s behind/ahead of the server` | NTP isn't working: `chronyc tracking`, `timedatectl` |
| Clips cut a few seconds off | Check the clock (above), then the camera's own time. |
| Slow cuts / high CPU | Check that the startup log says `h264_qsv`/`h264_vaapi`, and that `vainfo` works |
| Button does nothing | `curl "http://<box-ip>:8089/health"` from the same Wi-Fi. Is the box firewall open on 8089 (`sudo ufw allow 8089/tcp`)? Check `pm2 logs` for `401` (key) or "not set on any court". |
| Device shows *Live view needs the venue Wi-Fi* | Device on the same Wi-Fi as the box (not a guest network with client isolation)? Box firewall open on 8090 (`sudo ufw allow 8090/tcp`)? Does the startup log say `live view on http://<ip>:8090` with the right address (else set `LIVE_HOST`)? Is the court recording? |
| Player stream *refused the stream key* | The player pasted an old or wrong key, or ended the live video in their Facebook/YouTube app. They paste a new key on their phone. |
| Player stream *Can't reach facebook.com / youtube.com* | Venue internet up? Some networks block outgoing RTMP (port 1935) or RTMPS (443 to `live-api-s.facebook.com`). |
| Player stream *No video from the camera yet* | The court isn't recording (camera offline) — fix that first. The stream retries on its own. |
| Session part failed "Camera recorded only N%…" | The camera dropped out for over a minute in that part. Check Wi-Fi and the heartbeat history. |
| Session part failed "Camera 2 was not recording…" / "Camera 2 recorded only N%…" | Same, for that camera of a two-camera court; the other camera's part is made on its own. |
| Session part failed "This court has no camera 2" | Camera 2 was removed from the court while a game was booked. Cam 1's video is unaffected. |
| `low disk` / `session footage is no longer kept` | Free space: `df -h`, then `du -sh data/*`. See [disk sizing](#sessions-full-session-recording). |
| Setup page shows no preview / details | The court must be **Recording** first. Previews wait while clips are being made, and the page updates every 15–30 s. |
| Court stream *Can't reach youtube.com / facebook.com* | Venue internet up? Is the ingest URL right (`rtmp://` vs `rtmps://`, port)? The box keeps retrying (5 s → 60 s). |
| Court stream *refused the stream key* | The key was reset or the live event ended. Paste the new ingest URL in Admin → Courts. |
| Stream *Live view is off on this box* | Streams read the box's live view: remove `LIVE_PORT=0` from `.env` and restart. |
| *Too many stacked streams on this box* | Choose Cam 1 or Cam 2 for one of the streams, or raise `MAX_STACKED_STREAMS` if the box has the CPU/encoder for it. |
| Stacked stream shows one camera | The other camera has no video (check its status in the court setup page). It stacks again once both are up. |
| Stacked clip shows one camera | That camera had no footage for the window (log: *camera 2 has no footage for that window*). |
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
