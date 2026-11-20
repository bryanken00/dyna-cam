# CR-002 · Recorder box live view over HTTPS — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered

## Build

- [x] `config.js`: optional `CERT_PATH` → `settings.certPath` (resolved from `edge/`)
- [x] `live.js`: read `privkey.pem` + `cert.pem` (+ optional `chain.pem`); HTTPS server on `LIVE_PORT`
- [x] `live.js`: loopback-only plain-HTTP listener for restreams (`localPlaylistUrl`)
- [x] `live.js`: heartbeat `live.url` is `https://…` with a certificate
- [x] `live.js`: warn on an unreadable, expired or host-mismatched certificate; unreadable → live view off, recording goes on
- [x] `live.js`: reload a renewed certificate (`setSecureContext`) without a restart
- [x] Tests: config, HTTPS live view, loopback URL, bad cert, host mismatch, reload
- [x] `.env.example`, README, `edge-conventions` skill updated

## Acceptance

- [x] Without `CERT_PATH` the live view is unchanged (`http://`)
- [x] With `CERT_PATH` + `LIVE_HOST` a session device plays the court live over `https://` (check on a real box)
- [x] Venue / player streams keep working with HTTPS on
- [x] A missing certificate turns only the live view off, with a log line saying why

## Wrap-up

- [x] `cd edge && npm run lint && npm test` passes
- [x] `cd edge && npm run smoke` passes (live view and restreams still work)
- [x] Changelog entry added (`ref: CR-002`)
- [x] Requester shown the result and signed off
- [x] `request.md` status set to `Done`
