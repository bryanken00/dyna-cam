# Recorder box installation — Windows and Mac

Created: 2026-11-24

How to set up a venue's recorder box (a Windows PC or a Mac at the venue) and connect it to the
DGSports cloud at `https://office.dynamicglobalsoft.com:1343`. Linux boxes: see
[`edge/README.md`](../edge/README.md) → Install, then come back for steps 4 onward.

The box records each court's camera, makes each game's video, keeps it on its own disk and sends it
to the court's Google Drive. It only calls out to the internet, so the venue needs no port
forwarding. Players' phones on the venue Wi-Fi watch the live view straight from the box.

**Contents**

1. [What you need](#1-what-you-need)
2. [Values that must match the cloud](#2-values-that-must-match-the-cloud)
3. [Install the software](#3-install-the-software) — [Windows](#windows) · [Mac](#mac)
4. [Get the code](#4-get-the-code)
5. [Set up `edge/.env`](#5-set-up-edgeenv)
6. [First start and check](#6-first-start-and-check)
7. [Run it as a service](#7-run-it-as-a-service) — [Windows](#windows-1) · [Mac](#mac-1)
8. [Live view over HTTPS](#8-live-view-over-https)
9. [Courts, cameras and Google Drive](#9-courts-cameras-and-google-drive)
10. [Updating the box](#10-updating-the-box)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. What you need

| Item | Notes |
| --- | --- |
| **The box** | A Windows 10/11 PC or a Mac, always on. 8 GB RAM, an SSD with plenty of free space (each game's video is kept on it for the venue's keep time — 1–2 TB for a busy venue). |
| **Wired network** | Plug the box into the venue router with a cable. Cameras may be on Wi-Fi; the box should not be. |
| **Fixed LAN IP** | A DHCP reservation for the box in the venue router (e.g. `192.168.254.121`). The live view's DNS name points at this address. |
| **Cameras** | RTSP cameras (Tapo C200) on the same network, each with its own fixed IP. See [`edge/README.md`](../edge/README.md) → Tapo C200 setup. |
| **Access** | A cloud Admin login with venue/court rights, read access to the GitHub repo, and access to the domain's DNS (for the live view). |
| **From whoever runs the cloud** | The recorder enrol key (step 2). Treat it like a password. |

---

## 2. Values that must match the cloud

The box finds and joins the cloud using three values. Get them **before** you start.

| Box `edge/.env` | Must equal | Where to find it |
| --- | --- | --- |
| `API_URL` | The cloud **API** address | `https://office.dynamicglobalsoft.com:1342` — the API's own port (`PORT=1342` in the server's `back/.env`). No trailing slash, no `/api`. Not `:1343` (that is the website). |
| `ENROLL_KEY` | `RECORDER_ENROLL_KEY` in the **server's** `back/.env` | Ask whoever runs the server. Copy it exactly: no quotes, no spaces. If the server's value is empty, boxes can't join ("Enrolment is turned off"). |
| `VENUE_ID` | The venue's ID **in the cloud** | Cloud Admin → Setup → Venues → the venue → **Copy ID**. An ID from a local/test database won't work. |

Things set on the **server** only (not on the box), which the box depends on:

| Server `back/.env` | Why the box needs it |
| --- | --- |
| `RECORDER_ENROLL_KEY` | Lets boxes join. Generate once with `openssl rand -hex 32`. |
| `DEVICE_SECRET_KEY` | Keeps the camera addresses (with their passwords) readable. Never change it once cameras are entered. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | Each court's Google Drive, where the box sends the videos. The redirect URI (`https://office.dynamicglobalsoft.com:1342/api/v1/oauth/google/callback`) must also be listed in the Google Cloud OAuth client. |

---

## 3. Install the software

The box needs **Node.js 20.12 or newer**, **ffmpeg 5 or newer**, **Git**, **pm2**, and a correct
clock (videos are matched to the camera footage by time).

### Windows

Open **PowerShell as Administrator**:

```powershell
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Gyan.FFmpeg -e
winget install --id Git.Git -e
```

Close PowerShell and open it again (so the new programs are on the PATH), then:

```powershell
node -v                      # v20.12 or newer
ffmpeg -version              # first line: 5.x or newer
npm install -g pm2
```

Then, in Windows settings:

- **Clock:** Settings → Time & language → Date & time → **Set time automatically** on, then
  **Sync now**.
- **Never sleep:** Settings → System → Power → Screen and sleep → **Sleep: Never** (plugged in).
  Or in PowerShell: `powercfg /change standby-timeout-ac 0`.
- **Network type:** Settings → Network → your wired connection → **Private network** (so the
  firewall rule in step 6 applies).

### Mac

Install [Homebrew](https://brew.sh) if it isn't there, then in Terminal:

```bash
brew install node ffmpeg git
node -v                      # v20.12 or newer
ffmpeg -version | head -1    # 5.x or newer
npm install -g pm2
```

Then:

- **Clock:** System Settings → General → Date & Time → **Set time and date automatically** on.
- **Never sleep, restart after a power cut:**

  ```bash
  sudo pmset -a sleep 0 disksleep 0
  sudo pmset -a autorestart 1
  ```

  On a MacBook, also keep it plugged in and lid open (or use it with an external display).
- **Firewall:** the first time the box starts, macOS asks whether **node** may accept incoming
  connections — choose **Allow** (needed for the live view).

---

## 4. Get the code

Keep the box's copy somewhere simple, on its internal disk.

**Windows** (PowerShell, not as Administrator):

```powershell
cd C:\
git clone https://github.com/bryanken00/dyna-cam.git dgsports
cd C:\dgsports\edge
npm ci --omit=dev
copy .env.example .env
```

**Mac:**

```bash
git clone https://github.com/bryanken00/dyna-cam.git ~/dgsports
cd ~/dgsports/edge
npm ci --omit=dev
cp .env.example .env
```

The repository is private: sign in when Git asks (a GitHub account with access, or a personal
access token as the password).

---

## 5. Set up `edge/.env`

Open `edge/.env` (Windows: `notepad C:\dgsports\edge\.env`; Mac: `nano ~/dgsports/edge/.env`) and
set these. Everything not listed can keep the value from `.env.example`.

```ini
# --- Must match the cloud (step 2) ---
API_URL=https://office.dynamicglobalsoft.com:1342
ENROLL_KEY=<exactly the server's RECORDER_ENROLL_KEY>
VENUE_ID=<cloud Admin → Venues → the venue → Copy ID>

# --- This box ---
# How it's named on the server (optional; default the computer name)
BOX_NAME=bigpickle-box-1
DATA_DIR=./data
ENCODER=auto

# --- Live view for phones on the venue Wi-Fi ---
LIVE_PORT=8090
# Leave these two empty until step 8 is done
LIVE_HOST=
CERT_PATH=
```

- **One box per venue**, and one `VENUE_ID` per box.
- After the first start the box keeps its own login in `edge/data/device.json`; `ENROLL_KEY` and
  `VENUE_ID` are only used to join again after a reset. Keep them in `.env` anyway.
- **Moving a box that already joined another server** (e.g. from a local test API to the cloud)?
  Stop it and move `edge/data/device.json`, `config.json`, `queue.json` and `videos/` out of
  `data/` **before** changing `API_URL`. Otherwise the cloud refuses its old login and the box
  locks itself (see [Troubleshooting](#11-troubleshooting) → *This box was revoked*).

---

## 6. First start and check

Start it in the foreground the first time, so you can read the log:

```bash
npm start
```

Within a minute you should see the box join the venue (`Enrolled as <name> for <venue>`), then
one recorder start per court with a camera, and `live view on http://<LAN IP>:8090`.

Check from the cloud side:

1. On the server: `cd back && npm run boxes` lists the box, its venue and its last heartbeat.
2. Cloud Admin → the venue's courts show their cameras **Recording** (Dashboard / court setup).

**Open the live-view port** so phones on the Wi-Fi can reach the box:

- **Windows** (PowerShell as Administrator):

  ```powershell
  New-NetFirewallRule -DisplayName "DGSports live view" -Direction Inbound -Protocol TCP -LocalPort 8090 -Action Allow -Profile Private
  ```

- **Mac:** answered by the **Allow** prompt in step 3. If you clicked Deny: System Settings →
  Network → Firewall → Options → set **node** to *Allow incoming connections*.

Press **Ctrl+C** to stop it (every recording stops cleanly), then run it as a service.

---

## 7. Run it as a service

pm2 keeps the box running, restarts it after a crash, and starts it after a reboot.

```bash
npm run pm2:start          # starts "dyna-cam-edge"
pm2 save                   # remember it for reboots
pm2 install pm2-logrotate  # keep the logs from filling the disk
pm2 logs dyna-cam-edge     # watch the log (Ctrl+C leaves it running)
```

### Windows

`pm2 startup` doesn't work on Windows. Start the box at sign-in with a scheduled task (PowerShell
as the user who ran `pm2 save`, as Administrator):

```powershell
$action  = New-ScheduledTaskAction -Execute "$env:APPDATA\npm\pm2.cmd" -Argument "resurrect"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
Register-ScheduledTask -TaskName "DGSports recorder box" -Action $action -Trigger $trigger -RunLevel Highest
```

Then make Windows **sign in automatically** after a restart or power cut: press Win+R, run
`netplwiz`, untick *Users must enter a user name and password*, and enter the password. (On newer
Windows 11 builds, first turn off Settings → Accounts → Sign-in options → *For improved security,
only allow Windows Hello sign-in*.)

### Mac

```bash
pm2 startup
```

It prints one `sudo env PATH=… pm2 startup launchd …` line — copy and run it. Then `pm2 save`
again.

---

## 8. Live view over HTTPS

The website is `https://`, so browsers refuse the box's plain-`http://` live video ("Live view
needs the venue Wi-Fi" on the game page, even on the right Wi-Fi). The box needs its **own name and
certificate**. The website's certificate can't be reused: it only covers
`office.dynamicglobalsoft.com`, which points at the server, not the box.

### 8.1 Pick a name and add the DNS record

One name per box, e.g. `box1.dynamicglobalsoft.com` (or, for many venues,
`bigpickle-1.live.dynamicglobalsoft.com` — see 8.2).

At the DNS provider for `dynamicglobalsoft.com`, add an **A record**: `box1` → the box's **LAN
IP** (e.g. `192.168.254.121`). It only works for devices on the venue network, which is the point.

### 8.2 Get the certificate

The box can't be reached from the internet, so use Let's Encrypt's **DNS challenge**: certbot
shows a `TXT` record, you add it at the DNS provider, and certbot checks it.

**Easiest: on a Mac** (any Mac, including the box itself). No `sudo` needed:

```bash
brew install certbot
certbot certonly --manual --preferred-challenges dns -d box1.dynamicglobalsoft.com \
  --config-dir ~/letsencrypt/config --work-dir ~/letsencrypt/work --logs-dir ~/letsencrypt/logs
```

**Or on the cloud server** (certbot is already there):

```bash
sudo certbot certonly --manual --preferred-challenges dns -d box1.dynamicglobalsoft.com
```

When certbot shows the `TXT` value, add a `TXT` record named `_acme-challenge.box1` with that value.
Wait until this prints it, then press Enter in certbot:

```bash
dig +short TXT _acme-challenge.box1.dynamicglobalsoft.com @1.1.1.1
```

(Windows: `nslookup -type=TXT _acme-challenge.box1.dynamicglobalsoft.com 1.1.1.1`.)

**Several venues:** issue one wildcard instead, `-d '*.live.dynamicglobalsoft.com'`, and name each
box under it (`bigpickle-1.live.dynamicglobalsoft.com`, …). Don't use `*.dynamicglobalsoft.com`:
that key would also cover the website, and it sits on every venue box.

### 8.3 Put the files on the box

The box needs three files: `privkey.pem`, `cert.pem` and `chain.pem`. Keep them **outside the
repository** (the `edge/` folder isn't set to ignore them, so they could end up in a commit).

| Where the certificate was made | Box | `CERT_PATH` |
| --- | --- | --- |
| On the box itself (Mac) | Mac | `/Users/<you>/letsencrypt/config/live/box1.dynamicglobalsoft.com` (use as is) |
| Elsewhere → copied | Mac | e.g. `/Users/<you>/box-cert` |
| Elsewhere → copied | Windows | e.g. `C:/dgsports-cert` (forward slashes) |

When copying from a certbot folder, copy the real files, not the shortcuts: on the server,
`sudo cp -L /etc/letsencrypt/live/box1.dynamicglobalsoft.com/{privkey,cert,chain}.pem <dest>/`.

### 8.4 Turn it on

In `edge/.env`:

```ini
LIVE_HOST=box1.dynamicglobalsoft.com
CERT_PATH=/Users/<you>/letsencrypt/config/live/box1.dynamicglobalsoft.com
```

Restart: `pm2 restart dyna-cam-edge`. The log should say `live view on https://box1.dynamicglobalsoft.com:8090`.
If it says the certificate couldn't be read or doesn't cover the name, the live view stays off
(recording goes on) — fix the path or name and restart.

### 8.5 Check from a phone or laptop on the venue Wi-Fi

1. `nslookup box1.dynamicglobalsoft.com` answers the box's LAN IP. If it answers nothing, the router
   blocks public names that point at private addresses ("DNS rebind protection"): allow
   `dynamicglobalsoft.com` in the router, or add the name to the router's local DNS.
2. Open a game that is recording. Chrome/Brave may ask to let the site **access devices on your
   local network** — choose **Allow**. In Brave, lower Shields for the site if the video still
   doesn't show.
3. The Wi-Fi must not be a guest network with client isolation.

### 8.6 Renewal (every 90 days)

A manual DNS certificate doesn't renew itself. Before it expires, run the same certbot command again
(add the new `TXT` value), and copy the files again if the box doesn't hold them. The box picks up
renewed files within 6 hours, no restart needed. (Your DNS provider's certbot plugin can automate
this.)

---

## 9. Courts, cameras and Google Drive

All in the **cloud Admin**:

1. **Courts:** Setup → Venues → the venue → add each court with its camera's RTSP address,
   `rtsp://<camera-account-user>:<password>@<camera-ip>:554/stream1`. The box picks up changes
   within a minute.
2. **Camera check:** the court's setup page shows the camera's picture and details once the box
   is recording it.
3. **Google Drive:** Setup → the court → Google Drive → **Connect**, and sign in with that court's
   Google account. Until it's connected the box keeps the games' videos and players get no link;
   connecting sends them.
4. **Try a game end to end:** book the court, check in at its QR with the booking code, play a
   minute, End game. The game page should show "sending to Google Drive", then **Open in Google
   Drive**.

---

## 10. Updating the box

```bash
cd ~/dgsports            # Windows: cd C:\dgsports
git pull
cd edge
npm ci --omit=dev
pm2 reload dyna-cam-edge
```

The job queue and kept videos survive the restart.

---

## 11. Troubleshooting

| What you see | What to do |
| --- | --- |
| `Missing API_URL` / `Missing ENROLL_KEY` | `.env` must be inside `edge/` and filled in (step 5). |
| *The API refused this box's ENROLL_KEY / VENUE_ID* | `ENROLL_KEY` isn't exactly the server's `RECORDER_ENROLL_KEY`, or `VENUE_ID` isn't a cloud venue. Fix `.env`, restart. |
| *Enrolment is turned off on the API* | The server has no `RECORDER_ENROLL_KEY`. Set it, restart the API; the box retries every 5 min. |
| *This box was revoked* (and it exits) | Either it was revoked on purpose (`npm run boxes:revoke`), or it still had a login from another server when `API_URL` changed. Delete `edge/data/revoked.json` and restart — it joins again as a new box. |
| Courts show *Camera not reachable* | Camera powered and on the same network? `ffprobe -rtsp_transport tcp -i "rtsp://user:pass@<camera-ip>:554/stream1"` from the box. |
| *Camera rejected the username/password* | Use the Tapo **Camera Account**, not the Tapo cloud login. |
| `box clock is …s behind/ahead` | Turn on automatic time (step 3) and sync. |
| Game page: *Live view needs the venue Wi-Fi* | On the venue Wi-Fi (not a guest network)? Port 8090 open (step 6)? Website on `https://` → the box needs step 8. |
| Live view off after setting `CERT_PATH` | The log says why: wrong folder, unreadable files, or the certificate doesn't cover `LIVE_HOST`. |
| Game stuck at "sending to Google Drive" | Venue internet down or slow — it resumes by itself. Is the court's Google Drive connected (step 9)? |
| Box stops overnight (Mac/Windows) | It went to sleep — redo the "never sleep" settings in step 3. |

More detail: [`edge/README.md`](../edge/README.md) (box internals, cameras, streaming) and
[`cloud-deployment-runbook.md`](cloud-deployment-runbook.md) (the server side).
