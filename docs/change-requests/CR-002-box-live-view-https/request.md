# CR-002 · Recorder box live view over HTTPS

> **Status:** In progress · **Requested:** 2026-11-18 · **Requested by:** bryanken00 · **Size:** S
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [PLAN-002](../../plans/PLAN-002-setup-menu-device-pairing/plan.md) (§5.4 live view)

## Requested change

> on back/.env I have cert for SSL. can you implement here also on edge?

The API can already run on HTTPS by pointing `certPath` at a certificate folder. The recorder box
should be able to do the same: give it the same certificate files and the court's live picture
on session devices is then served over HTTPS instead of plain HTTP.

## Today

The box serves the court's live picture to paired phones and tablets on the venue Wi-Fi over plain
HTTP only (`http://<box address>:8090`). A page or app that is itself on HTTPS can be blocked
from loading plain-HTTP video (mixed content / cleartext rules).

## Why

So the live view works from an HTTPS setup the same way the API does, with one certificate.

## Scope

**In**

- An optional `CERT_PATH` setting on the box: a folder with `privkey.pem`, `cert.pem` and
  `chain.pem` (`chain.pem` optional), the same files the API reads from `certPath`.
- With it set, the live view port serves HTTPS and the box reports an `https://` address.
- Clear warnings when the certificate can't be read, has expired, or doesn't match `LIVE_HOST`.
- A renewed certificate (e.g. Let's Encrypt) is picked up without restarting the box.

**Out**

- The court-button listener stays plain HTTP (Shelly buttons and ESP32 boards call plain HTTP).
- The box's own streams to YouTube/Facebook keep reading the live view over the box's internal
  loopback, not over HTTPS.
- Getting or renewing the certificate itself, and DNS for the box's host name.

## Acceptance criteria

- Without `CERT_PATH` nothing changes: the live view stays `http://…:8090`.
- With `CERT_PATH` and `LIVE_HOST` set to the certificate's host name, a paired session device
  plays the court live from `https://<host>:8090`.
- Venue and player live streams keep working with HTTPS on.
- A missing or unreadable certificate leaves recording and clips running, logs why, and turns
  only the live view off.

## Impact

| Area | Detail |
| --- | --- |
| Screens | None. The session device plays whatever link the API hands it. |
| Data | None. The API already accepts an `https://` live address (`device-api.validator.js`). |
| Build / rollout | Recorder box update, opt-in per box. Old boxes and boxes without `CERT_PATH` work as before. |
| Permissions | None |
| Existing users | No change unless `CERT_PATH` is set |
| Size | S: one listener in `edge/src/live.js` plus config, docs and tests |

## Open questions

- [x] Which host name does the certificate cover? `LIVE_HOST` must be set to it and must resolve
      to the box's LAN address on the venue Wi-Fi (local DNS or a public DNS record pointing at
      the LAN IP). The box warns if they don't match.

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-18 | Asked directly |
