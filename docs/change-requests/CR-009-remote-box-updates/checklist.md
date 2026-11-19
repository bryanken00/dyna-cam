# CR-009 · Update recorder boxes remotely — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [ ] Open questions answered *(defaults used: update whenever idle, per-box deploy key)*

## Build

### API (`back/`)

- [ ] Migration `020`: `devices.targetVersion`, `agentCommit`, `updateStatus`, `updateMessage`
- [ ] Heartbeat accepts `commit` and `update { status, message }`; replies with `update: { version }`
      while the box's target differs from what it runs
- [ ] `npm run boxes:update -- <name|id|--all> <version|--cancel>`; version checked against a safe
      git-ref pattern
- [ ] `npm run boxes` shows version, commit and update status
- [ ] Tests: heartbeat reply carries the target; cancel clears it; a bad ref is refused; a revoked
      box isn't targeted

### Recorder box (`edge/`)

- [ ] Report the running commit and the last update result in each heartbeat
- [ ] On a target version: wait until idle (no game recording, no jobs, no uploads pending)
- [ ] `scripts/self-update.sh`, run detached from a copy outside the checkout: fetch → checkout →
      `npm ci --omit=dev` → `pm2 restart` → wait for a fresh heartbeat → roll back on failure;
      result written to `DATA_DIR/update.json`
- [ ] Refuse cleanly when the box isn't a git checkout or the ref doesn't exist
- [ ] Unit tests for the idle check and ref validation; `npm run lint && npm test`

### Docs

- [ ] `edge/README.md`: deploy key, how updates and rollback work; `back/` boxes commands

## Acceptance

- [ ] `boxes:update -- --all <tag>` → idle boxes on the tag within minutes
- [ ] A recording box waits for its game to end and its video to send
- [ ] A crashing version rolls back within ~3 min, reported as failed
- [ ] `--cancel` stops an update that hasn't started

## Wrap-up

- [ ] `cd back && npm run lint && npm test` passes
- [ ] `cd edge && npm run lint && npm test` passes
- [ ] Migration applied, or noted as pending for deploy
- [ ] Changelog entry added (`ref: CR-009`)
- [ ] Requester shown the result and signed off
- [ ] `request.md` status set to `Done`
