---
type: security
impact: patch
audience: user
ref: CR-044
---

The venue recorder boxes are better protected: camera logins, stream keys and players' game videos
on a box can only be read by the box itself, and a box only connects to the cloud over a secure
connection. A new step-by-step guide covers locking a box down and what to do if one is stolen.

## Dev notes

- edge/: **update every venue's box** (`git pull`, `npm ci --omit=dev`, `pm2 reload dyna-cam-edge`). Old boxes keep working against the current API; nothing changes in back/.
- edge/: before updating a box, check its `.env` `API_URL` starts with `https://` — the box now refuses plain `http://` except to an API on the same machine (local testing), and refuses `NODE_TLS_REJECT_UNAUTHORIZED=0`.
- edge/: the court-button listener (port 8089) and press relay are removed (the API dropped them in CR-027). Leftover `BUTTON_PORT` / `BUTTON_HOST` / `BUTTON_KEY` lines are only warned about; delete them. Close 8089 in the box firewall.
- edge/: the box now runs with umask 077 and on start makes `.env` 600 and `DATA_DIR` 700 (not on Windows); new `security: …` start-up warnings (root, live view without `CERT_PATH`, Linux `/proc` without `hidepid`). New module `src/hardening.js`.
- docs/: new `docs/recorder-box-security.md` — apply it to each box after updating. Enrolment should be off between installs: clear `RECORDER_ENROLL_KEY` in back/.env (restart the API) and delete `ENROLL_KEY` from enrolled boxes' `.env`.
- docs/: the Windows install guide's start-up task now uses `-RunLevel Limited`; existing Windows boxes re-register it (guide §5).
