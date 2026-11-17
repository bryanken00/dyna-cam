# PLAN-002 · Setup menu, camera setup, and 6-digit device pairing

> **Status:** Approved · **Created:** 2026-11-17 · **Owner:** — · **Checklist:** [checklist.md](checklist.md)
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
- `POST /api/v1/admin/pairing-codes` with `{kind, venueId, name}` (permission `paired_apps` for
  APP, `venues/devices` for RECORDER) returns `{code, expiresAt}`. `DELETE /:id` cancels a key.
- `POST /api/v1/app/pair` with `{code, platform, appVersion}` (public, rate-limited) creates a
  `paired_apps` row and returns `{token, pairedApp: {name}, venue: {venueId, name}}`. The token
  is shown only in that one response.
- `POST /api/v1/device/pair` with `{code, agentVersion}` (public, rate-limited) creates a
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
| API — pairing | `controllers/v1/public/pairing.controller.js` (or in `app/`, `device/`), `middlewares/rateLimiter.js` profile | `POST /app/pair`, `POST /device/pair`, brute-force limits |
| API — paired app | `middlewares/pairedAppAuth.middleware.js`, `controllers/v1/app/app.controller.js`, `routes/route.js` | `/api/v1/app/*` |
| API — device | `device.controller.js`, `device-api.validator.js` | heartbeat camera details, snapshot upload, `/device/pair` |
| Web | `front/src/routes/pageRoutes/AdminRoute.jsx`, `pages/Admin/Setup/{Venues,VenueDetail,CourtSetup,RecorderBoxes}/`, `pages/Admin/DynaCam/PairedApps/` | Menu restructure, venue → courts drill-down, guided camera setup with live preview, pairing-key dialogs |
| Edge | `edge/src/{config,api,sync,recorder}.js` | `PAIRING_CODE` → stored token, camera details in heartbeat, snapshots on request |
| App | `app/src/Navigation`, `Screens/Pair/`, `Screens/Paired/{Courts,Court,ShareQr}/`, `services/api/app.js`, `store/` | Pairing screen, paired-mode navigator, `expo-secure-store` |
| Docs | root `CLAUDE.md` (route families), backend/mobile/edge skills, `edge/README.md` | New `/api/v1/app/*` family, pairing |

## Out of scope

- Paired phones booking sessions or refunding payments. They stay in the staff-account app and
  the web.
- QR-code pairing, and scanning a court's QR in the app.
- Re-pairing a recorder box remotely. It needs someone at the box to type a new key.

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

## Open questions

- [x] **What does "Record" mean?** Save the **last 60 seconds** (answered 2026-11-17).
- [x] **What can a paired phone do besides Record?** Show recent clips' QR again, and **take cash
  payments**. It can't book sessions or refund (answered 2026-11-17).
- [x] **Keep "Sign in with a staff account"?** Yes, both. Pairing is the default screen, and
  managers can still sign in (answered 2026-11-17).
- [ ] **One paired phone per court, or per venue?** Proposed: per venue, with staff picking the
  court.
- [ ] **Should a paired phone's clips cost money** when the venue charges? Proposed: no; they're
  `STAFF` saves, like today.

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
