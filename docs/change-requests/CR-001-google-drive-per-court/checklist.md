# CR-001 · Google Drive auto-upload per court — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered (the Google Cloud owner is a go-live item, not a build blocker)

## Design notes

- **No Google SDK.** Plain `fetch` to Google's OAuth and Drive v3 REST endpoints
  (`utils/googleDrive.js`); every base URL is an env override so tests run against a fake Google.
- **OAuth:** `POST /admin/courts/:courtId/google-drive/connect` (venues.courts write) returns
  Google's consent URL with a signed, 10-minute `state` (courtId, accountId, expiry, HMAC).
  Google redirects the browser to `GET /api/v1/oauth/google/callback` (no login; the state is
  the credential), which trades the code for a refresh token, stores it encrypted
  (`secretBox`), and redirects to the court setup page with `?drive=connected|error`.
  `access_type=offline&prompt=consent` so Google always returns a refresh token.
- **Queue on the clip row:** when a clip on a connected court becomes Ready, the device upload
  marks it `driveStatus = 'Pending'`. A job (`jobs/driveUploads.js`, every 30 s) claims a few at a
  time, uploads with a resumable session, shares "anyone with link", stores `driveFileId` +
  `driveUrl`. Retries with backoff up to 6 attempts; a revoked sign-in (`invalid_grant`) marks the
  court `NeedsReconnect` and leaves its clips Pending; a clip whose server file is gone is
  `Skipped`.
- **Folders:** a court folder "Dyna Cam · <Venue> · <Court>" (private, created on first upload,
  re-created if deleted); replays go in it; a whole game gets a subfolder shared "anyone with
  link", stored on `recording_sessions`.
- **Changing account:** the court's token, email and folder are replaced; Pending clips go to
  the new account; links already uploaded stay valid. **Disconnect** revokes the token at Google
  (best effort), clears it, and marks the court's Pending clips `Skipped`.

## Build

### API (`back/`)

- [x] Migration `015_google_drive.sql`: `courts` drive columns, `clips` drive columns + index,
      `recording_sessions.driveFolderId/driveUrl`
- [x] `utils/googleDrive.js`: config, signed state, consent URL, code exchange, access token,
      revoke, folder create, resumable upload, share, error classes
- [x] Court setup: `GET` court includes `googleDrive` (configured, connected, email, status,
      problem, pending/failed counts, last upload); `POST …/google-drive/connect`,
      `DELETE …/google-drive`
- [x] `GET /api/v1/oauth/google/callback` (public, rate-limited) → store, redirect
- [x] Device clip upload marks the clip Pending for Drive when its court is connected
- [x] `jobs/driveUploads.js` scheduled from `server/bin/www.js`
- [x] Public clip/session endpoints return `driveUrl` (clip: only when playable; also after
      expiry); admin clips list returns `driveStatus`/`driveUrl`
- [x] `.env.example`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- [x] Tests (`tests/google-drive.test.js` + `google-drive-off.test.js`, fake Google server): connect URL, bad/expired state,
      callback stores encrypted token and never returns it, read-only staff 403, Deleted court 404
      unchanged, upload job uploads + shares + sets link, session folder, invalid_grant →
      NeedsReconnect, disconnect skips pending, public `driveUrl` hidden while unpaid

### Web (`front/`)

- [x] Court setup: Google Drive section (connect / change account / disconnect, status, problem),
      handles `?drive=` on return
- [x] Clips page: Drive status chip / link
- [x] Player clip page and whole-game page: Open in Google Drive button

### 2026-11-20 revision — Drive QR + link in Admin → Sessions

- [x] API: the sessions list / detail include the game's Drive folder link (`driveUrl`) once a
      kept video of it is in Drive (null otherwise)
- [x] Sessions ⋮ menu: **Google Drive** for a game with a Drive link that is paid or free
- [x] Dialog: court · venue · player, QR of the folder link, the link, Copy link, Open in Google Drive
- [x] Game details: a Google Drive row with the link and Show QR
- [x] Test: the link appears once the game's video is in Drive, and goes after it's deleted
- [x] `cd back && npm run lint && npm test`; `cd front && npm run lint && npm run build`

## Acceptance

- [x] Connect from the court setup page and return showing the account's email
- [x] A replay on that court appears in Drive within a few minutes, in the court's folder
- [x] A whole game appears as one folder with its parts
- [x] The player page shows Open in Google Drive, and it opens on a phone not signed in to Google
- [x] An unpaid clip hides the Drive button until paid
- [x] Switching account sends new recordings to the new account; old links keep working
- [x] Disconnect stops uploads
- [x] Revoked access shows "needs reconnecting"; held recordings upload after reconnecting
- [x] Read-only staff see the status but no buttons
- [x] Clips page shows which clips are in Drive
- [x] (2026-11-20) A finished, paid game in Sessions has Google Drive in its ⋮ menu; the dialog's QR
      opens the game's Drive folder on a phone

## Wrap-up

- [x] `cd back && npm run lint && npm test` passes
- [x] `cd front && npm run lint && npm run build` passes
- [x] Migration `015` noted as pending for deploy (`npm run db:migrate`)
- [x] Changelog entry added (`ref: CR-001`)
- [x] Requester shown the result and signed off (needs a real Google OAuth client)
- [x] `request.md` status set to `Done`
