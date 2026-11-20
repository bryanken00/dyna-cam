# CR-018 · Email the player their game's Google Drive link (SendGrid) — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered (2026-11-20: no Drive = no email, wait until paid, resend with
      email edit, SendGrid for every email)

## Build

### API (`back/`)

- [x] Migration: `recording_sessions.email VARCHAR(255) NULL`; Drive email state
      (`driveEmailStatus` Waiting/Sending/Sent/Failed, `driveEmailSentAt`, `driveEmailTo`,
      `driveEmailAttempts`, `driveEmailNextAttemptAt`, `driveEmailError`)
- [x] `lib/mailer/mailer.js`: SendGrid HTTP API v3 (`POST /v3/mail/send`, `fetch`) when
      `SENDGRID_API_KEY` is set — every email; SMTP / console otherwise. `SENDGRID_API_URL`
      overridable for tests. `.env.example` documents the key and the verified sender
- [x] Template `gameDriveEmail` (court, venue, date, button to the Drive folder, kept until …)
- [x] Sessions validator + create: `email: optionalEmail(255)`; list/detail return it
- [x] `PATCH /admin/sessions/:sessionId/email` `{ email }` and
      `POST /admin/sessions/:sessionId/drive-email` (send now / again) — `clips` write; 404 for a
      missing session; 409 when there's no Drive link yet or it's unpaid
- [x] Send step after each Drive pass: games with an email, paid or free, every whole-game
      video's Drive upload finished with at least one Uploaded + Ready, not sent yet → send once;
      SendGrid failure → retry with back-off, then Failed
- [x] Tests (fake SendGrid): sends once after upload; waits while unpaid, goes after payment;
      no Drive → nothing; no email → nothing; failure retries; resend; edit email; password
      reset goes through SendGrid
- [x] `cd back && npm run lint && npm test` — 294 pass (10 new in `tests/drive-email.test.js`),
      no new lint warnings
- [x] `.env.example` + local `.env`: `SENDGRID_API_KEY=` placeholder; tests blank the key so a
      real one in `.env` never sends from a test run; venue alerts email with SendGrid alone

### Web (`front/`)

- [x] New game drawer: Email field (optional, zod email) in Player
- [x] Sessions list: email under the player; details: email row with its Drive email state,
      Edit email, Send Drive link
- [x] Drive QR dialog: "Email it to …" button
- [x] `cd front && npm run lint && npm run build`

### 2026-11-20 revision — SMTP removed

- [x] Mailer: SendGrid or log only; SMTP transport and `nodemailer` removed
- [x] Drive-link email waits without `SENDGRID_API_KEY` ("NotSetUp"); Send Drive link says so
- [x] Venue alert emails need `SENDGRID_API_KEY`
- [x] `.env.example`, local `.env`, README, testing doc, changelog entries: no SMTP

### 2026-11-20 revision — Re-upload to Drive and Re-send email in Sessions

- [x] API: sessions list / detail include the game's Drive upload state (uploaded / uploading /
      failed / not uploaded / no Drive, last error, can re-upload)
- [x] `POST /admin/sessions/:sessionId/drive-upload` — re-queue the game's kept videos (whole game
      and saves) whose Drive upload failed, was skipped or never ran; 409 when the court's Drive
      isn't connected or nothing needs it; 404 missing; `clips` write
- [x] Sessions ⋮ menu: **Re-upload to Google Drive** and **Re-send email** (when sendable)
- [x] List: "Drive upload failed" / "Email failed" lines; details: Re-upload button by Footage
- [x] Tests: a failed upload is re-queued and uploads; refused when not connected / nothing failed
- [x] `cd back && npm run lint && npm test`; `cd front && npm run lint && npm run build`

### 2026-11-20 revision — phone / email checked as you type on New game

- [x] New game form validates a field on leaving it, then on every change (`mode: "onTouched"`)
- [x] Phone hint "Format: 0912 3456 789 — 11 digits starting with 09" under the field
- [x] `cd front && npm run lint && npm run build`

## Acceptance

Covered by the API tests against a fake SendGrid; still to check with a real SendGrid key, a
verified sender and a real Google Drive:

- [ ] New game has an Email field; a wrong address is refused; it can be left empty
- [ ] A paid game with an email gets one email once its videos are in Drive; the button opens the
      Drive folder on a phone with no Google sign-in
- [ ] An unpaid game's email waits; it goes once staff record the payment
- [ ] A game without an email, or on a court without Drive, sends nothing
- [ ] The game's details show when the link was emailed (or why not); staff can fix the email and
      send it again
- [ ] (2026-11-20) A game whose Drive upload failed shows it in Sessions; Re-upload puts it in
      Drive and the email follows; Re-send email sends it again
- [ ] With SendGrid set up, emails (this one and password resets) come from the configured sender

## Wrap-up

- [x] `cd back && npm run lint` passes
- [x] `cd front && npm run lint && npm run build` passes
- [x] Migration `025` pending (with `024`, which isn't applied on the development database yet —
      see CR-017)
- [x] Changelog entry added (`ref: CR-018`)
- [ ] Requester shown the result and signed off
- [ ] `request.md` status set to `Done`
