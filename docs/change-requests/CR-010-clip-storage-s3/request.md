# CR-010 · Store clips and game videos in cloud storage

> **Status:** Approved · **Requested:** 2026-11-19 · **Requested by:** bryanken00 · **Size:** L
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** PLAN-001 (clips on the API's disk), CR-006 (one file per game)

## Requested change

Keep replay clips, whole-game videos and their thumbnails in S3-compatible cloud storage
(Cloudflare R2 or Amazon S3) instead of on the API server's own disk. Players and staff open and
download them exactly as before.

## Today

- Recorder boxes upload clips and game videos to the API, which saves them under
  `public/uploads/admin/clips/` on its own disk and serves them through signed links that expire.
- A whole game is one file per camera, often over 1 GB. A few busy courts fill a normal server
  disk within days, and the files are lost if the server is.
- Expired files are deleted from disk by the hourly maintenance job.

## Why

The server's disk is the first thing that runs out as venues are added, and it's the only copy.
Cloud storage grows without limits, costs little (R2 has no download fees), and survives the
server.

## Scope

**In**

- A storage setting on the API: `local` (today's behaviour, the default) or `s3` with an
  endpoint, bucket and keys, so R2 and S3 both work.
- With `s3`: new clips, thumbnails and game videos are moved to the bucket once uploaded; links
  are short-lived signed bucket links; expiry deletes from the bucket; the Google Drive upload
  reads from the bucket.
- `npm run storage:migrate` copies the clips and videos already on disk to the bucket and then
  removes the local copies.

**Out**

- Venue logos, avatars, signatures and camera previews (small; they stay on disk).
- Moving the files that boxes keep locally.
- A CDN in front of the bucket.

## Acceptance criteria

- With storage left at `local`, nothing changes.
- With `s3` set: a new clip plays and downloads from its share page, and the file is in the
  bucket, not on the server's disk.
- A whole-game video uploads, plays, downloads and goes to Google Drive as before.
- An expired clip's files disappear from the bucket.
- After `npm run storage:migrate`, old clips still play and the server's clip folder is empty.
- A signed link stops working after it expires.

## Impact

| Area | Detail |
| --- | --- |
| Screens | None. Links look different (bucket host) but are used the same way. |
| Data | Migration `021`: `clips.storage` and `session_videos.storage` (`local`/`s3`), so old and new files can live side by side during the move. |
| Build / rollout | No box or app update. The API gets `@aws-sdk/client-s3` and the presigner. The bucket needs CORS for the web origin if the browser plays from it. |
| Permissions | None. |
| Existing users | None while `local`. |
| Size | L: every place that reads, writes, signs or deletes a clip or video file, plus the migration command and tests. |

## Open questions

- [ ] **Provider:** Cloudflare R2 (recommended: no download fees) or Amazon S3? Someone has to
      create the bucket and an access key; the code works with either.
- [ ] Keep a local copy as well, or bucket only? (Default: bucket only.)

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-19 | Asked directly ("Keeping it running") |
