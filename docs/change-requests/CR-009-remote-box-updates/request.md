# CR-009 · Update recorder boxes remotely

> **Status:** Approved · **Requested:** 2026-11-19 · **Requested by:** bryanken00 · **Size:** M
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** PLAN-002 (boxes listed with `npm run boxes`), CR-008 (box health)

## Requested change

Put a new version of the recorder software on the venues' boxes from the API server, without
someone travelling to each venue or logging in to each box. A box updates itself only when no
game is being recorded or sent, and goes back to the version it had if the new one doesn't come
up.

## Today

- Each box is a `git clone` of this repo in `/opt/dyna-cam`, run by pm2. Updating it means
  logging in, `git pull`, `npm install`, and `pm2 restart`, one box at a time.
- `npm run boxes` on the API server lists the boxes with their reported `agentVersion`, but
  nothing can be sent to them.

## Why

Every fix to the box so far (BUG-002, BUG-003, CR-006, CR-007) needed someone on each box. With
more than one venue that doesn't scale, and a box running old code is where the hard bugs come
from.

## Scope

**In**

- `npm run boxes:update -- <name|id|--all> <version>` on the API server picks the version (a git
  tag or commit) for one box or all of them; `npm run boxes:update -- <name|id|--all> --cancel`
  clears it.
- The box hears about it in its heartbeat reply, waits until it's idle (no game recording, no
  clip being cut, nothing waiting to upload), then fetches that version, installs its packages
  and restarts.
- If the new version doesn't send a heartbeat within 3 minutes, the box goes back to the old
  version and reports the update as failed, with a reason.
- `npm run boxes` shows each box's running version and update status.

**Out**

- A web page for box updates (boxes have no page, PLAN-002).
- Updating Node, ffmpeg or the operating system.
- Boxes not installed with `git clone` (they report "can't update" and are left alone).

## Acceptance criteria

- Tag a release, run `npm run boxes:update -- --all v1.2.0`: each idle box is on `v1.2.0` within
  a few minutes, and `npm run boxes` says so.
- A box recording a game doesn't restart; it updates after the game ends and its video is sent.
- Point a box at a version that crashes on start: within about 3 minutes it's back on its old
  version and `npm run boxes` shows "failed" with the reason.
- `--cancel` stops an update that hasn't started.

## Impact

| Area | Detail |
| --- | --- |
| Screens | None (command line on the API server). |
| Data | Migration `020`: `devices.targetVersion`, `devices.updateStatus`, `devices.updateMessage`, `devices.agentCommit`. |
| Build / rollout | **Recorder box update, once, by hand**: boxes learn to update themselves only after they get this version. Each box needs read access to the git repo (a deploy key) for `git fetch`. Old boxes ignore the new heartbeat field. |
| Permissions | None. Only someone with shell access to the API server can start an update. |
| Existing users | Nothing changes until an update is started. |
| Size | M: heartbeat field, a detached updater script with rollback, two migrations' worth of columns, the CLI. |

## Open questions

- [ ] **Repo access on the boxes:** a read-only deploy key per box, or one shared key? (Install
      guide documents a per-box key.)
- [ ] Should boxes take updates only at night (e.g. 1–5 AM), or whenever idle? (Default: whenever
      idle.)

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-19 | Asked directly ("Keeping it running") |
