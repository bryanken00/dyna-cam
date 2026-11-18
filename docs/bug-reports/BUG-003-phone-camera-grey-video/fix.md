# BUG-003 · Phone camera: whole-game video is grey, live streams have no picture — Fix checklist

> Bug: [bug.md](bug.md)

## Confirm

- [x] Reproduced with the steps in bug.md (session 4:07–4:14 PM, Court 1)
- [x] Root cause confirmed (not a hypothesis) and written in bug.md

## Fix

- [x] `edge/src/ffmpeg.js`: one shared `H264_COPY_CLEANUP` (`-bsf:v filter_units=remove_types=0`)
- [x] `edge/src/game.js` `buildGameCopyArgs`: use it on the video copy
- [x] `edge/src/restream.js` CAM1/CAM2 copy: use it
- [x] Tests: game copy args and restream args carry the filter

## Check nothing else broke

- [x] Searched for every `-c:v copy` (recorder: RTSP → TS keeps Annex B, unaffected)
- [x] `npm run smoke` passes (game file, restreams)
- [x] The phone camera's copied segment decodes with 0 errors through the new arguments

## Wrap-up

- [x] `cd edge && npm run lint && npm test` passes
- [x] A new game with the phone camera plays with picture on the player's page (bryanken00, 2026-11-18)
- [x] Changelog: unreleased CR-006 and live-streaming entries got a Dev note
- [x] `bug.md` status set to `Fixed`, Resolution filled
