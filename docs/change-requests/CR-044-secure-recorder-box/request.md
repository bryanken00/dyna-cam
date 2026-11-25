# CR-044 · Secure the recorder box

> **Status:** In progress · **Requested:** 2026-11-25 · **Requested by:** bryanken00 · **Size:** M
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [PLAN-001](../../plans/PLAN-001-court-replay-cameras/plan.md) (the recorder box), [PLAN-002](../../plans/PLAN-002-setup-menu-device-pairing/plan.md) (box enrolment), [CR-027](../CR-027-player-start-game-qr/request.md) (court buttons removed), [CR-040](../CR-040-videos-local-drive-only/request.md) (videos kept on the box)

## Requested change

Make the recorder box at each venue safe to leave unattended. Someone on the venue Wi-Fi, someone
who gets a login on the box, or someone who walks off with it should not be able to watch the
cameras, take the camera passwords or stream keys, read players' videos, or pretend to be the box.
Every new box should be set up the same hardened way, from one written checklist.

## Today

The box's link to the cloud is already sound: it only calls out, it signs in with its own
revocable token (kept in a file only the box's user can read), the cloud only lets it see its own
venue, the camera passwords and stream keys are masked in its logs, and the live view only plays
links the cloud signed.

What's weak:

- **A typo can send secrets unencrypted.** The box accepts a cloud address starting `http://`, so
  its token, the camera passwords and the stream keys would cross the internet in the clear.
- **A leftover listener on the venue Wi-Fi.** The court buttons were removed in CR-027, but the box
  still listens for them on port 8089, and with no button key set (the test box has none) anyone on
  the Wi-Fi can send it "presses". The cloud no longer accepts them, so they just queue up.
- **Files anyone on the box can read.** The settings file (with the enrol key) and every kept game
  video and the live buffer are readable by any account on the machine.
- **Camera passwords on the process list.** The camera address, password included, is on ffmpeg's
  command line, which any account on the box can see with `ps`. The same goes for live-stream keys.
- **The box itself isn't hardened.** The setup guide installs ffmpeg, pm2 and the app but says
  nothing about a dedicated user, a firewall that only lets the venue network in, SSH, automatic
  security updates, or what to do if a box is stolen.
- **The cameras sit on the open venue network** with whatever password they came with (the office
  test camera's is easy to guess).

## Why

Each box holds the keys to its venue: the camera logins, the venue's live-stream keys, players'
own stream keys, and days of game videos. Boxes sit in public venues on shared Wi-Fi with no one
watching them. One weak box exposes that venue's cameras and players' videos.

## Scope

**In**

- Box software: refuse an unencrypted cloud address; drop the court-button listener; keep its
  files private to the box's user; warn about an unsafe setup at start-up; keep camera passwords
  and stream keys off the process list where ffmpeg allows it.
- Box setup guide: a hardening section (dedicated user, firewall, SSH, updates, process list,
  disk, boot) and a "box stolen or compromised" runbook.
- Venue network and camera guidance: camera passwords, keeping cameras off the guest Wi-Fi.
- Turning box enrolment on only while installing a box.

**Out**

- Enrol keys per venue or single-use keys (a cloud change; separate CR if wanted — see Open
  questions).
- Tokens that expire on their own.
- Full-disk encryption on the box (see Open questions).
- The cloud server's own hardening.

## Acceptance criteria

- A box set up with an `http://` cloud address refuses to start and says why (except a test box
  talking to the same machine).
- Nothing answers on the old button port.
- On a box, an account other than the box's own can't open the settings, the videos or the live
  buffer, and can't see a camera password in the process list.
- The setup guide has a hardening section a technician can follow line by line, and a "box
  stolen" runbook that says exactly what to revoke and change.
- Enrolment is off on the cloud except while a box is being installed.
- Every existing box keeps recording and sending videos to Drive after the update.

## Impact

| Area | Detail |
| --- | --- |
| Screens | None. |
| Data | None in the cloud. On the box, existing `data/` and `.env` get tightened permissions. |
| Build / rollout | **Recorder box update** at every venue (pull, `pm2 restart`). Old boxes keep working against the API; nothing in the API changes. The OS hardening is done by hand on each box. |
| Permissions | None. |
| Existing users | Players and staff see nothing different. A box whose `.env` says `http://` for a real server stops until it's fixed — check every venue's `.env` before rolling out. Court buttons already do nothing since CR-027. |
| Size | M — a few small box changes with tests, plus the guide and a runbook; the per-box hardening is a technician's hour each. |

## Open questions

Decided when the build was asked for (2026-11-25); change any of them and the guide follows:

- [x] **Per-venue enrol keys?** Not now. Enrolment is turned on only while a box is installed, with a
      fresh key each time ([guide §1](../../recorder-box-security.md#1-enrol-keys-on-only-while-installing)).
      Per-venue or single-use keys would be a separate cloud CR.
- [x] **Disk encryption?** Recommended where it unlocks by itself (BitLocker with TPM on Windows,
      LUKS with TPM on Linux); optional on a Mac (FileVault stops at the password screen after a
      power cut).
- [x] **Camera network:** cameras and the box off the guest Wi-Fi, on their own network/VLAN where
      the router can. Cameras are **not** blocked from the internet (the Tapo app keeps working).
- [x] **Remote access:** never port-forwarded; SSH/Remote Desktop with keys only, from the LAN or
      over a VPN (Tailscale/WireGuard), or support on site.

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-25 | Asked directly ("implement this") |
| Signed off (build) | bryanken00 | 2026-11-25 | Code, tests and guide accepted; Done after the real-box acceptance checks and the venue rollout |
