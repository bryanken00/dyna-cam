# Recorder box installation — Windows

Created: 2026-11-24

How to set up a **Windows PC** as the venue's **recorder box** and connect it to the DGSports
cloud. The box records the court cameras and sends each game to Google Drive.
(Mac box: see [recorder-box-installation.md](recorder-box-installation.md).)

Everything below is done **on the Windows PC**, except where it says *Cloud Admin* (a web
browser). Nothing is installed on the server.

**Two kinds of PowerShell are used** — the step always says which:

- **Admin PowerShell:** Start → type *PowerShell* → right-click → **Run as administrator**.
- **PowerShell:** Start → type *PowerShell* → open it normally.

---

## Part A — Before you start

### A1. You need

- [ ] A **Windows 10/11 PC** that stays on at the venue, plugged in with a **network cable** to the
      venue router.
- [ ] The PC's **fixed LAN IP** — ask for a DHCP reservation in the router
      (example used below: `192.168.254.121`).
- [ ] The court **cameras** on the same network, each with a fixed IP and an RTSP account.
- [ ] A **Cloud Admin** login: `https://office.dynamicglobalsoft.com:1343`
- [ ] Read access to the **GitHub repo** `bryanken00/dyna-cam`.

Find the PC's LAN IP: **PowerShell** → `ipconfig` → *IPv4 Address* under the cable (Ethernet)
adapter.

### A2. Write down these 3 values

They connect the box to the cloud. They must be exact.

| Value | What to write down | Where to get it |
| --- | --- | --- |
| **API_URL** | `https://office.dynamicglobalsoft.com:1342` | Always this. Port **1342** (the API), not 1343 (the website). |
| **ENROLL_KEY** | a 43-character code | The venue's company's **Box enroll key** — DGSports generates it in the back office and gives it to you. It only works for that company's venues. Treat it like a password. |
| **VENUE_ID** | a code like `567311c4-e7c9-…` | Cloud Admin → Setup → Venues → your venue → **Copy ID** |

---

## Part B — Install the programs

1. Open **Admin PowerShell** and install Node.js, ffmpeg and Git:

   ```powershell
   winget install --id OpenJS.NodeJS.LTS -e
   winget install --id Gyan.FFmpeg -e
   winget install --id Git.Git -e
   ```

2. **Close it and open Admin PowerShell again** (so Windows finds the new programs).
3. Install pm2 and check the versions:

   ```powershell
   npm install -g pm2
   node -v
   ffmpeg -version
   ```

   `node -v` must say **v20.12 or newer**. ✅
4. Allow PowerShell scripts for your user (needed by `npm` and Part F):

   ```powershell
   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned -Force
   ```

5. Turn on automatic time: Settings → Time & language → Date & time → **Set time automatically**
   → **Sync now**.
6. Stop the PC from sleeping:

   ```powershell
   powercfg /change standby-timeout-ac 0
   ```

7. Mark the network as private: Settings → Network & internet → Ethernet → **Private network**.

---

## Part C — Download the box program

In **PowerShell**:

```powershell
cd C:\
git clone https://github.com/bryanken00/dyna-cam.git dgsports
cd C:\dgsports\edge
npm ci --omit=dev
copy .env.example .env
```

When Git asks you to sign in, use a GitHub account that can see the repo.

---

## Part D — Connect the box to the cloud

1. Open the settings file:

   ```powershell
   notepad C:\dgsports\edge\.env
   ```

2. Set these lines (use your values from **A2**), then **Save**:

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
3. Start the box, in **PowerShell**:

   ```powershell
   cd C:\dgsports\edge
   npm start
   ```

4. Within a minute the log says **`Enrolled as bigpickle-box-1 for <venue>`**. ✅
   Leave this window open.
5. Open the live-view port, in **Admin PowerShell**:

   ```powershell
   New-NetFirewallRule -DisplayName "DGSports live view" -Direction Inbound -Protocol TCP -LocalPort 8090 -Action Allow -Profile Private
   ```

   If Windows shows a firewall pop-up for **Node.js**, tick **Private networks** → **Allow**.

