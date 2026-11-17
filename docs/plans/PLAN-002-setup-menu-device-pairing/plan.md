# PLAN-002 · Setup menu, camera setup, and 6-digit device pairing

> **Status:** In progress · **Created:** 2026-11-17 · **Owner:** — · **Checklist:** [checklist.md](checklist.md)
> **Related:** [PLAN-001](../PLAN-001-court-replay-cameras/plan.md) (builds on its venues, courts,
> recorder boxes, clips and staff app)

## Goal

**Set up a venue in one place in the web Admin portal.** A venue has its courts, each court has
a guided camera setup, and the venue has its recorder boxes. Day-to-day work (Clips, Sessions,
Payments) sits in its own group.

**Pair a phone once with a 6-digit code.** After that the staff app opens straight to that
venue's courts, with no login. Staff pick a court and tap **Record**, and the player photographs
the QR on the phone. The same 6-digit pairing replaces copying a `DEVICE_TOKEN` into a recorder
box's `.env`.

## Context

What PLAN-001 left, and what the requester wants instead:

| Today | Wanted |
| --- | --- |
| One "Dyna Cam" sidebar group with six flat pages (Venues, Courts, Recorder boxes, Clips, Sessions, Payments), in [`AdminRoute.jsx`](../../../front/src/routes/pageRoutes/AdminRoute.jsx) | **Setup** group: Venues → a venue's Courts → each court's "Set up camera"; Recorder Boxes. **Dyna Cam** group: Clips, Sessions, Payments, and pairing keys |
| The camera address is typed into the court drawer (Tapo helper). Nobody can see whether it works except in the box's heartbeat text | A guided **Set up camera** for each court, showing a live **preview picture** and the stream details the box actually receives |
| Every app user signs in with a staff account ([`Screens/Login`](../../../app/src/Screens/Login/Index.js)) and gets the full Menu | A phone is **paired once** to a venue with a 6-digit key from the web. It opens to that venue's **courts → Record → QR**, with no login, until revoked |
| A recorder box needs a long `DEVICE_TOKEN` copied from the web into `edge/.env` (the requester asked "we don't need `DEVICE_TOKEN`?") | The box gets a **6-digit pairing key** instead. It exchanges the key for its token on first start and keeps the token itself |

**Why there is still a token:** the device API hands a box each camera's RTSP login and each
court's stream key, and accepts clip uploads. Something must prove that a request comes from
that venue's box. Pairing doesn't remove the token; it makes the token automatic. A person
types a short, single-use, 10-minute code once, and the device stores the long token itself.

## Approach

### 1. Web: menu restructure

```
Dashboard
User Management ▸ Users, Roles
Setup
 ├─ Venues                 /admin/setup/venues                    (venues/list)
 │   └─ <Venue>            /admin/setup/venues/:venueId            venue info + its Courts list
 │       └─ <Court>        /admin/setup/venues/:venueId/courts/:courtId
 │                          Set up camera · QR sign · Button · Live stream
 └─ Recorder Boxes         /admin/setup/recorder-boxes            (venues/devices)
Dyna Cam
 ├─ Clips                  /admin/dyna-cam/clips                  (clips)
 ├─ Sessions               /admin/dyna-cam/sessions               (clips)
 ├─ Payments               /admin/dyna-cam/payments               (payments)
 └─ Paired Apps            /admin/dyna-cam/paired-apps            (paired_apps — new)
Settings · Audit Trail
```

- **No standalone Courts page.** Courts are managed inside their venue. This matches "Venues >
  Courts > Court 1 Setup camera". The old routes (`/admin/dyna-cam/venues`, `/courts`,
  `/devices`) redirect to the new ones, so printed links and bookmarks keep working.
- **Permissions are unchanged** for the existing pages. The venue page's Courts section shows
  with `venues/courts` read access. A user with Courts access but no Venues access gets a venue
  picker into the same court pages, rather than losing access.
- **Court page:** four sections, each saved on its own:
  - **Camera:** the guided setup below.
  - **QR sign:** print and rotate (moved from the Courts list).
  - **Button:** the button code.
  - **Live stream:** the PLAN-001 Phase 5 settings.

### 2. Web: guided "Set up camera"

1. **Camera type:** Tapo (default) or Other RTSP.
2. **Address:** the Tapo helper (IP, Camera Account, quality) or a raw URL. It includes the
   "make a Camera Account in the Tapo app" and DHCP-reservation tips from PLAN-001.
