# BUG-002 · Recorder box keeps a locked camera locked

> **Status:** Fixing · **Severity:** High · **Reported:** 2026-11-18 · **Reported by:** bryanken00
> **Fix checklist:** [fix.md](fix.md)

## Summary

A Tapo camera locks itself after too many failed sign-ins and then refuses everyone, even with the
right password. The recorder box keeps reconnecting every 2–30 seconds, and every attempt counts
as another sign-in, so the lock never wears off and the court stops recording. The court page only
says "Recorder stopped: Error opening input files: Server returned 400 Bad Request", which
doesn't tell staff what to do.

## Where

- **Page / screen / endpoint:** Admin → Setup → venue → court → Camera live check (the box's
  heartbeat message); the box itself (`edge/src/recorder.js`)
- **Account / role:** any staff
- **Environment:** local (developer's Mac as the box), 2026-11-18, twice (≈10:20 and ≈11:00)
- **Recorder box (edge only):** venue DGSI · agent 1.0.0 · Court 1, camera 1 (Tapo C200 at
  192.168.254.148)

## Steps to reproduce

1. Have the box record a court whose camera address has a wrong or missing username/password
   (on 2026-11-17 Court 2 had the camera's address with no account), or restart the box very
   often.
2. Within minutes the camera answers every RTSP request with `RTSP/1.0 400 Server is locked`
   (seen with a raw `OPTIONS` request); ffmpeg reports `Server returned 400 Bad Request`.
3. Fix the address. The camera stays locked: the box keeps trying every ≤ 30 s.

## Expected

- A wrong password is retried slowly enough that it can't lock the camera.
- A locked camera is left alone long enough for the lock to clear, and the court page says the
  camera locked itself and how to recover (restart it).

## Actual

- `CourtRecorder.onExit` restarts after `backoffMs(failures, 2 s, 30 s)` whatever the reason, so
  a 401 (wrong password) or a 400 (locked) is retried at most every 30 s, indefinitely.
- `describeFailure` knows 401 / 404 / timeouts but not 400, so staff see the raw ffmpeg line.

## Root cause

- [edge/src/recorder.js](../../../edge/src/recorder.js) `onExit`: one restart policy for every
  failure (`RESTART_MAX_MS = 30_000`). A rejected sign-in is a failure that a quick retry can't
  fix but can make worse: each retry is another failed sign-in, which is how the camera got
  locked, and a locked camera counts every retry, so it never unlocks. Confirmed on 2026-11-18:
  the camera answered `400 Server is locked` to the correct password while the box was retrying,
  and answered `200 OK` with video right after the camera was restarted and before the box
  reconnected.
- [edge/src/recorder.js](../../../edge/src/recorder.js) `describeFailure`: no case for
  `400` / `Server is locked`.

## Resolution

The recorder now tells a refused sign-in from a drop-out (`failureKind`) and waits accordingly
(`restartDelayMs`): a wrong password is retried after 2 → 5 → 10 → 15 min and a locked camera
after 5 → 10 → 15 min, instead of every ≤ 30 s; Wi-Fi drop-outs still reconnect within 30 s,
and a changed camera address still restarts at once. The court page now says "The camera is
locked … Restart the camera …" and when the box tries again.
