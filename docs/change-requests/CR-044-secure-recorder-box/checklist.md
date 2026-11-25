# CR-044 · Secure the recorder box — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered (enrol keys, disk encryption, camera network, remote access)
- [ ] Every venue box's `.env` checked: `API_URL` starts with `https://` (both install guides
      already say `https://office.dynamicglobalsoft.com:1342`; check each real box before updating it)

## Build — box software (`edge/`)

- [x] **HTTPS only:** `config.js` refuses an `API_URL` that isn't `https://`, except plain
      `http://` to this same machine (`isThisMachine`: loopback or one of its own addresses, so
      `./run.sh edge` against the local API still works). Drive addresses use the same shared
      `isLoopbackHost` (`util.js`). `.env.example` and README updated. Tests for both cases.
- [x] **Certificate checks stay on:** refuses to start with `NODE_TLS_REJECT_UNAUTHORIZED=0`. Test.
- [x] **Court-button listener removed:** `buttons.js` (+ its test), `BUTTON_PORT/HOST/KEY`,
      `jobs.addPress` / `relayPress`, `api.pressButton`, the `press` lane. A `press` entry in an older
      box's `queue.json` is dropped at start-up with a log line (test); leftover `BUTTON_*` in `.env`
      is warned about (test). README section, troubleshooting row and `.env.example` lines removed;
      `run.sh` / `run-mac.sh` no longer fall back to port 8089.
- [x] **Private files:** `process.umask(0o077)` first thing in `index.js` (ffmpeg inherits it).
      `makePrivate` (`src/hardening.js`) makes `.env` 600 and `DATA_DIR` 700 at start-up, or warns
      with the `chmod` to run; nothing on Windows. Tests.
- [x] **Start-up security warnings** (`security: …`, the box keeps recording): running as root; live
      view without `CERT_PATH`; Linux `/proc` without `hidepid`. Tests.
- [x] **Secrets on ffmpeg's command line:** ffmpeg has no other way to take an RTSP login or an
      RTMP key, so the fix is `hidepid=2` on Linux (warned about, in the guide). macOS and Windows
      don't show other accounts' command lines to a standard account. The box never logs or reports
      ffmpeg's arguments (every log line goes through `maskCredentials`).
- [x] `npm run lint` and `npm test` (306) pass; `npm run smoke` passes run under `umask 077`.
      (`npm run format:check` flags `src/live.js`, which this CR didn't touch — it was already
      like that.)

## Build — box setup guide

Written as [docs/recorder-box-security.md](../../recorder-box-security.md) (one guide for Linux,
Mac and Windows), linked from both install guides (new Part G½), the edge README (new
**Security** section) and the cloud runbook.

- [x] **Own account:** `dynacam` without sudo (Linux), a Standard user (Mac / Windows), pm2 as that
      account. The Windows install guide's start-up task now uses `-RunLevel Limited`.
- [x] **Firewall:** Linux `ufw` deny-incoming + 8090/22 from the venue subnet; Mac firewall + stealth;
      Windows rule limited to `LocalSubnet`.
- [x] **SSH / Remote Desktop:** keys only, no root, LAN or VPN only, or off.
- [x] **Updates:** unattended-upgrades / macOS security responses / Windows Update; box software update steps.
- [x] **Process list:** `hidepid=2` (fstab + remount).
- [x] **Files:** `.env` without the enrol key after enrolment, private files, no stray copies of
      `data/` or `.env` (`data-local-backup/`), Windows `icacls` on `C:\dgsports`.
- [x] **Physical:** firmware password, internal-disk boot, locked cabinet, UPS; disk encryption per
      the decision in request.md.
- [x] **Logs:** `pm2-logrotate` (already in both install guides).
- [x] **Time:** chrony (already in the guide).

## Build — venue network and cameras (guide §6)

- [x] Own strong Camera Account password per camera; change test passwords before going live.
- [x] Box wired; cameras and box off the guest Wi-Fi; own network/VLAN where possible; fixed IPs.
- [x] Camera firmware updated; unused services off.
- [x] Session devices still reach the live view after a network change.

## Build — enrolment and incident runbook (guide §1, §7, §8)

- [x] **Installing a box:** set a fresh `RECORDER_ENROLL_KEY`, enrol, delete `ENROLL_KEY` from the
      box's `.env`, clear `RECORDER_ENROLL_KEY`, check `npm run boxes`. Cloud runbook updated to match.
- [x] **Box stolen or compromised:** revoke → camera passwords → stream keys → enrol key → Drive
      folders → replacement box → note it down. Retiring a box: revoke, delete, wipe.
- [x] Monthly check: `npm run boxes`, no `security:` lines, disk space.

## Acceptance

- [x] A box with an `http://` cloud address refuses to start and says why (tried:
      `API_URL=http://office.example.com:1342` → "API_URL must start with https://"); this machine
      still works (tests)
- [ ] Nothing answers on port 8089 — on a real box after the update (`curl http://<box-ip>:8089/health` fails).
      2026-11-25, office Mac box: **not yet** — it still runs the code from before CR-044
      (`npm start` since 11:08, listening on 8089 and 8090); it needs a restart.
- [ ] Another account on the box can't read `.env`, `data/`, videos or the buffer, and sees no
      camera password in `ps` — on a real Linux box with the guide applied.
      2026-11-25, office Mac box: **can't pass where it is** — `edge/` is on the external drive
      "Altes External", mounted `noowners`, so every account can read it whatever the file modes
      (guide §4 now says so). Today `.env` is 644 and `data/` 755 (the restart fixes the modes).
- [ ] The hardening guide and the "box stolen" runbook were followed once on a real box.
      2026-11-25, office Mac box against guide §4: FileVault on, Remote Login off, automatic
      security updates on; **firewall off**, **runs under an admin account (`altes`)**, **on an
      external `noowners` drive**, empty stray `data-local-backup/`.
- [ ] Enrolment is off on the cloud except while installing (`RECORDER_ENROLL_KEY` cleared on the server).
      2026-11-25: **on** — a test enrol with a made-up key got `400` (key refused), not `403`
      (enrolment off).
- [ ] An updated box still records, shows the live view, and sends a game to Drive

## Wrap-up

- [x] `cd edge && npm run lint && npm test && npm run smoke` pass
- [ ] Every venue box updated and hardened (list each box and date)
- [x] Changelog entry added (`ref: CR-044`)
- [x] Requester shown the result and signed off (bryanken00, 2026-11-25 — signed off on the build; stays
      In progress until the box checks above and every venue box are done)
- [ ] `request.md` status set to `Done`
