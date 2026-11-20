# CR-018 · Email the player their game's Google Drive link (SendGrid)

> **Status:** In progress · **Requested:** 2026-11-20 · **Requested by:** bryanken00 · **Size:** M
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [CR-001](../CR-001-google-drive-per-court/request.md) (Google Drive per court, Drive QR in Sessions), [CR-015](../CR-015-pay-before-download/request.md) (pay before download), [CR-016](../CR-016-game-time-limit/request.md) (New game), [CR-017](../CR-017-auto-delete-24h/request.md) (videos deleted after 24 hours)

## Requested change

> Add SendGrid implementation. Once Google Drive finished uploading, must auto email to that email
> the link of Google Drive.

1. **New game** gets the player's **email** (next to name and phone).
2. Dyna Cam sends email through **SendGrid**.
3. When the game's videos have finished uploading to the court's Google Drive, the player
   automatically gets an email with the **link to the game's Drive folder**.

## Today

- New game takes the player's name and phone only. There is no email.
- The game's videos are copied to the court's Google Drive (CR-001) and staff can show the folder
  as a QR in Sessions, but nothing is sent to the player.
- The API sends email (password reset, venue alerts) through plain SMTP when `SMTP_HOST` is
  set; in development it only logs it. There is no SendGrid.

## Why

Players leave the court before the videos are ready. An email with the Drive link reaches them
without staff having to show a QR or send the link by hand.

## How it would work

| | Today | Requested |
| --- | --- | --- |
| New game | Name, phone | Name, phone, **email** (optional) |
| Game videos in Drive | Staff can show the QR | **Email sent automatically** to the player's email, once — as soon as the game is paid (or at once if free) |
| No Drive on the court, or the upload failed | — | **No email** |
| The email | — | Court, venue, date; "Open your game in Google Drive" button; how long it's kept (24 hours, CR-017) |
| Sending email | SMTP or console | **SendGrid for every email** (password resets, alerts, this one); SMTP removed. No key = only logged |
| Admin | — | The game's details show the email's state (sent, failed, waiting for payment / Drive), with **Edit email** and **Send Drive link** (again); the Drive QR dialog can send it too |

### Things to know

- **When it counts as "finished":** every whole-game video (one per camera) has finished uploading
  to Drive. Saves ("Save the last …") that land later go into the same folder, which the link
  already points to, so one email covers them.
- **Unpaid games (CR-015)** hide the Drive link until paid, so the email waits for the payment.
- **No Drive on that court**, or the upload failed: no email (the player still has the QR on the
  court's device and the player's page).
- **24 hours (CR-017):** the email says the link works until the videos are deleted.
- **SendGrid needs:** an API key and a verified sender address (Single Sender or the venue's
  domain authenticated in SendGrid). Without the key, emails are only logged, as now.

## Scope

**In**

- Player email on New game (optional), stored with the game, shown in Sessions.
- SendGrid sending (API key from `.env`), with the existing SMTP / console as fallback.
- The automatic "your game is in Google Drive" email, once per game, with retries if SendGrid
  fails.
- The email's status in the game's details; edit the player's email and send again (also from
  the Drive QR dialog).
- Password resets and venue alerts also go through SendGrid when it's set up.

**Out**

- Emails for 60-second replays (they have no player email).
- Text messages to the phone number.
- Marketing emails, unsubscribe lists.

## Acceptance criteria

- New game has an Email field; a wrong address is refused; it can be left empty.
- When a game with an email finishes uploading to Drive, the player receives one email with a
  button that opens the game's Drive folder on a phone with no Google sign-in.
- A game without an email sends nothing.
- An unpaid game's email waits; it goes once staff record the payment.
- A game on a court without Drive sends nothing.
- The game's details show "Drive link emailed to … at 4:32 PM" (or why not); staff can fix the
  email and send it again.
- Password reset emails also arrive through SendGrid.
- With SendGrid set up, the email comes from the configured sender.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Web: New game drawer (Email field), Sessions list/details (email, sent status). The email itself. |
| Data | Migration: `recording_sessions.email` and the Drive email's status / sent time / attempts / error. |
| API | `lib/mailer/mailer.js` gains SendGrid (HTTP API v3 `mail/send` over `fetch`, no SDK) when `SENDGRID_API_KEY` is set. New step after each Drive upload pass sends the email for games whose Drive upload finished. Validator: `email: optionalEmail(255)` on New game. |
| Build / rollout | Server + web deploy, migration. `.env`: `SENDGRID_API_KEY`, `MAIL_FROM` = a SendGrid-verified sender. App and recorder box: no change. |
| Permissions | None new. |
| Existing users | Nothing changes for games without an email. Release impact `minor`. |
| Size | M: SendGrid transport, email field, the send step with retries, template, tests — about 1–2 days. |

## Open questions

- [x] **Court without Google Drive (or the upload failed):** **send nothing** — only Drive links are
      emailed (bryanken00, 2026-11-20)
- [x] **Unpaid games:** **wait until paid**, then send; a free game sends at once (bryanken00,
      2026-11-20)
- [x] **Resend:** **yes, with email edit** — in the game's details staff can change the player's
      email and send the Drive link again; also from the Drive QR dialog (bryanken00, 2026-11-20)
- [x] **SendGrid for every email:** **yes** — password resets and venue alerts too once the key is
      set; SMTP / console stay as the fallback (bryanken00, 2026-11-20)

## Design notes (as built)

- `lib/mailer/mailer.js`: SendGrid Web API v3 (`POST /v3/mail/send` over `fetch`) for every email;
  without `SENDGRID_API_KEY` the email is only logged. SMTP and `nodemailer` removed. `MAIL_FROM`
  is the sender.
- `utils/gameEmails.js`: when a game is ready for the email (Ready, paid or free, whole-game
  videos' Drive uploads finished, one in Drive and still kept) and the state Admin shows
  (NoEmail, WaitingForGame, WaitingForPayment, WaitingForDrive, Queued, Sending, Sent, Failed,
  NoDrive).
- `jobs/driveEmails.js`: after each Drive upload pass (every 30 s), sends once per game; a
  SendGrid refusal retries (5, 15, 60, 180 min), then Failed.
- Admin: `PATCH /admin/sessions/:id/email` (a new address clears the sent state, so it gets the
  link) and `POST /admin/sessions/:id/drive-email` (send now / again).
- The email: "Your game is ready", court · venue · date, Open your game in Google Drive, and
  "Download your videos before <keep time>".

## Revisions

- 2026-11-20: Open questions answered — no Drive = no email, wait until paid, resend with email
  edit, SendGrid for every email.
- 2026-11-20: SMTP fully removed on request ("can we fully remove this?" → SMTP, keep SendGrid
  only): `SMTP_*` settings, the SMTP transport and the `nodemailer` package are gone. Without
  `SENDGRID_API_KEY` emails are only logged, and the Drive-link email waits ("NotSetUp") instead of
  counting as sent.

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-20 | Asked directly ("add sendgrid implementation", "add sendgrid API key on ENV"); open questions answered the same day |
