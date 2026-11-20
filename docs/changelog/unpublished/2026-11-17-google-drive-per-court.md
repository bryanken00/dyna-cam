---
type: added
impact: minor
audience: user
ref: CR-001
---

Each court can now copy its recordings to a Google Drive. On a court's setup page, click
**Connect Google Drive** and sign in with Google. From then on, every replay and every whole game
recorded on that court is also saved in that Drive, in a folder for the court, with each whole
game in its own folder. Players see an **Open in Google Drive** button on their page; it works
without a Google account. In **Sessions**, a finished game that is in Drive has **Google Drive QR &
link** in its menu and its details: a QR code and link to the game's Drive folder to show or send
the player. Staff can switch the court to another Google account or disconnect it at any time, and
the Clips page shows which clips are in Drive. Unpaid clips and games show the Drive link only once
paid.

## Dev notes

- `back/`: run `npm run db:migrate` (migration `015_google_drive`: Drive columns on `courts`,
  `clips`, `recording_sessions`).
- `back/`: set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI` in `.env`
  (see `.env.example`). The redirect URI is `<API origin>/api/v1/oauth/google/callback` and must be
  added to the Google Cloud OAuth client (type "Web application"). Enable the Google Drive API.
  Publish the OAuth consent screen to **In production**: in Testing, Google expires the sign-in
  after 7 days. Scopes are `openid email drive.file`. Without the three variables, the court page
  says Drive isn't set up and nothing uploads.
- `back/`: the stored Google sign-ins are encrypted with `DEVICE_SECRET_KEY`. Changing that key
  means every court has to reconnect.
- `back/`: new `POST /admin/courts/:courtId/google-drive/connect`,
  `DELETE /admin/courts/:courtId/google-drive` (`venues.courts` write), and public
  `GET /api/v1/oauth/google/callback`. The court now includes `googleDrive`; player clip and
  session pages include `driveUrl`; the admin clips list includes `driveStatus` and `driveUrl`;
  the admin sessions list and detail include the game's Drive folder `driveUrl` once a kept video
  of it is in Drive (2026-11-20).
  The upload job runs every 30 s in the API process (`jobs/driveUploads.js`).
- `app/`, `edge/`: no change.
