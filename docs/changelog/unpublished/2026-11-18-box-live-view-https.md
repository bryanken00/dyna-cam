---
type: added
impact: minor
audience: user
ref: CR-002
---

A recorder box can now send the court's live picture to paired phones and tablets over a secure
(HTTPS) connection. Give the box the same certificate the server uses.

## Dev notes

- edge/: new optional `CERT_PATH` in `edge/.env`. It points to a folder with `privkey.pem`, `cert.pem` and optional `chain.pem`, the same layout as back's `certPath`. With it set, `LIVE_PORT` serves HTTPS and the heartbeat reports `live.url` as `https://…`.
- edge/: with `CERT_PATH`, set `LIVE_HOST` to a host name the certificate covers that resolves to the box's LAN IP. The box warns at start if it doesn't match.
- edge/: the certificate files must be readable by the pm2 user (Let's Encrypt `privkey.pem` is root-only). Renewals are picked up within 6 h without a restart.
- edge/: an opt-in recorder box update. Boxes without `CERT_PATH` behave exactly as before. No API change: the API already accepts `https://` live URLs.
