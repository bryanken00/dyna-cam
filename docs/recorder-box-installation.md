# Recorder box installation — Windows and Mac

Created: 2026-11-24 · Updated: 2026-11-24

How to set up the **recorder box** at a venue and connect it to the DGSports cloud. The box is
a Windows PC or a Mac at the venue that records the court cameras and sends each game to Google
Drive.

Everything below is done **on the box**, except where it says *Cloud Admin* (a web browser).
Nothing is installed on the server.

---

## Part A — Before you start

### A1. You need

- [ ] A **Windows 10/11 PC** or a **Mac** that stays on at the venue, plugged in with a **network
      cable** to the venue router.
- [ ] The box's **fixed LAN IP** — ask for a DHCP reservation in the router
      (example used below: `192.168.254.121`).
- [ ] The court **cameras** on the same network, each with a fixed IP and an RTSP account.
- [ ] A **Cloud Admin** login: `https://office.dynamicglobalsoft.com:1343`
- [ ] Read access to the **GitHub repo** `bryanken00/dyna-cam`.

### A2. Write down these 3 values

They connect the box to the cloud. They must be exact.

| Value | What to write down | Where to get it |
| --- | --- | --- |
| **API_URL** | `https://office.dynamicglobalsoft.com:1342` | Always this. Port **1342** (the API), not 1343 (the website). |
| **ENROLL_KEY** | a 64-character code | `RECORDER_ENROLL_KEY` from the server's `back/.env` — ask whoever runs the server. Treat it like a password. |
| **VENUE_ID** | a code like `567311c4-e7c9-…` | Cloud Admin → Setup → Venues → your venue → **Copy ID** |

---

## Part B — Install the programs

Do **either** the Windows steps **or** the Mac steps.

### Windows

1. Open **PowerShell as Administrator** (Start → type *PowerShell* → *Run as administrator*).
2. Install Node.js, ffmpeg and Git:

   ```powershell
   winget install --id OpenJS.NodeJS.LTS -e
   winget install --id Gyan.FFmpeg -e
   winget install --id Git.Git -e
   ```

3. **Close PowerShell and open it again** (as Administrator).
4. Install pm2 and check the versions:

   ```powershell
   npm install -g pm2
   node -v        # must be v20.12 or newer
   ffmpeg -version
   ```

5. Turn on automatic time: Settings → Time & language → Date & time → **Set time automatically**.
6. Stop it from sleeping: `powercfg /change standby-timeout-ac 0`
7. Mark the network as private: Settings → Network → your cable connection → **Private network**.

### Mac

