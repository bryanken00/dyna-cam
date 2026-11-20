# BUG-004 · Recorder box on Windows never records

> **Status:** Fixed · **Severity:** High · **Reported:** 2026-11-20 · **Reported by:** —
> **Fix checklist:** [fix.md](fix.md)

## Summary

A recorder box running on Windows never writes any video. Every court shows "Can't reach" with
"Recorder stopped: …", even though the camera plays fine in VLC and the same box works on a Mac.

## Where

- **Page / screen / endpoint:** Admin → Venues → DGSI → Court 1 → Camera → Live check
- **Account / role:** —
- **Environment:** local · recorder box on Windows 10 Pro, ffmpeg 9.0.2 (gyan.dev full build)
- **Recorder box (edge only):** DGSI · agent from `main` @ bcbfd45 · Court 1, Tapo `rtsp://…@192.168.254.5:554/stream1`

## Steps to reproduce

1. Run the recorder box (`cd edge && npm start`) on Windows with a court whose camera works in VLC.
2. Open the court's setup page in Admin.

## Expected

The box records the camera into its rolling buffer and the Live check goes green.

## Actual

ffmpeg exits right after connecting and the box restarts it forever. Nothing is written to
`data/buffer/<courtId>/` except `run.json`. Run by hand, the box's command prints:

```
[segment] [error] Failed to open segment ''
[out#0/segment] [error] Could not write header (incorrect codec parameters ?): Invalid argument
```

(The "Operation not permitted" shown on the setup page at first was a separate, temporary cause:
the Tapo drops a new viewer at PLAY when too many already watch `stream1`. It cleared up once
the other viewers let go.)

## Root cause

The recorder names each segment with `-strftime 1` and the pattern `%s.ts`, "epoch seconds"
([recorder.js:103-105](../../../edge/src/recorder.js#L103-L105)). `%s` is a glibc/BSD
extension; Windows' C runtime `strftime` doesn't support it and returns an empty string, so
ffmpeg tries to open a segment named `''` and fails. Confirmed on this box: the same command
with `%Y%m%d%H%M%S.ts` writes segments, while `%s.ts` fails every time. On macOS/Linux `%s` works,
which is why the Mac box records.

## Resolution

On Windows the recorder names segments with the segment muxer's counter
(`-segment_start_number <n>` + `%d.ts`) instead of `-strftime 1` + `%s.ts`
([recorder.js](../../../edge/src/recorder.js) `STRFTIME_EPOCH`, `nextSegmentNumber`,
`CourtRecorder.startNumber`). `n` is the current epoch second, or one past the newest segment in
the folder, so names keep the `<epoch-like>.ts` shape and never go back (live view
MEDIA-SEQUENCE, pruning, newest-file check). Timing still comes from `segments.csv`. Linux and
macOS keep `%s`. `npm run smoke` passes on Windows, including a recorder restart.
