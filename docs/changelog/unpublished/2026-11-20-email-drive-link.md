---
type: added
impact: minor
audience: user
ref: CR-018
---

New game now takes the player's email, and checks the phone number (0912 3456 789) and email as
soon as you leave each field. Once the game's videos are in the court's Google Drive and
the game is paid (or free), the player automatically gets an email with a button to open the game
in Google Drive. In Sessions, staff can see whether the link was emailed, fix a mistyped email and
send the link again (also from the Google Drive QR dialog). When a game's Google Drive upload
fails, Sessions shows it, and **Re-upload to Google Drive** and **Re-send email** are in the game's
menu. All emails, including password resets
and venue alerts, are now sent through SendGrid.

## Dev notes

- back/: run `npm run db:migrate` — `025_session_email.sql` adds `recording_sessions.email` and the
  Drive-email state columns (needs `024` first).
- back/: set `SENDGRID_API_KEY` in `.env` (Mail Send access) and `MAIL_FROM` to a sender verified
  in SendGrid (Single Sender or an authenticated domain), e.g. `Dyna Cam <no-reply@yourdomain.ph>`.
  Every email goes through SendGrid's Web API. **SMTP is removed** (`SMTP_HOST`, `SMTP_PORT`,
  `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` are no longer read; delete them from `.env`) and so is the
  `nodemailer` package. Without the key nothing is sent: emails are only logged, and the Drive-link
  email waits (Admin shows "email isn't set up").
- back/: venue alert emails need `SENDGRID_API_KEY` (`ALERT_EMAIL=false` still turns them off).
- back/: the email is sent by `jobs/driveEmails.js`, after each Drive upload pass (every 30 s):
  game Ready, paid or free, its whole videos' Drive uploads finished with one in Drive. Retries 5
  times, then Failed. New `PATCH /api/v1/admin/sessions/:sessionId/email` and
  `POST /api/v1/admin/sessions/:sessionId/drive-email` (`clips` write).
- back/: new `POST /api/v1/admin/sessions/:sessionId/drive-upload` (`clips` write) re-queues the
  game's kept videos whose Drive upload failed, was skipped or never ran; sessions include
  `driveUpload` (status, error, canReupload).
- front/: BUG-010 — the Google Drive QR dialog is wider (`sm:max-w-125`, 500 px) so **Email it · Copy link ·
  Open in Google Drive** fit on one line; the shared `Dialog` / `AlertDialog` now keep content inside
  the box (`grid-cols-[minmax(0,1fr)]`) and wrap a too-wide button row (`sm:flex-wrap`).
- app/, edge/: no change.