1. Open **Terminal**. Install [Homebrew](https://brew.sh) if you don't have it.
2. Install Node.js, ffmpeg, Git, pm2 and certbot:

   ```bash
   brew install node ffmpeg git certbot
   npm install -g pm2
   node -v        # must be v20.12 or newer
   ```

3. Turn on automatic time: System Settings → General → Date & Time → **Set time and date
   automatically**.
4. Stop it from sleeping, and restart it after a power cut:

   ```bash
   sudo pmset -a sleep 0 disksleep 0
   sudo pmset -a autorestart 1
   ```

   A MacBook: keep it plugged in and the lid open.

---

## Part C — Download the box program

**Windows** (normal PowerShell):

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

When Git asks you to sign in, use a GitHub account that can see the repo.

---

## Part D — Connect the box to the cloud

1. Open the settings file:
   - Windows: `notepad C:\dgsports\edge\.env`
   - Mac: `open -e ~/dgsports/edge/.env`
2. Set these lines (use your values from **A2**), and save:

   ```ini
   API_URL=https://office.dynamicglobalsoft.com:1342
   ENROLL_KEY=<your ENROLL_KEY>
   VENUE_ID=<your VENUE_ID>
   BOX_NAME=bigpickle-box-1
   LIVE_PORT=8090
   LIVE_HOST=
   CERT_PATH=
   ```

   Leave `LIVE_HOST` and `CERT_PATH` empty for now (Part F fills them in).
3. Start the box (in the `edge` folder):

   ```bash
   npm start
   ```

4. Within a minute the log says **`Enrolled as bigpickle-box-1 for <venue>`**. ✅
5. Open the live-view port:
   - **Windows** (PowerShell as Administrator):

     ```powershell
     New-NetFirewallRule -DisplayName "DGSports live view" -Direction Inbound -Protocol TCP -LocalPort 8090 -Action Allow -Profile Private
     ```

   - **Mac:** when macOS asks *"Do you want node to accept incoming connections?"* → **Allow**.

> **This box was connected to another server before** (e.g. a local test)? Stop it first, and
> move `device.json`, `config.json`, `queue.json` and the `videos` folder out of `edge/data/`
> before changing `API_URL`. Otherwise it locks itself — see *This box was revoked* in Part I.

---

## Part E — Add the courts in the Cloud Admin

In a browser, at `https://office.dynamicglobalsoft.com:1343`:

1. **Setup → Venues → your venue → add each court** with its camera address:
   `rtsp://<camera-user>:<camera-password>@<camera-ip>:554/stream1`
2. Within a minute the court shows **Recording**, and its setup page shows the camera picture. ✅
3. **Setup → the court → Google Drive → Connect**, and sign in with that court's Google account.
   Until this is done, players get no video link.

---

## Part F — Live view on phones (HTTPS)

The website is `https://`, so browsers only show the box's live video if the box has its own
**name and certificate**. We use a free **DuckDNS** name — no access to the website's domain or
server is needed.

> Windows box: do steps F1–F4 **on any Mac** (certbot isn't available for Windows), then copy the
> files in F5.

### F1. Create the name

1. Go to **duckdns.org** and sign in (Google or GitHub).
2. Add a subdomain, e.g. `bigpickle-box1` → you get `bigpickle-box1.duckdns.org`.
3. In **current ip**, type the box's **LAN IP** (e.g. `192.168.254.121`) → **update ip**.
   (Not the address DuckDNS fills in by itself — that's your internet address.)
4. Copy your **token** from the top of the page (36 characters, like `a1b2c3d4-e5f6-…`).

### F2. Save the token and the helper

In Terminal (change `bigpickle-box1` if your name is different):

```bash
mkdir -p ~/letsencrypt
echo 'PASTE-YOUR-TOKEN-HERE' > ~/letsencrypt/duckdns-token
chmod 600 ~/letsencrypt/duckdns-token

cat > ~/letsencrypt/duckdns-hook.sh <<'EOF'
#!/bin/sh
# certbot calls this; DuckDNS publishes the code certbot needs to see
curl -s "https://www.duckdns.org/update?domains=bigpickle-box1&token=$(cat ~/letsencrypt/duckdns-token)&txt=${CERTBOT_VALIDATION}"
sleep 60
EOF
chmod +x ~/letsencrypt/duckdns-hook.sh
```

### F3. Check the name

```bash
dig +short bigpickle-box1.duckdns.org @1.1.1.1
```

It must print the box's LAN IP (`192.168.254.121`). ✅

### F4. Get the certificate

```bash
certbot certonly --non-interactive --manual --preferred-challenges dns \
  -d bigpickle-box1.duckdns.org \
  --manual-auth-hook ~/letsencrypt/duckdns-hook.sh \
  --config-dir ~/letsencrypt/config --work-dir ~/letsencrypt/work --logs-dir ~/letsencrypt/logs
```

It prints `OK`, waits a minute, then **`Successfully received certificate`**. ✅
(The first time, certbot may ask for an email and to accept the terms — run it without
`--non-interactive` once.)

### F5. Point the box at the certificate

Set these two lines in `edge/.env`:

| Box | `LIVE_HOST` | `CERT_PATH` |
| --- | --- | --- |
| **Mac** (certificate made on it) | `bigpickle-box1.duckdns.org` | `/Users/<you>/letsencrypt/config/live/bigpickle-box1.duckdns.org` |
| **Windows** | `bigpickle-box1.duckdns.org` | `C:/dgsports-cert` (use forward slashes) |

For **Windows**: copy `privkey.pem`, `cert.pem` and `chain.pem` from the Mac's
`~/letsencrypt/config/live/bigpickle-box1.duckdns.org/` into `C:\dgsports-cert`. Copy the real
files (`cp -L` on the Mac), not shortcuts.

> Keep the certificate files **outside** the `dgsports` folder, so they can never be committed.

### F6. Restart and test

1. Restart the box: **Ctrl+C**, then `npm start`.
2. The log says **`live view on https://bigpickle-box1.duckdns.org:8090`**. ✅
3. On a phone or laptop **on the venue Wi-Fi**, open a game that is recording. If the browser
   asks to *access devices on your local network* → **Allow**. The live picture shows. ✅

If it still says *Live view needs the venue Wi-Fi*, see Part I.

---

## Part G — Keep it running (start on boot)

1. Stop the foreground box (**Ctrl+C**), then in the `edge` folder:

   ```bash
   npm run pm2:start
   pm2 save
   pm2 install pm2-logrotate
   ```

2. Start it automatically after a restart:
   - **Mac:**

     ```bash
     pm2 startup
     ```

     It prints one `sudo env PATH=…` line — copy it, run it, then `pm2 save` again.

   - **Windows** (PowerShell as Administrator, signed in as the box's user):

     ```powershell
     $action  = New-ScheduledTaskAction -Execute "$env:APPDATA\npm\pm2.cmd" -Argument "resurrect"
     $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
     Register-ScheduledTask -TaskName "DGSports recorder box" -Action $action -Trigger $trigger -RunLevel Highest
     ```

     Then make Windows sign in by itself: Win+R → `netplwiz` → untick *Users must enter a user
     name and password* → enter the password.

3. Useful commands:

   | To… | Run |
   | --- | --- |
   | See the log | `pm2 logs dyna-cam-edge` |
   | Restart | `pm2 restart dyna-cam-edge` |
   | Stop | `pm2 stop dyna-cam-edge` |

---

## Part H — Regular jobs

| When | What | How |
| --- | --- | --- |
| **Every ~60 days** | Renew the certificate (it lasts 90) | On the Mac: `certbot renew --config-dir ~/letsencrypt/config --work-dir ~/letsencrypt/work --logs-dir ~/letsencrypt/logs` — then, for a Windows box, copy the 3 files again (F5). The box picks them up within 6 hours. |
| **When the box's LAN IP changes** | Update the DuckDNS name | duckdns.org → type the new IP → **update ip**. (A router reservation avoids this.) |
| **New version released** | Update the box | In the `dgsports` folder: `git pull`, then in `edge`: `npm ci --omit=dev` and `pm2 reload dyna-cam-edge` |

---

## Part I — Problems and fixes

| You see | Fix |
| --- | --- |
| `Missing API_URL` or `Missing ENROLL_KEY` | `.env` must be inside the `edge` folder and filled in (Part D). |
| *The API refused this box's ENROLL_KEY / VENUE_ID* | One of them is wrong. Compare with A2 (no quotes, no spaces), save, restart. |
| *Enrolment is turned off on the API* | The server has no `RECORDER_ENROLL_KEY`. Ask whoever runs the server to set it. |
| *This box was revoked* and it stops | Delete `edge/data/revoked.json` and restart — it joins again as a new box. |
| Court shows *Camera not reachable* | Camera on and on the same network? Check its IP and RTSP account. |
| *Camera rejected the username/password* | Use the camera's RTSP account (Tapo: *Camera Account*), not the Tapo app login. |
| `box clock is …s behind/ahead` | Turn on automatic time (Part B). |
| *Live view needs the venue Wi-Fi* | ① Phone on the same Wi-Fi as the box (not a guest network)? ② Port 8090 open (Part D step 5)? ③ Part F done and box restarted? ④ `dig +short bigpickle-box1.duckdns.org` shows the box's LAN IP? |
| The name doesn't resolve on the venue Wi-Fi | The router blocks names pointing at local addresses ("DNS rebind protection"). Allow `duckdns.org` in the router settings. |
| DuckDNS helper prints `KO` | Wrong token or subdomain in `~/letsencrypt/duckdns-token` / the helper script (F2). |
| Live view off after setting `CERT_PATH` | The log says why: wrong folder, or the certificate is for another name than `LIVE_HOST`. |
| Game stuck at *sending to Google Drive* | Venue internet slow or down (it continues by itself), or the court's Google Drive isn't connected (Part E). |
| Box stops overnight | It went to sleep — redo the sleep settings in Part B. |

Check that the server sees the box: whoever runs the server can run `cd back && npm run boxes`.
