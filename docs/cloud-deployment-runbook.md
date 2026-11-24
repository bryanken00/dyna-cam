# Cloud deployment runbook — DGSports online, recording at the venue

Created: 2026-11-24 · Updated: 2026-11-24 for CR-040 (videos at the venue and on Google Drive)

How to run DGSports with **booking, payments, the Admin and every player page in the cloud**, while
**recording and the videos stay at each venue** on its recorder box. The cloud keeps only the
database: since CR-040 the box keeps each game's video and sends it **straight to the court's
Google Drive**, and players get their game only as a Drive link. The box only ever makes outgoing
HTTPS calls (to the API and to Google), so it works the same whether the API is on the next desk or
in a data centre.

Domains below are examples — `dgsports.ph` for the website and `api.dgsports.ph` for the API.
Use your own.

---

## 1. What runs where

```
CLOUD — one server                                   EACH VENUE
┌──────────────────────────────────────────┐         ┌────────────────────────────────────┐
│ nginx (HTTPS)                            │         │ Recorder box (mini PC, pm2, edge/) │
│  ├ dgsports.ph      → front/dist (static)│◄────────┤  • records the cameras (RTSP, LAN) │
│  └ api.dgsports.ph  → API :4021 (pm2)    │  HTTPS  │  • polls jobs, sends heartbeats    │
│ MySQL 8 (no video files)                 │  out    │  • keeps game videos on its SSD    │
│ back/public/uploads (logos, previews)    │  only   │  • live view on the venue Wi-Fi    │
│ Xendit webhooks · SendGrid · Google OAuth│         │ Cameras ── LAN ── box              │
└──────────────────────────────────────────┘         └─────────────────┬──────────────────┘
        ▲  phones, TVs, staff browsers (internet)                      │ HTTPS out: video bytes
                                                     ┌─────────────────▼──────────────────┐
                                                     │ Each court's Google Drive          │
                                                     │ (players open their game there)    │
                                                     └────────────────────────────────────┘
```

