# CR-010 · Store clips and game videos in cloud storage — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [ ] Open questions answered *(provider and bucket needed to try it for real)*

## Build

- [ ] Migration `021`: `clips.storage`, `session_videos.storage` (`local` default)
- [ ] `utils/file/storage.js`: `STORAGE_DRIVER=local|s3`, put/delete/stream/sign for a stored key;
      env `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- [ ] Clip upload (device API): after the file lands, move it to the bucket when `s3`
- [ ] Game video upload (CR-006 chunked): move the finished file to the bucket (multipart)
- [ ] Every place that signs a clip/video link uses the row's storage (presigned GET, with
      `attachment` for downloads)
- [ ] Expiry (`clipMaintenance`) and other deletes go through the storage helper
- [ ] Google Drive upload streams from the bucket
- [ ] `npm run storage:migrate` (dry run first, then copy → verify size → mark row → delete local)
- [ ] Tests with a fake S3 driver: upload lands in the bucket, links signed, expiry deletes
- [ ] `back/.env.example` + docs: bucket setup, CORS, R2 vs S3

## Acceptance

- [ ] `local`: nothing changes
- [ ] `s3`: new clip plays and downloads; file is in the bucket only
- [ ] Game video uploads, plays, downloads, reaches Drive
- [ ] Expired clip's files are gone from the bucket
- [ ] `storage:migrate` moves old clips; they still play
- [ ] Expired signed link fails

## Wrap-up

- [ ] `cd back && npm run lint && npm test` passes
- [ ] Migration applied, or noted as pending for deploy
- [ ] Changelog entry added (`ref: CR-010`)
- [ ] Requester shown the result and signed off
- [ ] `request.md` status set to `Done`
