# CR-001 · Google Drive auto-upload per court

> **Status:** Done · **Requested:** 2026-11-17 · **Requested by:** bryanken00 · **Size:** L
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [PLAN-001](../../plans/PLAN-001-court-replay-cameras/plan.md) (clips, sessions), [PLAN-002](../../plans/PLAN-002-setup-menu-device-pairing/plan.md) (court setup page, whole-game recording)

## Requested change

Every recording a court makes should also land in a Google Drive the venue owns, automatically:

> record → upload to Google Drive by the server → share the Google Drive link.
> Auto upload to Google Drive. Connect Google Drive by court. The action is on staff: they can
> change the Google account per court.

- On a court's setup page, staff click **Connect Google Drive**, sign in with a Google account,
  and from then on every replay clip and every whole-game recording on that court is copied into
  that account's Drive, in a "Dyna Cam" folder for the court.
- Staff can **change** the account (sign in with another one) or **disconnect** it at any time.
- The player keeps scanning the same QR. Their page plays the video as today and, once the Drive
  copy is there, shows an **Open in Google Drive** button.

## Today

There is no Google Drive code anywhere. The recorder box cuts a clip (or a 5-minute part of a
whole game), uploads it to the server, and the server keeps it for the venue's retention days
(30 by default), then deletes it. The QR and share link open the player's page, which plays the
server's copy through an expiring link. After the retention days the video is gone.

## Why

The venue keeps its own copy of every game in its own Google account, past the server's retention
window, and players get a link to it that keeps working. Different courts can go to different
accounts (e.g. a court rented by a club).

## Scope

**In**

- Connect, change and disconnect one Google account per court, on the court setup page, for
  staff who can edit court setup.
- Auto-upload of **every** recording on a connected court: 60-second replays (QR, button, staff)
  and each part of a whole game. A whole game gets its own folder.
- The Drive copy is an **extra** copy: the server's copy, the QR and the player page stay as they
  are.
- Drive files (and whole-game folders) are shared as "anyone with the link can view", so a player
  without a Google account can open them.
- The player page (clip and whole game) shows **Open in Google Drive** once uploaded, and keeps
  showing it after the server's copy has expired.
- The court setup page shows the connected account, uploads waiting, the last upload, and a
  problem that needs a reconnect (e.g. the account removed access).
- The Clips page shows whether each clip reached Drive.

**Out**

- Uploading recordings made **before** the court was connected.
- Deleting the Drive copy when a clip is deleted or expires on the server (the venue owns the
  Drive copy and manages it in Drive).
- A venue-wide or global account (it is per court; two courts can use the same account by
  connecting it on each).
- Any change to the staff phone app or the recorder box.
- Other cloud storage (Dropbox, OneDrive, YouTube).

## Acceptance criteria

- On a court's setup page I can click **Connect Google Drive**, sign in with Google, and come back
  to the same page showing the account's email.
- After that, a replay saved on that court appears in that Google Drive within a few minutes, in a
  folder named after the venue and court.
- A whole game recorded on that court appears as one folder with its parts.
- The player's QR page shows **Open in Google Drive**, and the link opens the video from a phone
  that isn't signed in to Google.
- An unpaid clip doesn't show the Drive button until it's paid.
- I can switch the court to another Google account; new recordings go to the new account, and
  links already given out keep working.
- I can disconnect; new recordings stay on the server only.
- If the account removes Dyna Cam's access, the setup page says it needs reconnecting, and
  recordings made meanwhile upload once it's reconnected (while the server still has them).
- Staff who can only view court setup see the Drive status but can't connect, change or
  disconnect.
- The Clips page shows which clips are in Drive.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Web: court setup page (new Google Drive section), Clips page (Drive status), player clip and whole-game pages (Open in Google Drive). App: none. |
| Data | Migration `015`: Google Drive columns on `courts` (encrypted refresh token, email, folder, status) and on `clips` (Drive file, link, upload status/attempts), plus the whole-game folder on `recording_sessions`. No local SQLite. |
| Build / rollout | No app build, no recorder-box update. **Server setup:** a Google Cloud project with the Drive API on, an OAuth client (web), `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` in `back/.env`, and the redirect URI registered in Google. Without them the section says Drive isn't set up and nothing uploads. The consent screen must be **In production** (in Testing, Google expires the sign-in after 7 days). Scope `drive.file` (only files Dyna Cam creates) plus `openid email`. |
| Permissions | No new permission: `venues.courts` read sees the status, write connects/changes/disconnects. |
| Existing users | Nothing changes until a court is connected. Not breaking. |
| Size | L: OAuth flow, a background uploader with retries, three web screens, tests against a fake Google. |

## Open questions

- [x] Replace the server copy or extra copy? → **Extra copy** (bryanken00, 2026-11-17)
- [x] QR target → **our player page**, with an Open in Google Drive button (bryanken00, 2026-11-17)
- [x] What uploads → **everything** (replays and whole games) (bryanken00, 2026-11-17)
- [x] Who can connect → **court setup permission** (`venues.courts` write) (bryanken00, 2026-11-17)
- [ ] Who owns the Google Cloud project and OAuth client (needed before go-live, not to build)

## Revisions

- 2026-11-20: Added — Admin → Sessions: a finished game whose video is in Google Drive gets a
  **Google Drive** action (row ⋮ menu and the game's details) that opens a dialog with the game's
  Drive folder as a **QR code** and a link (copy / open), for staff to show or send the player.
  Shown only once the game is paid or free (like the player's page, CR-015), and gone once its
  Drive copies are deleted (CR-017). Asked directly by bryanken00.

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-17 | Asked directly; design choices answered in chat |
| Signed off — Done | bryanken00 | 2026-11-20 | Bulk sign-off by the requester ("check all CR and plan… mark all complete"); acceptance items ticked on that sign-off, not re-checked one by one |