| Runs in the cloud | Stays at the venue |
| --- | --- |
| Booking pages, Find my booking, online payment (Xendit) | The cameras |
| Admin portal (venues, courts, bookings, sessions, payments) | The recorder box: recording, making each game's video, sending it to Drive |
| The game page (Drive links), TV court board, court QR / check-in page | Game videos, kept on the box for the venue's keep time (7 days, CR-026) |
| Emails, venue alerts, opening each Drive upload (the court's sign-in stays here) | The live view (box → phones on the venue Wi-Fi) |
| | Restreams to Facebook / YouTube (sent from the box) |

How a game reaches the player: after End game the box makes the file, asks the API where to send
it, and the API opens a Google Drive upload with the court's sign-in and hands the box its address.
The box sends the bytes to Google in pieces (resuming after a dropped line), then the API checks the
file in Drive and shares it by link. The Google secret and the court's sign-in never leave the
cloud; the video never passes through it.

**Nothing needs to reach into a venue.** No port forwarding, no public IP, no VPN: the box polls
the API (a long-poll of up to 30 s) and uploads to Google, so a normal internet connection is
enough.

---

## 2. What you need before starting

| Item | Notes |
| --- | --- |
| A domain | Two names: the website (`dgsports.ph`) and the API (`api.dgsports.ph`). Keep both under one domain so cookies stay same-site. |
| A Linux server (Ubuntu 24.04) | 2 vCPU / 4 GB RAM is plenty for the API; 40 GB of disk is enough (no videos — the database, logos and camera previews). |
| Node.js **22.12+** on the server | `back/` requires it (`engines`). |
| MySQL 8 | On the server, or a managed database. |
| nginx + certbot | HTTPS for both names; the API runs behind nginx (`trust proxy` is already on). |
| pm2 | Keeps the API running (`back/ecosystem.config.cjs`). |
| SendGrid account | Every email (booking confirmations, password resets, alerts, Drive links). |
| Google Cloud project (**required**) | Players get videos only through Google Drive (CR-040). |
| Per court: a Google account with enough Drive storage | About 35 GB a week per camera — a free account's 15 GB is not enough; use Google One or Workspace. See §10. |
| Xendit account (live keys) | Online booking payment. Without it, players can only pay at the desk. |
| Per venue: a recorder box | Intel N100-class mini PC, 8 GB RAM, **SSD 1–2 TB** (it keeps a week of games, §10), **wired** to the router, a small UPS. See `edge/README.md` → Hardware. |

---

## 3. Server — install

```bash
# As a sudo user on the server
sudo apt update && sudo apt install -y nginx mysql-server certbot python3-certbot-nginx git
# Node 22 (NodeSource), then pm2
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
sudo npm install -g pm2

# The code
sudo mkdir -p /srv/dgsports && sudo chown $USER /srv/dgsports
git clone <your repo URL> /srv/dgsports && cd /srv/dgsports
git checkout main
```

Database:

```sql
CREATE DATABASE dgsports CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'dgsports'@'localhost' IDENTIFIED BY '<a long random password>';
GRANT ALL PRIVILEGES ON dgsports.* TO 'dgsports'@'localhost';
```

---

## 4. API — `back/.env` for production

Copy `back/.env.example` to `back/.env`, then set at least these. Generate secrets with
`openssl rand -hex 32` (a different value for each).

| Setting | Production value | Why |
| --- | --- | --- |
| `NODE_ENV` | `production` | Turns on production checks; the payment sandbox is ignored. |
| `PORT` | `4021` | nginx proxies to it. |
| `APP_NAME` | `DGSports` | Name in emails. |
| `APP_URL` | `https://dgsports.ph` | **The website**, not the API: every link the API builds (booking pages, game pages, TV board, emails, checkout return) starts with it. |
| `FRONTEND_URL` | `https://dgsports.ph` | |
| `ALLOWED_ORIGINS` | `https://dgsports.ph` | CORS — the website is the only browser origin. |
| `COOKIE_SECURE` | `true` | HTTPS only. |
| `ALLOW_CROSS_SITE_CSRF` | `false` | Website and API share `dgsports.ph`, so it's same-site. |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASS` / `DB_DATABASE` | the database above | |
| `OWNER_EMAIL` | the first admin's email | `db:setup` creates this account. Leave `OWNER_PASSWORD` empty: it prints a random one once. |
| `ISSUER` / `AUDIENCE` | e.g. `dgsports` / `dgsports-users` | JWT claims. |
| `CSRF_SECRET`, `LOG_SALT`, `UPLOAD_URL_SECRET` | random, 32+ chars | Required; placeholders are refused in production. |
| `DEVICE_SECRET_KEY` | random, 32+ chars | Encrypts camera passwords and Drive sign-ins. **Never change it later** — stored camera URLs become unreadable. Back it up. |
| `RECORDER_ENROLL_KEY` | random, 32+ chars | Every venue's box enrols with it (§7). |
| `SENDGRID_API_KEY` / `MAIL_FROM` | your key / `DGSports <no-reply@dgsports.ph>` | Verify the sender (or the domain) in SendGrid first. |
| `XENDIT_SECRET_KEY` / `XENDIT_CALLBACK_TOKEN` | live key / webhook verification token | See §6. |
| `PAYMENT_SANDBOX` | `false` | |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | from Google Cloud | Required: every court's videos go to its Google Drive. |
| `GOOGLE_REDIRECT_URI` | `https://api.dgsports.ph/api/v1/oauth/google/callback` | Also add it in Google Cloud as an authorised redirect URI. |
| `ALERT_DISCORD_WEBHOOK_URL` | optional | Box offline / disk full / uploads piling up / box needs updating. |
| `certPath` | **empty** | nginx handles HTTPS for the API. |
| `RATE_LIMIT_STORE` | `memory` | Fine for one API process (the pm2 file runs one). |
| `TIMEZONE` | `Asia/Manila` | |

---

## 5. First start

```bash
cd /srv/dgsports/back
npm ci --omit=dev
npm run keys              # JWT signing keys into ./auth-keys (back them up)
npm run db:setup          # applies every migration, seeds permissions + the Owner (prints the password)
npm run pm2:prod          # starts the API under pm2 with NODE_ENV=production
sudo pm2 save && sudo pm2 startup   # start on boot (run the command it prints)
```

`npm run db:setup` is re-runnable; on later updates use `npm run db:migrate` (§11).

**Never run `npm run db:data` on the server** — it empties the database to load demo data (it
refuses `NODE_ENV=production`, but don't rely on that).

### Website build

```bash
cd /srv/dgsports/front
cat > .env.production <<'EOF'
VITE_API_URL=https://api.dgsports.ph
VITE_SOCKET_URL=https://api.dgsports.ph
VITE_APP_NAME=DGSports
VITE_STORE_KEY=dgsports
VITE_APP_ENV=production
VITE_SENTRY_DSN=
EOF
npm ci && npm run build   # → front/dist
```

`VITE_*` values are baked into the build — rebuild after changing them.

### nginx

`/etc/nginx/sites-available/dgsports` (then `ln -s` it into `sites-enabled`, `nginx -t`,
`systemctl reload nginx`, and `sudo certbot --nginx -d dgsports.ph -d api.dgsports.ph`):

```nginx
# The website: a single-page app — every unknown path serves index.html
server {
    server_name dgsports.ph;
    root /srv/dgsports/front/dist;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
    listen 80;
}

# The API
server {
    server_name api.dgsports.ph;

    # No videos come here (CR-040): the largest upload is a logo or a camera preview (3 MB)
    client_max_body_size 20m;
    # Recorder boxes long-poll for 30 s
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;

    location / {
        proxy_pass http://127.0.0.1:4021;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
    listen 80;
}
```

Open only 80 and 443 to the internet (`sudo ufw allow 'Nginx Full' && sudo ufw allow OpenSSH &&
sudo ufw enable`). MySQL and port 4021 stay private.

**Check:** `https://dgsports.ph` shows the landing page; `https://dgsports.ph/admin` signs in with
the Owner's email and the printed password (you're asked to choose a new one).

---

## 6. Accounts that call back

- **Xendit** → Settings → Webhooks: set **Invoices paid** and the refund webhooks to
  `https://api.dgsports.ph/api/v1/webhooks/xendit`; copy the **Verification token** into
  `XENDIT_CALLBACK_TOKEN`. API keys → a secret key with Money-in (Write) and Refunds (Write) into
  `XENDIT_SECRET_KEY`. Test once with the test-mode keys before switching to live ones.
- **Google Cloud** (required — players get their games from Drive): enable the Drive API; OAuth consent screen External with
  `openid`, `email`, `.../auth/drive.file`, and **publish it** (in "Testing", sign-ins drop after
  7 days); an OAuth client "Web application" with the redirect URI from §4.
- **SendGrid**: verify `MAIL_FROM` (Single Sender) or authenticate `dgsports.ph`.

Restart the API after changing `.env`: `cd back && npm run pm2:reload`.

---

## 7. Each venue — the recorder box

On site, with the box **wired** to the venue router and on the same network as the cameras.
Box setup step by step: [Windows PC](recorder-box-installation-windows.md) or [Mac](recorder-box-installation.md).

1. **In the Admin** (cloud): Venues → add the venue → add its courts with each camera's RTSP URL.
   Copy the venue's ID (Venues → the venue → **Venue ID**, with its copy button).
2. **On the box** (Ubuntu 24.04 / Debian 12) — full detail in `edge/README.md` → Install:

   ```bash
   sudo apt install -y ffmpeg chrony git      # chrony: the clock must be right
   # Node 20.12+ (NodeSource or nvm), then:
   sudo npm install -g pm2
   git clone <your repo URL> ~/dgsports && cd ~/dgsports/edge
   npm ci --omit=dev
   cp .env.example .env
   ```

3. **`edge/.env`:**

   | Setting | Value |
   | --- | --- |
   | `API_URL` | `https://api.dgsports.ph` (no trailing slash, no `/api`) |
   | `ENROLL_KEY` | exactly the API's `RECORDER_ENROLL_KEY` |
   | `VENUE_ID` | the venue's ID from step 1 |
   | `BOX_NAME` | e.g. `bigpickle-box-1` |
   | `LIVE_HOST` / `CERT_PATH` | see §8 (live view over HTTPS) |

4. **Start it:** `npm run pm2:start && pm2 save && pm2 startup`. On first start the box enrols
   itself and keeps its own token in `data/device.json`; `ENROLL_KEY` / `VENUE_ID` aren't needed
   after that.
5. **Check:** on the server, `cd back && npm run boxes` lists the box with its venue and last
   heartbeat; in the Admin, the venue's courts show their cameras recording (Dashboard / venue
   health). A box can be revoked with `npm run boxes:revoke -- <name or id>`.