> **This PC was connected to another server before** (e.g. a local test)? Stop it first
> (**Ctrl+C**), and move `device.json`, `config.json`, `queue.json` and the `videos` folder out of
> `C:\dgsports\edge\data\` before changing `API_URL`. Otherwise it locks itself — see *This box
> was revoked* in Part I.

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
**name and certificate**. We use a free **DuckDNS** name and **Posh-ACME** (a PowerShell tool) —
no access to the website's domain or server is needed.

### F1. Create the name

1. Go to **duckdns.org** and sign in (Google or GitHub).
2. Add a subdomain, e.g. `bigpickle-box1` → you get `bigpickle-box1.duckdns.org`.
3. In **current ip**, type the PC's **LAN IP** (e.g. `192.168.254.121`) → **update ip**.
   (Not the address DuckDNS fills in by itself — that's your internet address.)
4. Copy your **token** from the top of the page (36 characters, like `a1b2c3d4-e5f6-…`).

### F2. Check the name

In **PowerShell**:

```powershell
Resolve-DnsName bigpickle-box1.duckdns.org -Server 1.1.1.1
```

The *IPAddress* must be the PC's LAN IP (`192.168.254.121`). ✅

### F3. Install Posh-ACME

In **PowerShell** (answer **Y** if it asks about NuGet or an untrusted repository):

```powershell
Install-Module -Name Posh-ACME -Scope CurrentUser
```

### F4. Get the certificate

In **PowerShell**. Put your token and subdomain in the first two lines:

```powershell
$token  = 'PASTE-YOUR-TOKEN-HERE'
$name   = 'bigpickle-box1'

Set-PAServer LE_PROD
$duck = @{ DuckToken = (ConvertTo-SecureString $token -AsPlainText -Force); DuckDomain = $name }
New-PACertificate "$name.duckdns.org" -AcceptTOS -Plugin DuckDNS -PluginArgs $duck -DnsSleep 60
```

It waits about a minute, then lists the new certificate. ✅
(Posh-ACME remembers the token for renewals — you don't type it again.)

### F5. Copy the files where the box reads them

In **PowerShell** — this makes `C:\dgsports-cert` and a small script that copies the files (the
same script renews them in Part H):

```powershell
New-Item -ItemType Directory -Force C:\dgsports-cert | Out-Null
@'
Import-Module Posh-ACME
Submit-Renewal -ErrorAction SilentlyContinue   # renews only when due (after 60 days)
$c = Get-PACertificate
Copy-Item $c.KeyFile   C:\dgsports-cert\privkey.pem -Force
Copy-Item $c.CertFile  C:\dgsports-cert\cert.pem    -Force
Copy-Item $c.ChainFile C:\dgsports-cert\chain.pem   -Force
'@ | Set-Content C:\dgsports-cert\renew.ps1

powershell -ExecutionPolicy Bypass -File C:\dgsports-cert\renew.ps1
dir C:\dgsports-cert
```

You see `privkey.pem`, `cert.pem` and `chain.pem`. ✅

> Keep `C:\dgsports-cert` **outside** `C:\dgsports`, so the files can never be committed.

### F6. Point the box at the certificate

1. `notepad C:\dgsports\edge\.env` and set (forward slashes in the path):

   ```ini
   LIVE_HOST=bigpickle-box1.duckdns.org
   CERT_PATH=C:/dgsports-cert
   ```

2. Restart the box: in its window press **Ctrl+C**, then `npm start`.
3. The log says **`live view on https://bigpickle-box1.duckdns.org:8090`**. ✅

### F7. Test

On a phone or laptop **on the venue Wi-Fi**, open a game that is recording. If the browser asks to
*access devices on your local network* → **Allow**. The live picture shows. ✅

If it still says *Live view needs the venue Wi-Fi*, see Part I.

---

## Part G — Keep it running (start on boot)

1. Stop the box window (**Ctrl+C**), then in **PowerShell**:

   ```powershell
   cd C:\dgsports\edge
   npm run pm2:start
   pm2 save
   pm2 install pm2-logrotate
   ```

2. Start it when Windows signs in — **PowerShell**, signed in as the box's user (pm2 doesn't need
   admin rights, so the task runs without them):

   ```powershell
   $action  = New-ScheduledTaskAction -Execute "$env:APPDATA\npm\pm2.cmd" -Argument "resurrect"
   $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
   Register-ScheduledTask -TaskName "DGSports recorder box" -Action $action -Trigger $trigger -RunLevel Limited
   ```

