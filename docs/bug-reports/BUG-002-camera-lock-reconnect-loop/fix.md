# BUG-002 · Recorder box keeps a locked camera locked — Fix checklist

> Bug: [bug.md](bug.md)

## Confirm

- [x] Reproduced with the steps in bug.md (2026-11-18: `400 Server is locked`, box retrying)
- [x] Root cause confirmed (not a hypothesis) and written in bug.md

## Fix

- [x] `edge/src/recorder.js`: `failureKind(line)` → `auth` (401) / `locked` (400 / "locked") /
      `notFound` / `unreachable` / `other`; `describeFailure` uses it and explains a locked camera
- [x] `edge/src/recorder.js`: `restartDelayMs(kind, attempt)` — `auth` 2 → 5 → 10 → 15 min,
      `locked` 5 → 10 → 15 min, everything else unchanged (2 s → 30 s); `onExit` uses it and says
      when it tries again
- [x] A changed camera address still restarts the recorder at once (unchanged `RecorderManager`
      behaviour), so fixing a password doesn't wait out the backoff
- [x] Tests: `failureKind`, `describeFailure` for 400 / locked, `restartDelayMs`, a recorder that
      exits with 400 waits minutes and reports the locked message
- [x] `edge/README.md` troubleshooting row for "camera locked"; edge-conventions skill: the
      backoff rule

## Check nothing else broke

- [x] Searched for other RTSP reconnect loops (`grep -n "backoffMs" edge/src`): restreams read the
      box's own live view (no camera sign-in), previews read segments — no camera connection
- [x] Wi-Fi drop-outs (timeouts, refused) still reconnect within 30 s

## Wrap-up

- [x] `cd edge && npm run lint && npm test` passes (236/236)
- [x] `npm run smoke` passes (SMOKE OK, 2026-11-18)
- [ ] The steps in bug.md no longer reproduce (real camera: box waits minutes after a 400)
- [x] Changelog: the recorder box is unreleased, so BUG-002 is a Dev note on its entry
      (`docs/changelog/unpublished/2026-11-17-qr-replay-clips.md`), not a `fixed` entry
- [ ] `bug.md` status set to `Fixed`, Resolution filled