6. **Connect each court's Google Drive:** Admin → Setup → the court → Google Drive → Connect, and
   sign in with that court's Google account. Until then the box keeps the court's games and players
   get no video; connecting sends them.
7. **Firewall on the box:** `sudo ufw allow 8090/tcp` (live view, venue Wi-Fi only). Nothing else
   needs to be open.

---

## 8. Live view on the venue Wi-Fi (HTTPS)

The live picture on the game page and the session device comes **straight from the box** to phones
on the venue Wi-Fi — it never goes through the cloud. Once the website is `https://`, browsers
refuse a plain-`http://` video from the box (mixed content), so the box needs a certificate too
(CR-002; `edge/README.md` → HTTPS).

1. Pick a name per box under your domain, e.g. `bigpickle-1.live.dgsports.ph`.
2. **DNS:** a public A record from that name to the box's **LAN IP** (e.g. `192.168.1.50`). Give
   the box a fixed LAN IP (a DHCP reservation on the venue router).
3. **Certificate:** the box isn't reachable from the internet, so use Let's Encrypt's **DNS
   challenge** — easiest as one wildcard `*.live.dgsports.ph` issued on the server
   (`certbot certonly --manual --preferred-challenges dns -d '*.live.dgsports.ph'`, or your DNS
   provider's certbot plugin for automatic renewal) and copied to each box.
4. **On the box:** put `privkey.pem`, `cert.pem`, `chain.pem` in a folder the pm2 user can read; set
   `CERT_PATH` to it and `LIVE_HOST=bigpickle-1.live.dgsports.ph`; `pm2 reload all`. Renewed files
   are picked up within 6 hours without a restart.
5. **Venue Wi-Fi:** phones must be on a network that can reach the box — a guest network with
   client isolation blocks it.

People away from the venue watch through the court's Facebook / YouTube restream instead.

---

## 9. The session device app

The phone/tablet app pairs with a game through the API. Set `EXPO_PUBLIC_API_URL=https://api.dgsports.ph`
in `app/.env` and **make a new build** (EAS) — the value is baked into the app. Installed copies
keep the old address until they update.

---

## 10. Sizing — upload speed, box disk and Google Drive

A whole game is about **250 MB per camera per 30 minutes** (a 31-minute test game was 261 MB),
i.e. about **1.1 Mbit/s per recording camera**, and ≈ 0.5 GB per camera-hour.

| | Rule of thumb | Example: 4 courts, 1 camera each, 10 h of games a day |
| --- | --- | --- |
| **Venue upload speed** (sustained, to Google) | ≥ 1.1 Mbit/s × cameras recording at once, plus headroom | ≥ 5 Mbit/s up, ideally 10+ |
| **Box disk** (it keeps every game for the keep time) | ≈ 0.5 GB per camera-hour × hours a day × 7 days, plus the rolling buffer | 4 × 10 × 0.5 × 7 ≈ **140 GB** — a 1 TB SSD leaves room |
| **Google Drive per court** | ≈ 0.5 GB per camera-hour × hours a day × 7 days (Drive keeps it as long as the box) | 10 × 0.5 × 7 ≈ **35 GB** per court — more than a free account's 15 GB |
| **Cloud server disk** | No videos | 40 GB |

Two cameras on a court double the box and Drive figures. A box that can't keep up queues its
uploads (they survive restarts) and the "uploads piling up" alert fires after
`ALERT_BACKLOG_MINUTES`. Under `DISK_CRITICAL_MB` the box removes the oldest videos already on Drive
first, so recording never stops. Admin → Dashboard shows each box's kept videos and free disk.

---

## 11. When the venue's internet drops

| Situation | What happens |
| --- | --- |
| Internet drops **during** a game | Recording carries on. The box keeps that game's footage (it's on the box's cached game list), makes the video, and sends it to Drive when the line is back — a half-sent video resumes where Google stopped. |
| Internet drops **while a video is going to Drive** | The box keeps it and resumes later (Google keeps the half-sent file about a week). The game page shows "sending to Google Drive N%". |
| Internet is down **when a player checks in** | Check-in happens in the cloud, so the phone can't check in. If it does check in but the box can't hear about it, the box has only its 3-minute rolling buffer — the start of that game can be lost. |
| Internet is down for staff | The Admin and bookings are in the cloud; staff need any internet (e.g. mobile data). |
| Power cut at the venue | No recording during the cut (a UPS helps); the box's queue survives the reboot. |

A backup mobile-data connection on the venue router is worth it.

---

## 12. Deploying an update

```bash
cd /srv/dgsports && git pull
cd back && npm ci --omit=dev && npm run db:migrate && npm run pm2:reload
cd ../front && npm ci && npm run build        # nginx serves the new dist at once
```

Read the release's changelog (`docs/changelog/published/`) for new `.env` settings first.
Recorder boxes update separately: `cd ~/dgsports && git pull && cd edge && npm ci --omit=dev &&
pm2 reload all`.

**Moving to videos on the box and Drive (CR-040).** This update changes how videos travel, so do it
in this order:

1. Update the API to the release with the box-to-Drive upload but **before** the switch-over
   (CR-040 Phase 1–3) — old boxes keep uploading to the server meanwhile.
2. Update **every** recorder box (`npm run boxes` shows each box's agent version). An updated box
   reports `drive-direct`; after step 5 the Dashboard flags any box that doesn't.
3. Connect each court's Google Drive (§7 step 6).
4. Wait **7 days** (the keep time), so the videos still on the server age out.
5. Then deploy the switch-over (CR-040 Phase 4): the API stops taking uploads and stops serving
   video files. A box that wasn't updated gets no games to send (its games wait for it) and raises
   "Recorder box needs updating" on the Dashboard and in alerts.

---

## 13. Backups

- **Database:** a nightly `mysqldump --single-transaction dgsports | gzip` kept off the server.
- **Secrets:** `back/.env` (above all `DEVICE_SECRET_KEY`) and `back/auth-keys/` — losing them
  means re-entering every camera and signing everyone out.
- **Videos** aren't on the server: each box keeps its venue's games for the keep time and each
  court's Google Drive has the player copies. `back/public/uploads` holds only logos and camera
  previews.

---

## 14. Go-live checklist — first venue, end to end

- [ ] `https://dgsports.ph` and `https://dgsports.ph/admin` load with a valid certificate
- [ ] Owner signed in and chose a new password; staff accounts created
- [ ] A test email arrives (Admin → forgot password, or a booking confirmation)
- [ ] Venue, courts and cameras added; the box enrolled (`npm run boxes`) and its cameras show recording
- [ ] Booking settings: opening hours and rates; online booking link turned on
- [ ] A test booking paid online (Xendit test mode first): the booking turns Paid; Payments shows it
- [ ] At the court, scan the QR and enter the code: the game starts and the game page shows it recording
- [ ] Live view plays on a phone on the venue Wi-Fi (`https://<box>.live.dgsports.ph:8090`)
- [ ] Each court's Google Drive connected (Admin → Setup → the court → Google Drive)
- [ ] End the game: the game page shows "sending to Google Drive", then **Open in Google Drive**; the link plays on a phone with no Google sign-in
- [ ] TV court board link opened on the venue TV (Bookings → TV board)
- [ ] Pull the venue's internet cable for a minute mid-game (and once while a video is going to Drive), plug it back: the video still arrives on Drive
- [ ] Venue alerts reach Discord / email when the box is switched off for longer than `ALERT_GRACE_MINUTES`
