# BUG-001 · Audit trail stores camera passwords and stream keys in plain text — Fix checklist

> Bug: [bug.md](bug.md)

## Confirm

- [x] Reproduced: 3 audit rows in the local database hold an `rtsp://` / `rtmp` address
- [x] Root cause confirmed (not a hypothesis) and written in bug.md

## Fix

- [x] One shared sanitiser (`utils/redact.js`): drops secret-named fields (`password`, `token`,
      `streamKey`, `cameraRtspUrl`, `streamRtmpUrl`, `url`, `code`, …) and masks any string
      value that is an `rtsp(s)://` / `rtmp(s)://` address, at any depth
- [x] `auditTrail` metadata and the global error handler's logged body/query/params use it
- [x] Migration `012_redact_audit_trail_secrets.sql`: remove `cameraRtspUrl` / `streamRtmpUrl` /
      `streamKey` / `url` from existing `audit_trail.metadata.body`
- [x] Test (`audit-trail.test.js`): saving a court's camera and stream addresses leaves no
      credential or key in the audit row; the masked camera address and the change stay

## Check nothing else broke

- [x] Searched for other places that store or log request bodies (`req.body` in middlewares,
      config, utils); none left unmasked
- [x] Audit Trail page still lists court changes; access unchanged

## Wrap-up

- [x] `cd back && npm run lint && npm test` passes (173)
- [x] Migration `012` applied locally (approved 2026-11-17): 3 rows → 0
- [x] Changelog: the feature is unreleased, so its entry (`2026-11-17-qr-replay-clips.md`,
      PLAN-001) gained a dev note instead of a separate "fixed" entry
- [x] `bug.md` status set to `Fixed`, Resolution filled