3. Make Windows sign in by itself after a restart or power cut:
   Win+R → `netplwiz` → untick **Users must enter a user name and password** → OK → enter the
   password.
   (Option missing on Windows 11? First turn off Settings → Accounts → Sign-in options → *For
   improved security, only allow Windows Hello sign-in*.)
4. Restart the PC once to check: after sign-in, `pm2 list` shows **dyna-cam-edge** *online*. ✅
5. Useful commands (**PowerShell**):

   | To… | Run |
   | --- | --- |
   | See the log | `pm2 logs dyna-cam-edge` |
   | Restart | `pm2 restart dyna-cam-edge` |
   | Stop | `pm2 stop dyna-cam-edge` |

---

## Part G½ — Lock it down

Once the box records and starts on boot, harden it with
[Recorder box security](recorder-box-security.md): enrolment off again, its own Standard account,
firewall, updates, cameras. After the next restart, `pm2 logs dyna-cam-edge` should show no
`security:` lines.

---

## Part H — Regular jobs

### H1. Renew the certificate automatically

Once, in **Admin PowerShell** signed in as the box's user — runs the Part F5 script every day
(it only renews when due, and the box picks up new files within 6 hours):

```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -File C:\dgsports-cert\renew.ps1"
$trigger = New-ScheduledTaskTrigger -Daily -At 3am
Register-ScheduledTask -TaskName "DGSports certificate renewal" -Action $action -Trigger $trigger -User $env:USERNAME -RunLevel Highest
```

### H2. Other jobs

| When | What | How |
| --- | --- | --- |
| The PC's LAN IP changes | Update the DuckDNS name | duckdns.org → type the new IP → **update ip**. (A router reservation avoids this.) |
| A new version is released | Update the box | **PowerShell**: `cd C:\dgsports` → `git pull` → `cd edge` → `npm ci --omit=dev` → `pm2 reload dyna-cam-edge` |

---

## Part I — Problems and fixes

| You see | Fix |
| --- | --- |
| `node`, `npm` or `ffmpeg` *is not recognized* | Close PowerShell and open it again after installing (Part B step 2). |
| *running scripts is disabled on this system* | Run Part B step 4 (`Set-ExecutionPolicy …`). |
| `Missing API_URL` or `Missing ENROLL_KEY` | `.env` must be in `C:\dgsports\edge` and filled in (Part D). Notepad may save it as `.env.txt` — choose *Save as type: All files*. |
| *The API refused this box's ENROLL_KEY / VENUE_ID* | One of them is wrong — or the key was regenerated / turned off, or the venue isn't that company's. Compare with A2 (no quotes, no spaces), ask DGSports for the current key if needed, save, restart. |
| *Enrolment is turned off on the API* | An older server without an enrol key. Ask DGSports to generate the company's Box enroll key. |
| *This box was revoked* and it stops | Delete `C:\dgsports\edge\data\revoked.json` and restart — it joins again as a new box. |
| Court shows *Camera not reachable* | Camera on and on the same network? Check its IP and RTSP account. |
| *Camera rejected the username/password* | Use the camera's RTSP account (Tapo: *Camera Account*), not the Tapo app login. |
| `box clock is …s behind/ahead` | Settings → Date & time → **Sync now** (Part B step 5). |
| *Live view needs the venue Wi-Fi* | ① Phone on the same Wi-Fi as the PC (not a guest network)? ② Firewall rule added (Part D step 5)? ③ Part F done and box restarted? ④ `Resolve-DnsName bigpickle-box1.duckdns.org` shows the PC's LAN IP? |
| The name doesn't resolve on the venue Wi-Fi | The router blocks names pointing at local addresses ("DNS rebind protection"). Allow `duckdns.org` in the router settings. |
| `New-PACertificate` fails | Wrong token or subdomain (F4), or DuckDNS was slow — run it again with `-DnsSleep 120`. |
| Live view off after setting `CERT_PATH` | The log says why: wrong folder (use `C:/dgsports-cert`), missing `.pem` files (rerun F5), or the certificate is for another name than `LIVE_HOST`. |
| Game stuck at *sending to Google Drive* | Venue internet slow or down (it continues by itself), or the court's Google Drive isn't connected (Part E). |
| Box stops overnight | The PC went to sleep — redo Part B step 6. |
| Box doesn't start after a restart | Check Part G steps 2–3 (scheduled task and automatic sign-in). |

Check that the server sees the box: whoever runs the server can run `cd back && npm run boxes`.