3. **Save → live check.** The recorder box picks up the new address on its next config refresh
   (≤ 60 s). The page polls the court until the box reports back, then shows:
   - status (Recording / Can't reach / Wrong password / Wrong stream path, with a fix hint)
   - **resolution, frame rate, video and audio codec**
   - a **preview picture** from the camera, refreshed every ~30 s while the page is open, so
     staff can aim the pan/tilt
4. Done, with what to do next: print the QR sign, and optionally set a button.

**The box can't open a second connection to test the camera:** a Tapo C200 serves one RTSP
client (PLAN-001). So the box reports what its own recorder sees:
- **Heartbeat:** each camera entry gains `video {codec, width, height, fps}` and
  `audio {codec, sampleRate}`, read from its latest segment with ffprobe.
- **Snapshot:** while a court's setup page is open (the API marks `previewWantedUntil`), the box
  uploads a JPEG from its latest segment every 30 s with `POST /device/courts/:courtId/snapshot`.
  It's stored, overwriting the last one, at
  `uploads/admin/snapshots/{venueId}/{courtId}.jpg` and returned signed with its time.

### 3. Pairing: one mechanism for staff phones and recorder boxes

**Data** (migration `007`):

| Table | Columns |
| --- | --- |
| `pairing_codes` | `pairingCodeId`, `kind` ENUM('APP','RECORDER'), `venueId`, `name` (the device name to create), `codeHash` CHAR(64), `expiresAt`, `usedAt`, `createdByAccountId`, `resultId` (the app or box it paired), `status` ENUM('Active','Used','Expired','Cancelled'), timestamps |
| `paired_apps` | `pairedAppId`, `venueId`, `name`, `tokenHash` CHAR(64) UNIQUE, `platform`, `appVersion`, `lastSeenAt`, `pairedByAccountId`, `status` ENUM('Active','Revoked','Deleted'), timestamps |

Plus a permission `paired_apps` (no submodule) for creating keys and revoking phones, granted to
the Owner and in the seed list. Recorder-box keys use the existing `venues/devices`.

**The key:**
- 6 random digits from the CSPRNG.
- Valid for **10 minutes** and **single use**. Only its SHA-256 is stored.
- At most one Active key per value; regenerate on a collision.
- Shown once on the web, with a countdown, and never cached (`noIdempotencyCache`).

**Brute-force guard:** the key space is 1,000,000. The pairing endpoints allow **5 attempts per
minute and 20 per hour per IP**, plus a **global cap of failed attempts** (e.g. 100 per 10 min)
that pauses all pairing briefly. Keys live 10 minutes and are few at a time, so a guess has
roughly a 1-in-a-million chance and an attacker gets very few guesses.

**Endpoints:**
- `POST /api/v1/admin/pairing-codes/apps` (permission `paired_apps`) and
  `/admin/pairing-codes/recorders` (`venues/devices`) with `{venueId, name}` return
  `{code, expiresAt}`. `DELETE /:id` cancels a key.
- `POST /api/v1/pair/app` with `{code, platform, appVersion}` (public, rate-limited) creates a
  `paired_apps` row and returns `{token, pairedApp: {name}, venue: {venueId, name}}`. The token
  is shown only in that one response.
- `POST /api/v1/pair/device` with `{code, agentVersion}` (public, rate-limited) creates a
  `devices` row (as "Add box" does today) and returns `{token, device, venue}`.
- Admin `/api/v1/admin/paired-apps` (permission `paired_apps`): list (with online / last seen),
  rename, revoke, delete.

**Paired-app API** `/api/v1/app/*`, using `Authorization: App <token>` (middleware
`requirePairedApp`, everything scoped to the app's venue; another venue's records give 404):
- `GET /me`: the venue and the phone's name.
- `GET /courts`: the venue's active courts, with camera and box status.
- `POST /courts/:courtId/clips`: **Record**. Saves the last 60 s through the shared
  `utils/clipRequests.js` as source `STAFF`, with `pairedAppId` recorded. Returns
  `{clipId, shareUrl}` (201, or 200 when merged) or 503 `CAMERA_OFFLINE`.
- `GET /clips/:clipId`: the status, for the "saving… ready" state on the QR screen.
- `GET /courts/:courtId/clips?limit=10`: that court's recent clips (time, status, source, payment),
  so staff can **show a QR again** if the player missed it.
- `GET /payments/lookup?payCode=` and `POST /payments {payCode}`: **take cash** for a clip of
  **this venue** only. Migration `007` adds `payments.pairedAppId` NULL, so a payment is credited
  to the phone ("Received by: Front desk phone"). Refunds stay web-only.
- Migration `007` also adds `clips.pairedAppId` NULL (which phone saved it), shown on Clips as
  "Staff · <phone name>".

**Recorder box (`edge/`):**
- `edge/.env` takes `PAIRING_CODE=123456` instead of `DEVICE_TOKEN`.
- On start, with no stored token, the box calls `/device/pair` and saves the token to
  `DATA_DIR/device.json` (mode 0600). After that `PAIRING_CODE` is ignored, and the README says
  to delete it.
- `DEVICE_TOKEN` keeps working for boxes already installed.
- If the box gets a 401 (revoked), it logs "This box was revoked — add a new pairing key", stops
  recording, and waits for a new `PAIRING_CODE`.
- Recorder Boxes "Add box" shows a 6-digit key with the two lines to type (`API_URL`,
  `PAIRING_CODE`) instead of a 64-character token.

### 4. Staff app: paired mode

> **Superseded by [section 5](#5-session-devices-phase-e) (Phase E, 2026-11-17).** Phones are no
> longer paired to a venue; a device is paired to **one session** and unpaired when it ends. The
> courts list, Record, Take payment and the staff sign-in leave the app. Kept below as the record
> of what Phases B–D built.

```
first launch / unpaired ──▶  "Pair this phone"  (6-digit key)  ──▶  Courts (venue)
                                                                       │ tap Court 1
                                                                       ▼
                                                              Court 1   [ RECORD ]
                                                                       │ tap
                                                                       ▼
                                                   Big QR of the clip link + short link text
                                                   "Saving… ✓ Ready"   [ Done ]
```

- **Root navigator:** a paired token means **paired mode**, a signed-in staff account means
  today's full app, and neither means the **Pair this phone** screen. That screen has a small
  "Sign in with a staff account instead" link for managers (see Open questions).
- **Paired mode is three screens, plus two extras:**
  - **Courts:** big cards with camera status.
  - **Court:** one large **Record** button, showing "Camera offline — tell the manager" when it
    can't record.
  - **Share QR:** a full-screen QR of the clip's share link, high contrast and big enough to
    photograph from about 1 m, with the short link written underneath. It switches from
    "Saving…" to "Ready" by polling `GET /clips/:id`.

  The player photographs the QR and opens it later; iOS Photos and Google Lens read QR codes in
  photos. They can also scan it live with their camera.
  - **Recent clips** on each court: tap one to show its QR again.
  - **Take payment**: enter the pay code and record the cash (this venue only).
- **Staying paired:**
  - The token is kept until the server says it's revoked: a 401 with `TOKEN_INVALID` on
    `/app/*`. Only then does the app clear it and show "This phone was unpaired — enter a new
    key".
  - Network errors and 5xx (disconnected Wi-Fi, server down) **never** unpair. The app shows
    "Can't reach Dyna Cam — retrying" and keeps the token.
- **Storage:** the token is kept in **`expo-secure-store`**, a native module, so this **needs a
  new dev or store build**. AsyncStorage is unencrypted, and a staff phone is a shared device.
- **Admin side:** Dyna Cam → Paired Apps lists the paired phones (venue, name, last seen,
  platform), with **Pair a phone** (choose venue and name, then show the 6-digit key and
  countdown), Rename, Revoke, and Delete.

### 5. Session devices (Phase E)

The requester's new process (2026-11-17): *"Staff will create a session, then pair the device.
The device has a view of that session, like a live stream, and it still has the QR code so once
they finish the game / stop recording they can download. Payment on the counter only, not on the
app. The court list must be removed — we are now session based. Once the session ends, the device
is unpaired. Clips must be view only."*

```
WEB (staff at the counter)                         DEVICE (phone / tablet at the court)
──────────────────────────                         ────────────────────────────────────
Sessions → Book session                            "Pair this device"  [ _ _ _ _ _ _ ]
  Court 1 · Start now · 1 h                                   │ key
  ▶ shows "Pair a device" key  482 913  (10 min) ──────────▶  ▼
                                                   Court 1 · DGSI            ● REC 12:34
                                                   ┌──────────────────┐  ┌─────────┐
                                                   │  live video from │  │   QR    │ Scan to get
                                                   │  the recorder box│  │         │ your game
                                                   └──────────────────┘  └─────────┘
                                                   Ends by itself at 4:09 PM  [ Stop recording ]
                                                              │ Stop / end time / web End
                                                              ▼
                                                   Big QR · "Saving your game… 2 of 5 parts"
                                                        → "Ready — scan to download"
                                                   [ Done ]   This device unpairs in 9:41
                                                              │ Done or 10 min
                                                              ▼
                                                   "Pair this device"
```

**Decisions (answered 2026-11-17):**

| Question | Answer |
| --- | --- |
| Live view source | **From the recorder box over the venue Wi-Fi** (about 5 s behind; no internet upload, no second camera connection) |
| Who stops recording | **The device's Stop recording button**, or the session's end time; staff can still End it on the web |
| After the session ends | The device **keeps the download QR for 10 minutes** (or until Done), then unpairs itself |
| Staff sign-in in the app | **Removed** — the app is only a session device; staff work happens on the web |
| Payments | **At the counter only** (web Payments page). Nothing about payment in the app |

#### 5.1 Web

- **Sessions → Book session:** a new **Start now** choice (the default), next to picking a date
  and time. After booking, the **Pair a device** dialog opens straight away with a 6-digit key,
  a device name (default "Court 1 device") and the 10-minute countdown.
- **Each session** (row ⋮ menu and the detail sheet) gets **Pair a device** while it is
  Scheduled or Recording. The detail sheet lists the devices paired to it (name, platform, last
  seen) with **Unpair**, and the live keys with **Cancel**. More than one device per session is
  allowed (e.g. a tablet at the court and one at the counter).
- **Dyna Cam → Paired Apps is removed** (page, route, menu entry, venue-wide "Pair a phone"). The
  `paired_apps` permission is retired; pairing a device to a session needs **clips · write**,
  the same permission as booking it.
- **Clips becomes view only:** no **Save clip now** button and no **Delete**. Preview, Copy share
  link and Open share page stay.
- **Payments:** unchanged — cash is taken at the counter on the web.

#### 5.2 Database (migration `010_session_devices.sql`)

- `pairing_codes.sessionId` and `paired_apps.sessionId` (nullable FKs to
  `recording_sessions.sessionId`). An APP key and a paired device now always belong to a session.
- `devices.liveUrl` (the box's LAN address, e.g. `http://192.168.254.50:8090`) and
  `devices.liveKey` (the box's live-view signing key, **encrypted** like camera URLs).
- Existing venue-wide paired phones are revoked and their unused APP keys cancelled (they have
  no session). The `paired_apps` permission row is set `Deleted` so it leaves the role editor.

#### 5.3 API

**Admin** (`clips` permission, read for GET, write for the rest):

- `POST /admin/sessions` accepts `startNow: true` (start = now; `startAt` not needed).
- `POST /admin/sessions/:sessionId/pairing-codes` `{ name }` → `{ code, expiresAt }` — only
  while the session is Scheduled or Recording; the key expires after 10 min or at the session's
  end, whichever is first. `DELETE …/pairing-codes/:pairingCodeId` cancels it.
- `GET /admin/sessions/:sessionId` adds `devices[]` and `pairingCodes[]` (live keys, no digits).
- `POST /admin/sessions/:sessionId/devices/:pairedAppId/unpair`.
- Removed: `/admin/pairing-codes/apps`, `/admin/paired-apps/*`, and the Clips write routes
  (`POST /admin/clips` staff save, `DELETE /admin/clips/:clipId`).

**Pairing:** `POST /pair/app` redeems a session key → `{ token, device: { pairedAppId, name },
session }`. A key for a session that has already ended is refused like a wrong key.

**Device app** (`/api/v1/app/*`, `Authorization: App <token>`) — replaces the Phase B–D routes:

- `GET /app/session` → `{ session: { sessionId, courtName, venueName, startAt, endAt, status,
  startsInSeconds, elapsedSeconds, endsInSeconds, partsReady, partsTotal, shareUrl,
  failureReason }, live: { hlsUrl, expiresAt } | null, unpairInSeconds | null }`.
  - `live` is null when the session isn't recording, the box is offline, or the box hasn't
    reported a LAN address.
  - `unpairInSeconds` counts down the 10 minutes after the session ends.
- `POST /app/session/stop` → ends the session now (same code as the web's End) and returns it.
- `POST /app/unpair` (exists) — the Done button.
- **Unpairing by itself:** the token works while the session is Scheduled or Recording and for
  10 minutes after it ends. After that — or at once when staff cancel the session or unpair the
  device — it answers 401 `TOKEN_INVALID` and the device goes back to "Pair this device".
- Removed: `/app/me`, `/app/courts…`, `/app/clips/:id`, `/app/payments…`, `/app/sessions…`
  (Phase B–D).

#### 5.4 Recorder box: live view over the venue Wi-Fi

The box already writes each court as 2-second `.ts` segments (H.264 + AAC) for its rolling
buffer. A small HTTP server on the box (`LIVE_PORT`, default **8090**) turns the newest ones into
an HLS live playlist — no new camera connection, no re-encoding:

- `GET /live/:courtId/index.m3u8?exp=…&sig=…` → the last 5 closed segments (about 10 s);
  `GET /live/:courtId/:segment.ts?exp=…&sig=…` → a segment from that court's folder only.
- **Signed links:** the box makes a random `liveKey` once (saved in `DATA_DIR`, mode 0600) and
  sends it with its LAN address in the heartbeat. The API signs `courtId.exp` with it
  (HMAC-SHA256) when it hands a device its `hlsUrl`; the box checks the signature and expiry, so
  only a device paired to a session on that court can watch, and only for a while.
- The LAN address is detected from the box's network interfaces; `LIVE_HOST` overrides it.
  `LIVE_PORT=0` turns the live view off.

#### 5.5 The app (session device only)

- **Screens:** **Pair this device** → **Session** (live + QR + timer + Stop) → **Ended** (QR +
  saving progress + Done + unpair countdown) → back to Pair. Before a later session starts, the
  Session screen shows "Starts at 3:00 PM" with the QR already visible.
- **Live video:** `expo-video` playing the `hlsUrl`; when it can't load: "Live view needs the
  venue Wi-Fi" — recording is unaffected. It re-reads `/app/session` for a fresh link before
  the old one expires.
- **QR:** the session's share link is on screen the whole time ("Scan to get your game — it's
  ready to download when the game ends"), and full-screen after the end.
- **Removed:** the staff sign-in and the whole staff-account app (Home, Clips, Courts, Recorder
  Boxes, Sessions, Take payment, Account), and the paired Courts / Court / Take payment / Recent
  screens.
- **Native/OS changes (new dev build):** `expo-video`; Android allows plain-HTTP to the box
  (`usesCleartextTraffic`); iOS gets `NSAllowsLocalNetworking` and a **Local Network**
  permission prompt ("Dyna Cam shows the court's live video from the venue's recorder box").
  Landscape is allowed for tablets.

#### 5.6 Unchanged

- Players' **court QR sign and button** still save the last 60 seconds as clips, priced as today;
  they show on the (now view-only) Clips page and are paid for at the counter.
- Recorder box pairing (Setup → Recorder Boxes → Add box) and `DEVICE_TOKEN` stay as built.
- Sessions stay free; the session's player link and its 5-minute parts work as before.

### 6. Player's own live stream (Phase G)

The requester (2026-11-17): *"Can we make it on the app, individual can set up their own live
stream? They will manually add the stream address."* A player streams **their session** to
**their own** Facebook or YouTube, alongside the venue's court stream if that is on.

```
SESSION DEVICE (venue tablet)              PLAYER'S PHONE                         RECORDER BOX
─────────────────────────────              ──────────────                         ────────────
[ Stream to your Facebook / YouTube ]
  → sheet with a QR (15 min, this session) ─▶ scans → dynacam…/stream/<code>
                                              Court 1 · DGSI · 4:00–5:00 PM
                                              Platform: (Facebook ▾)  Stream key: [paste]
                                              [ Start streaming ] ──────────────────▶ /device/config:
                                                                                      session stream on
● Streaming to Facebook · live  [Stop]  ◀── status ── "Live on Facebook ✓" ◀──────── heartbeat: live
```

**Decisions (answered 2026-11-17):**

| Question | Answer |
| --- | --- |
| Where is the key entered | On the **player's own phone**: the session device shows a short-lived QR that opens a page where they paste it from their Facebook/YouTube app |
| The venue's court stream during the session | **Both run** — the venue's stream keeps going and the player's runs alongside (about 2 Mbit/s of upload each) |

#### 6.1 How the box streams without a gap

Turning on a court's stream restarts its recorder, which the box refuses while a session part
is being recorded. A player's stream is therefore **its own small ffmpeg process** on the box:
it reads the court's live view from the box itself (the signed LAN HLS of
[5.4](#54-recorder-box-live-view-over-the-venue-wi-fi), on `127.0.0.1`) and copies it to the
player's RTMP/RTMPS address (`-c copy -f flv`, no re-encode). No recorder restart, no second
camera connection, no gap in the recording. It runs about 10 s behind the court, starts and
stops on its own with the session, and a failure there never touches the recording. With
`LIVE_PORT=0` (live view off) a player's stream reports "not available on this box".

#### 6.2 Database (migration `011_session_streams.sql`)

On `recording_sessions`:

- `streamUrl` — the player's full RTMP(S) address including the key, **encrypted** like camera
  URLs; never returned (only a masked form: `rtmps://live-api-s.facebook.com/…/•••k2N`). Cleared
  as soon as the session ends.
- `streamPlatform` (`FACEBOOK` / `YOUTUBE` / `OTHER`), `streamUpdatedAt`.
- `streamSetupTokenHash` + `streamSetupExpiresAt` — the QR's code (only its SHA-256 is stored),
  15 minutes, this session only.

The stream's status (starting / live / error + message) comes from the box's heartbeat, like the
court streams.

#### 6.3 API

- **Device:** `POST /app/session/stream-link` → `{ url, expiresAt }` (a fresh setup code; the
  old one stops working). `POST /app/session/stream/stop`. `GET /app/session` adds
  `stream: { platform, status, message, maskedUrl } | null`.
- **Player's page** (public, rate-limited, the code is the credential):
  `GET /public/stream-setup/:code` → court, venue, session times, current stream (masked);
  `PUT /public/stream-setup/:code` `{ platform, streamKey }` or `{ url }` → saves it (only
  while the session is to come or recording); `DELETE` → stops it.
  - Facebook: `rtmps://live-api-s.facebook.com:443/rtmp/` + key; YouTube:
    `rtmp://a.rtmp.youtube.com/live2/` + key; **Other**: a full `rtmp://` / `rtmps://` address.
- **Box:** `/device/config` sessions carry `stream: { url }` while recording;
  the heartbeat reports `sessionStreams: [{ sessionId, status, message }]`.
- **Admin:** the session detail shows the stream's platform, status and masked address (no
  key), with **Stop stream**.

#### 6.4 Screens

- **Session device:** a **Stream to your Facebook / YouTube** button opens a sheet with the
  setup QR + short link and "Scan with your phone and paste your stream key". While streaming,
  a chip "● Streaming to Facebook · live" with **Stop streaming** (confirm).
- **Player's phone** (`front/`, public route `/stream/:code`, works on a phone): court and time,
  platform picker, the key field (paste), short help on where to find the key in each app,
  **Start streaming**, then the live status ("Live on Facebook ✓" / the error) and **Stop**.
- **Web Admin:** the session detail's stream line.

### 7. Two cameras on one court (Phase H)

The requester (2026-11-17): *"Possible 2 cameras on 1 court? On the live stream, Cam 1 above
Cam 2 like that — also have the option Cam 1 or Cam 2 only."*

```
 Cam 1 only        Cam 2 only        Both (stacked)
┌──────────┐      ┌──────────┐      ┌──────────┐
│  Cam 1   │      │  Cam 2   │      │  Cam 1   │  1280×720
└──────────┘      └──────────┘      ├──────────┤
 1280×720          1280×720         │  Cam 2   │  1280×720
 (copied)          (copied)         └──────────┘
                                     1280×1440, re-encoded
```

**Decisions (answered 2026-11-17):**

| Question | Answer |
| --- | --- |
| Which live views get the Cam 1 / Cam 2 / Both choice | The **player's own stream** (Phase G) and the **venue's court stream**. The session device's live view stays Cam 1 |
| What clips and whole-game videos contain on a 2-camera court | **Stacked**, Cam 1 over Cam 2, one video per clip/part |
| Who picks the layout of a player's stream | **The player**, on the stream page (default Both); changing it while live restarts their stream for a few seconds |

#### 7.1 What costs what

- **Cam 1 only / Cam 2 only** copy that camera's video as it comes: no extra CPU.
- **Both (stacked)** decodes both cameras and encodes one new H.264 video (hardware encoder when
  the box has one — VideoToolbox on a Mac, VAAPI/QSV on Linux — else `libx264 veryfast`). It
  also gets a keyframe every 2 s, which ends Facebook's "keyframe frequency" warning. A box runs
  at most `MAX_STACKED_STREAMS` (default 2) stacked streams at once; more show "Too many stacked
  streams on this box — choose Cam 1 or Cam 2".
- **Clips and session parts** are re-encoded already (watermark), so stacking adds one decode
  and a taller encode; files are about twice the size.
- The two cameras have their own clocks: the halves can be up to ~1 s apart.
- **Sound** comes from Cam 1 (Cam 2's if Cam 1 has none).

#### 7.2 Database (migration `013_second_camera.sql`)

- `courts.camera2RtspUrl` (encrypted like `cameraRtspUrl`), `courts.snapshot2Path`,
  `courts.snapshot2At` (Cam 2's preview picture).
- `courts.streamLayout ENUM('CAM1','CAM2','STACKED') NOT NULL DEFAULT 'CAM1'` (the venue's
  court stream) and `recording_sessions.streamLayout` (the player's stream, same values, NULL =
  no stream).

#### 7.3 Recorder box

- **Recording:** each camera has its own recorder and rolling buffer (Cam 2 in
  `buffer/<court>~cam2/`), its own camera details, preview and status (`camera: 1 | 2` in the
  heartbeat). Losing Cam 2 never stops Cam 1.
- **Live view (5.4):** `/live/<courtId>/index.m3u8` stays Cam 1; Cam 2 is
  `/live/<courtId>/cam2/index.m3u8`, same signature.
- **Every stream becomes a restream** (like the player's stream, 6.1): an ffmpeg reading the
  box's own live view — one camera copied, or both stacked and encoded — sent to the RTMP(S)
  address. **The venue's court stream moves off the recorder's tee** to this model, so changing
  a court's stream settings no longer restarts the recorder (no gap in the recording); it runs
  ~10 s further behind than before.
- **Clips and session parts** on a 2-camera court: both cameras' segments for the same window
  → each scaled to 1280×720 → stacked → watermark → H.264 1280×1440. If Cam 2 has no footage
  for that window, the clip is Cam 1 only (and the other way round).

#### 7.4 API

- Courts: create/update accept `camera2RtspUrl` (optional; empty removes Cam 2) and
  `streamLayout`; the court response adds `camera2` (masked address, version, live check,
  preview picture), like `camera`. `POST /admin/courts/:courtId/preview` asks for both
  cameras' pictures.
- `/device/config` courts add `camera2RtspUrl` + `camera2Version` and
  `stream: { rtmpUrl, layout }`; sessions' `stream: { url, layout }`.
- Player's stream: `GET /public/stream-setup/:code` adds `setup.cameras` (1 or 2); `PUT` takes
  `layout` (default `STACKED` on a 2-camera court, ignored on a 1-camera court); the `stream`
  object everywhere adds `layout`.
- An old box (before Phase H) ignores `camera2RtspUrl` and `layout`: it records and streams
  Cam 1 only.

#### 7.5 Screens

- **Web → Court setup:** a **Camera 2 (optional)** section with the same guided steps, live
  check and preview; **Remove camera 2**. The **Live stream** section gets **Cam 1 / Cam 2 /
  Both (stacked)** when the court has two cameras.
- **Player's stream page:** the same three choices (when the court has two cameras), under the
  key field; shown again on the status card with **Change**.
- **App:** no change (the device's live view stays Cam 1).

### 8. Recorder boxes set up from `.env` only (Phase I)

The requester (2026-11-17), looking at Setup → Recorder Boxes: *"Possible this only internal?
Just ENV from back and edge? No UI?"* Recorder boxes are installed by us, not by venue staff, so
adding one needs no screen.

**Decisions (answered 2026-11-17):**

| Question | Answer |
| --- | --- |
| How a box knows its venue | `VENUE_ID` in `edge/.env`; the venue page in Setup shows the ID with a **Copy** button |
| The Recorder Boxes page | **Removed completely** (page, menu, Add box, pairing keys for boxes). Box health stays on each court's camera setup |
| Removing / blocking a box | **API command line**: `npm run boxes` lists them, `npm run boxes:revoke -- <name or id>` blocks one |

#### 8.1 How a box enrols

```
back/.env                         edge/.env
RECORDER_ENROLL_KEY=<64 hex>      API_URL=https://api…
                                  ENROLL_KEY=<the same 64 hex>
                                  VENUE_ID=6f1c…            ← Setup → Venues → venue → Copy ID
                                  BOX_NAME=Bry's Table      ← optional, default the hostname

first start, no data/device.json:
  box ── POST /api/v1/pair/enroll { enrollKey, venueId, name, agentVersion } ──▶ API
      ◀── 201 { token, device, venue }   → saved to data/device.json (0600), as with pairing
```

- `RECORDER_ENROLL_KEY` unset (or under 32 characters) → enrolment is off (403).
- The key is compared in constant time; wrong keys count towards the same per-IP limits and
  global pause as pairing keys (3.x). The venue must exist and not be deleted.
- After enrolling, the box never sends the key again; its token works as before.
- **A revoked box doesn't re-enrol by itself:** on 401 it deletes `device.json`, writes
  `data/revoked.json`, stops, and logs *"This box was revoked — delete data/revoked.json to
  enrol it again"*. A person has to act, so `boxes:revoke` sticks.
- **A stolen box** holds the enrol key: revoke it **and** change `RECORDER_ENROLL_KEY` (and the
  other boxes' `ENROLL_KEY`; enrolled boxes keep working, they don't need the key again).

#### 8.2 What is removed / added

- **Removed:** Setup → Recorder Boxes (page, menu entry, services, the box pairing-key dialog),
  `/api/v1/admin/devices/*`, `/api/v1/admin/pairing-codes/recorders*`, `POST /api/v1/pair/device`,
  the box's `PAIRING_CODE`. The `venues/devices` permission is retired (migration `014`, set
  Inactive). Session-device pairing (5.x) is unchanged.
- **Added:** `POST /api/v1/pair/enroll`; `npm run boxes` / `boxes:revoke` in `back/`
  (`scripts/boxes.js`, reads `DB_*` from `back/.env`); the venue ID with **Copy** on the venue
  page; the court setup's "no recorder box online" hint now points to `edge/README.md` instead
  of the removed page.
- **Existing boxes** that already have `data/device.json` keep working with no change.

### Alternatives considered

- **Drop the token entirely** (trust the venue network): anyone who can reach the API could read
  the camera password and stream key, or upload fake clips. Rejected; pairing gives the same
  convenience safely.
- **QR pairing** (the phone scans a QR on the web screen): even faster, but it needs
  `expo-camera` (also a new build), and the requester asked for a 6-digit key. It can be added
  later on the same `pairing_codes` table.
- **Paired phones signing in as a shared "staff" user:** reuses JWTs, but a password ends up on
  every phone, it isn't scoped to one venue, and revoking one phone means changing everyone's
  password. Rejected.
- **Keeping the separate Courts page:** simpler to build, but it doesn't match "Venues > Courts >
  Court 1". Kept only as redirects.

## Affected areas

| Area | Files / tables | Change |
| --- | --- | --- |
| Database | `back/database/migrations/007_add_device_pairing.sql` | `pairing_codes`, `paired_apps`, `clips.pairedAppId`, `courts.previewWantedUntil` / `snapshotPath` / `snapshotAt`, permission `paired_apps` |
| API — admin | `controllers/v1/admin/{pairing-codes,paired-apps}.controller.js`, `courts.controller.js` (snapshot + camera details + preview request) | New routes; court response adds `camera.live` |
| API — pairing | `controllers/v1/public/pairing.controller.js` (or in `app/`, `device/`), `middlewares/rateLimiter.js` profile | `POST /pair/app`, `POST /pair/device` (own `/pair` mount), brute-force limits |
| API — paired app | `middlewares/pairedAppAuth.middleware.js`, `controllers/v1/app/app.controller.js`, `routes/route.js` | `/api/v1/app/*` |
| API — device | `device.controller.js`, `device-api.validator.js` | heartbeat camera details, snapshot upload, `/device/pair` |
| Web | `front/src/routes/pageRoutes/AdminRoute.jsx`, `pages/Admin/Setup/{Venues,VenueDetail,CourtSetup,RecorderBoxes}/`, `pages/Admin/DynaCam/PairedApps/` | Menu restructure, venue → courts drill-down, guided camera setup with live preview, pairing-key dialogs |
| Edge | `edge/src/{config,api,sync,recorder}.js` | `PAIRING_CODE` → stored token, camera details in heartbeat, snapshots on request |
| App | `app/src/Navigation`, `Screens/Pair/`, `Screens/Paired/{Courts,Court,ShareQr}/`, `services/api/app.js`, `store/` | Pairing screen, paired-mode navigator, `expo-secure-store` |
| Docs | root `CLAUDE.md` (route families), backend/mobile/edge skills, `edge/README.md` | New `/api/v1/app/*` family, pairing |
| Phase E — Database | `migrations/010_session_devices.sql` | `pairing_codes.sessionId`, `paired_apps.sessionId`, `devices.liveUrl` / `liveKey`; venue-wide phones revoked; `paired_apps` permission retired |
| Phase E — API | `admin/sessions.controller.js`, `admin/clips.controller.js`, `app/app.controller.js`, `pairing/pairing.controller.js`, `pairedAppAuth.middleware.js`, `device.controller.js`; remove `admin/{pairing-codes (apps),paired-apps}` | Session-bound pairing, `/app/session`, live links, Clips read-only |
| Phase E — Web | `pages/Admin/DynaCam/{Sessions,Clips}/`, remove `PairedApps/`, `AdminRoute.jsx` | Start now, Pair a device, devices list, view-only Clips |
| Phase E — Edge | new `edge/src/live.js`, `config.js`, `sync.js`/heartbeat, README | LAN HLS live view with signed links |
| Phase E — App | `Navigation`, `Screens/{Pair,Session,Ended}`; remove staff screens and `Screens/Paired/*` | Session device only, `expo-video` |

## Out of scope

- Paired phones booking sessions or refunding payments. They stay in the staff-account app and
  the web.
- QR-code pairing, and scanning a court's QR in the app.
- Re-pairing a recorder box remotely. It needs someone at the box to type a new key.
- (Phase E) Live view outside the venue Wi-Fi, recording audio-only/video-only devices, and
  charging for sessions — sessions stay free; paid 60-second clips are taken at the counter.
- (Phase G) More than one personal stream per session; Instagram and TikTok (no plain RTMP for
  ordinary accounts); scoreboards or overlays on the player's stream.
- (Phase H) More than two cameras per court; side-by-side or picture-in-picture layouts;
  switching cameras automatically; a camera choice on the session device's live view;
  separate per-camera clip files.

## Risks

- **6-digit brute force:** short expiry, single use, per-IP and global limits on failed attempts,
  and failed attempts are logged and audited.
- **Lost or stolen paired phone:** it can only record clips and see court status for one venue.
  Revoke it on the web and it stops at its next request.
- **New native module (`expo-secure-store`):** needs a new dev or store build before paired mode
  works. Plan the build with Phase B.
- **Snapshot load:** a 1280×720 JPEG every 30 s, only while someone has the setup page open, and
  expiring on its own (`previewWantedUntil`). Negligible.
- **Existing recorder boxes:** `DEVICE_TOKEN` keeps working, so installed boxes need no change.
- **(Phase E) Live view is LAN-only:** the device must be on the same network as the box. Guest
  Wi-Fi with client isolation blocks it; the screen then says so and recording carries on. Each
  viewer pulls about 1–2 Mbit/s from the box — fine for a few devices.
- **(Phase E) Breaking change for the app:** venue-paired phones are unpaired by the migration,
  and staff can no longer sign in to the app. Release as `major`. Needs a new dev/store build
  (`expo-video`, cleartext/Local Network settings).
- **(Phase E) Every recorder box must be updated** for the live view; an old box keeps
  recording but devices show "Live view unavailable".
- **(Phase G) A player's stream key is a password to their page:** entered only on their own
  phone, stored encrypted, never shown again (masked), deleted when the session ends, and the
  setup QR expires in 15 minutes. The setup page is rate-limited.
- **(Phase G) Upload:** venue stream + player stream ≈ 4 Mbit/s for one court. On a weak line
  the streams stutter; recording is unaffected (separate processes).
- **(Phase G) Facebook's "keyframe frequency" warning:** the C200 doesn't send a keyframe every
  2 s; Facebook warns but plays.
- **(Phase H) CPU:** each stacked stream is a live encode. A Mac or an Intel box with Quick Sync
  handles a few; a low-power box may manage one. Capped by `MAX_STACKED_STREAMS`; recording
  always comes first (streams are separate processes).
- **(Phase H) Storage and upload:** stacked clips are about twice the size; a stacked stream
  uses ~3 Mbit/s of upload.
- **(Phase H) Moving the venue's court stream off the recorder's tee** changes working code from
  PLAN-001 Phase 5: it is re-tested end to end (smoke) before it ships.

## Open questions

- [x] **What does "Record" mean?** Save the **last 60 seconds** (answered 2026-11-17).
- [x] **What can a paired phone do besides Record?** Show recent clips' QR again, and **take cash
  payments**. It can't book sessions or refund (answered 2026-11-17).
- [x] **Keep "Sign in with a staff account"?** Yes, both. Pairing is the default screen, and
  managers can still sign in (answered 2026-11-17).
- [x] **One paired phone per court, or per venue?** Neither — **per session** (Phase E,
  2026-11-17).
- [x] **Should a paired phone's clips cost money?** Moot — the device no longer saves 60-second
  clips (Phase E).
- [ ] **(Phase E) Should a session itself be paid for at the counter** (a price per session or
  per hour)? Proposed: not now; sessions stay free.

## Revisions

- 2026-11-17: Created from the requester's flow: Setup (Venues › Courts › camera setup, Recorder
  Boxes), Dyna Cam (Clips, Sessions, Payments, pairing key), and the staff app's pair → courts →
  record → QR. It also covers the requester's question about `DEVICE_TOKEN`: kept, but entered
  as a 6-digit pairing key.
- 2026-11-17: Approved and build started.
  - **Record** saves the last 60 seconds.
  - **Paired phones** can also show recent clips' QR again and take cash payments for their
    venue; payments get `payments.pairedAppId`.
  - **Staff sign-in** stays in the app alongside pairing.
- 2026-11-17: Built as `/api/v1/pair/{app,device}` (its own mount, since `/app` and `/device`
  require a token) and `/admin/pairing-codes/{apps,recorders}`. Added `POST /api/v1/app/unpair`
  so "Unpair this phone" in the app also revokes it on the server, and `failureReason` on
  `/app/clips` for a failed clip's QR screen.
- 2026-11-17: Requester: "Why only 60 secs? It must save the whole game — on the app, Start
  recording starts it, End recording ends it." Added **Phase D**: a paired phone starts and ends
  a whole-game recording on a court. It reuses PLAN-001's recording sessions (5-minute parts, one
  share link for the game): Start creates a session from now, capped at 3 hours (or the court's
  next booking) so a forgotten recording stops itself; End finishes it now and shows the game's
  QR. The 60-second save stays as a smaller secondary button; the court sign and button are
  unchanged. Migration `009` records which phone started a session.
- 2026-11-17: **Phase E — session devices** (section 5). Requester: devices are paired to one
  session by staff, show it live with its download QR, and unpair when it ends; payments at the
  counter only; no courts list; no venue-wide Paired Apps; Clips view only. Answers: live view
  from the recorder box over the venue Wi-Fi; Stop on the device or at the end time; QR stays 10
  min after the end, then unpair; staff sign-in removed from the app. Supersedes the paired mode
  of Phases B–D (section 4) and the Phase D Start/End-from-phone routes. Document written first,
  build waits for the requester's go-ahead.
- 2026-11-17: **Phase F — `DEVICE_TOKEN` removed.** Requester: "We can remove this now?" A
  recorder box is now added only with a 6-digit key (Setup → Recorder Boxes → Add box); the
  admin "create a box and copy its token" and "new token" routes, the web token dialog and the
  box's `DEVICE_TOKEN` setting are gone. A box keeps its token in `DATA_DIR/device.json`; a box
  that was set up with `DEVICE_TOKEN` must be paired once with a key. (This also answers the
  2026-11-17 question that started this plan.)
- 2026-11-17: **Phase G — player's own live stream** (section 6). Requester: a player can set up
  their own live stream for their session by adding the stream address. Answers: the key is
  entered on the player's own phone via a short-lived QR on the session device; the venue's
  court stream keeps running alongside. Streamed by a separate process on the box from its own
  live view, so the recording never restarts. Document first; build waits for the go-ahead.


- 2026-11-17: **Phase H — two cameras on one court** (section 7). Requester: a court can have 2
  cameras; streams can show Cam 1 over Cam 2, or one camera only. Answers: the choice applies
  to the player's own stream and the venue's court stream (not the device's live view); clips
  and whole-game videos are stacked; the player picks their stream's layout. The venue's court
  stream moves to the restream model so stream changes never restart the recorder. Document
  first; build waits for the go-ahead.
- 2026-11-17: **Phase I — recorder boxes from `.env` only** (section 8). Requester: make
  recorder boxes internal, set up with env on the API and the box, no UI. Answers: `VENUE_ID`
  in the box's `.env`; the Recorder Boxes page is removed; boxes are listed and revoked from the
  API's command line. Supersedes box pairing keys (3.x, Phase B) — session-device pairing stays.
  Document first; build waits for the go-ahead.

