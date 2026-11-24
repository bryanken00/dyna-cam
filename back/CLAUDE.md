# Backend — (Node + Express + MySQL)

## ⚠️ Before writing any code in `back/server` or `back/database`, load the `backend-conventions` skill

The conventions are **non-negotiable** and live in that skill's `references/`
([`.claude/skills/backend-conventions/`](../.claude/skills/backend-conventions/SKILL.md)) — seven
topic docs covering the authenticated `req.user` context and the Owner-protection rule,
query/transaction patterns, schema and ID conventions, validators, permission gating, upload paths,
and tests. The skill's table says which one to read for the area you're touching. Read it **before** writing, not after.

Building a whole new CRUD module? Use the **`new-module`** skill instead — it drives this one plus
the frontend half in the right order.

## Stack

Node + Express · MySQL via a custom `Database` class wrapping `mysql2/promise` (`server/config/database.js`,
injected as `req.db`) · Passport JWT auth · Zod validators. One Admin portal (`/api/v1/admin/*`) plus
the shared `/api/v1/upload/*`, and four Dyna Cam route families that don't use a user login:
`/api/v1/device/*` (recorder boxes, `Authorization: Device <token>`, every query scoped to
`req.device.venueId`), `/api/v1/app/*` (a phone/tablet paired to one recording session,
`Authorization: App <token>`, scoped to `req.pairedApp.sessionId`; see
`utils/sessionDevices.js`), `/api/v1/pair/*` (a session's 6-digit key → an app token; a box's
`RECORDER_ENROLL_KEY` → a box token at `/pair/enroll`; rate-limited — boxes are listed and
revoked with `npm run boxes[:revoke]`) and `/api/v1/public/*` (players, no login — the court QR / clip share token is the
credential; `/public/stream-setup/:code` takes a player's own stream key, see
`utils/sessionStreams.js`). CR-001 adds `/api/v1/oauth/google/callback` (Google's redirect after
a court's "Connect Google Drive"; the encrypted `state` is the credential — see
`utils/googleDrive.js`, `utils/courtDrive.js` and the 30-second `jobs/driveJobs.js`: Drive-link
emails and trashing expired Drive copies). CR-006: a finished game is one file per camera — the
box gets a `type: "game"` job. CR-040: the box keeps that file and sends it straight to the court's
Google Drive: the API opens the upload (`/api/v1/device/game-videos/:id/drive-session`), takes
progress and `drive-done` (it reads the file back from Drive before believing it), and `box-deleted`
(`controllers/v1/device/game-videos.controller.js`, `session_videos.delivery = 'Drive'`). The API
never stores, serves or uploads a video file; the old `/start`, `/chunk`, `/finish` answer 410 and
game jobs go only to a box reporting `drive-direct`. No 5-minute pieces, no
joining, no ffmpeg on the server. PLAN-003 (court booking) adds the player's booking pages under
`/api/v1/public/book/:bookingToken/*` and `/api/v1/public/bookings/:manageToken/*`
(`controllers/v1/public/booking.controller.js`; the venue's booking link / the booking's own link is
the credential) and a fifth no-login family, `/api/v1/webhooks/xendit` (`x-callback-token`; the
invoice is read back from Xendit before anything changes — `lib/payments/xendit.js`,
`utils/bookingPayments.js`). Booking writes live in `utils/bookings.js` and lock the court row
before `utils/courtTimeline.js` `findConflict()`. Queries see the whole database (soft deletes aside); the seeded
**Owner** role and its accounts are the only records hidden from the Admin portal.

Reference implementation: `server/src/controllers/v1/admin/roles.controller.js`.

## Schema

**Never edit `database/schema.sql`** — it is the frozen baseline. Every schema change (new table,
column, index, ENUM value, FK, backfill) is a **new numbered migration** in
`database/migrations/` (`NNN_<what_it_does>.sql`), applied with `npm run db:migrate`.

**A migration is immutable once implemented** (committed or applied anywhere): never edit, rename,
renumber or delete it, even to fix it — write a new migration. The real schema is `schema.sql` +
every migration in order. Details: `schema-conventions.md` in the `backend-conventions` skill.

`npm run db:data` (`scripts/seed-demo-data.js`, PLAN-004) **empties the database** (every table
except `_migrations` and `permissions`; the Owner role and account are kept) and loads demo data for
development, with no video. It refuses `NODE_ENV=production`. A new table or
status the Admin pages show is worth a few demo rows there.

## Tests

`npm test` runs the API tests in `tests/` against a throwaway database it creates and drops; it
never opens the database in `DB_DATABASE`. Run it (and `npm run lint`) before reporting a backend
change done — there is no CI to run them for you. A new by-ID endpoint gets a test that a Deleted
(and, where relevant, Owner-owned) record returns 404 and is left unchanged — see
`tests/owner-protection.test.js`.
