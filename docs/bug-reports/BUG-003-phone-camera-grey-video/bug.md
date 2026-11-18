# BUG-003 · Phone camera: whole-game video is grey, live streams have no picture

> **Status:** Verified · **Severity:** High · **Reported:** 2026-11-18 · **Reported by:** bryanken00
> **Fix checklist:** [fix.md](fix.md)

## Summary

With an Android phone as the court camera (an "RTSP Camera" app, `rtsp://192.168.254.73:8554/`),
a game records and uploads, but its whole-game video shows no picture (grey) and won't decode.
The same footage copied to a Facebook/YouTube stream is broken the same way.

## Where

- **Page / screen / endpoint:** player's session page (`/session/:token`) → Whole game; Download
  whole game; court and player live streams (RTMP)
- **Account / role:** any player
- **Environment:** local · Chrome
- **Recorder box (edge only):** DGSI · Court 1 · camera = Android phone (RTSP server
  "pedroSG94 Server", H.264 High 1280×960 + AAC)

## Steps to reproduce

1. Set a court's camera address to an Android RTSP camera app's stream.
2. Pair a session device (the game starts), play past a few minutes, End game.
3. Open the player's page once it's Ready and play the video, or `ffmpeg -v error -i game-cam0-….mp4 -f null -`.

## Expected

The whole-game video plays with picture, like the camera's own stream.

## Actual

The page shows the right length (7:38, 129 MB) but a grey picture. ffmpeg:
`Invalid NAL unit size (0 > 70533)` / `missing picture in access unit` on every keyframe.
The box's recorded `.ts` segments decode with no errors.

## Root cause

The phone app sends a doubled start code (`00 00 00 01 00 00 00 01`) between SPS and PPS on every
keyframe, i.e. an **empty NAL unit**. MPEG-TS (the box's buffer, the live view) carries Annex B
and decoders skip it. When the box stream-copies into a length-prefixed container, the empty
unit becomes a **zero-length NAL**, which decoders reject, losing the whole keyframe packet:

- the whole-game file: `.ts` → MP4 copy in [game.js](../../../edge/src/game.js) (`buildGameCopyArgs`, CR-006)
- CAM1/CAM2 restreams: HLS → FLV copy in [restream.js](../../../edge/src/restream.js)

Confirmed on a segment from the box: TS 0 errors; copied to MP4 12 errors, to FLV 13 errors;
with `-bsf:v filter_units=remove_types=0` (drops the empty units, no re-encode) 0 errors and all
60 frames kept, for both.

60-second replays and stacked streams re-encode from the `.ts`, so they were never affected. The
Tapo camera doesn't send empty units.

## Resolution

Every H.264 stream copy out of the box's TS buffer into mp4/flv now runs
`-bsf:v filter_units=remove_types=0` (`H264_COPY_CLEANUP` in `edge/src/ffmpeg.js`), used by the
whole-game file (`game.js`) and Cam 1 / Cam 2 restreams (`restream.js`). It drops the empty units
without re-encoding; other cameras' streams pass unchanged. The phone's segment now copies with 0
decode errors; edge lint, 247 tests and the smoke run pass. Unreleased features, so their
changelog entries got a Dev note instead of a separate fix entry.
