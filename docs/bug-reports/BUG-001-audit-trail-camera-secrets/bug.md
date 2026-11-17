# BUG-001 · Audit trail stores camera passwords and stream keys in plain text

> **Status:** Fixed · **Severity:** Critical · **Reported:** 2026-11-17 · **Reported by:** Claude (found while building PLAN-002 Phase G)
> **Fix checklist:** [fix.md](fix.md)

## Summary

When staff save a court's camera address or live-stream address in the Admin portal, the full
address — including the **camera password** or the **RTMP stream key** — is copied into the
audit trail. Anyone with Audit Trail access can read it there, and it sits unencrypted in the
database, although the court itself stores it encrypted.

## Where

- **Page / endpoint:** Setup → Venues → a court → Set up camera / Live stream ·
  `POST /api/v1/admin/courts`, `PUT /api/v1/admin/courts/:courtId` (and anything else behind
  `auditTrail()` that takes such a field); read back on Audit Trail ·
  `GET /api/v1/admin/audit-trail`
- **Account / role:** any staff with `audit_trail` read, even without `venues/courts` access
- **Environment:** local (found in the local `dyna-cam` database: 3 of 17 audit rows hold an
  `rtsp://`/`rtmp` address)

## Steps to reproduce

1. As staff with `venues/courts` write, set a court's camera address to
   `rtsp://user:secret@192.168.1.50:554/stream1` (or turn on its live stream with a key).
2. Open Audit Trail as staff with `audit_trail` read.
3. Open the court update's details.

## Expected

The audit row records that the court was changed, without the camera password or stream key
(as the courts API itself only ever returns them masked).

## Actual

`metadata.body.cameraRtspUrl` / `metadata.body.streamRtmpUrl` hold the full address with the
password / stream key, in plain text.

## Root cause

[auditTrail.middleware.js:32](../../../back/server/src/middlewares/auditTrail.middleware.js)
copies every request-body field into `metadata.body` except those named in `SENSITIVE_FIELDS`
(`password`, `token`, `secret`, …). PLAN-001 added fields that carry secrets inside a URL —
`cameraRtspUrl` and `streamRtmpUrl` — without adding them to that list, so they are stored as
sent. The global error handler in
[express.js](../../../back/server/config/express.js) masks a similar fixed list
(`password`, `pin`, `email`, …) before logging the body of a failed request, with the same gap
(and PLAN-002 Phase G's `streamKey` / `url` would hit it too).

## Resolution

A shared sanitiser,
[utils/redact.js](../../../back/server/src/utils/redact.js), now cleans request data before
it is stored or logged. It masks any `rtsp(s)://` or `rtmp(s)://` address wherever it appears:
a camera address loses its user and password, and a stream address keeps only the last 4
characters of its key. It also drops fields whose names mark a secret (`password`, `token`,
`streamKey`, `code`, …). Both the audit trail and the global error handler use it. Migration
`012_redact_audit_trail_secrets` removed the addresses already stored; the local database went
from 3 such rows to 0. `audit-trail.test.js` covers it.
