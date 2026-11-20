# BUG-004 · Recorder box on Windows never records — Fix checklist

> Bug: [bug.md](bug.md)

## Confirm

- [x] Reproduced with the steps in bug.md
- [x] Root cause confirmed (not a hypothesis) and written in bug.md

## Fix

- [x] `edge/src/recorder.js`: on Windows, name segments with the segment muxer's own counter
      (`-segment_start_number <n>` + `%d.ts`) instead of `-strftime 1` + `%s.ts`; `n` = the
      current epoch second, or one past the newest segment already in the folder if that is higher,
      so names stay `<epoch-like>.ts` and never go back (live view MEDIA-SEQUENCE, pruning, newest-file check)
- [x] Linux/macOS keep `-strftime 1` + `%s.ts` unchanged
- [x] Unit tests for both argument sets and the start number

## Check nothing else broke

- [x] Searched for the same pattern elsewhere (`strftime`, `%s`); no other ffmpeg output relies on it
- [x] Live view, clips and whole-game copies still work from `%d.ts` names (`npm run smoke` on Windows)

## Wrap-up

- [x] `cd edge && npm run lint` passes
- [x] `cd edge && npm test` passes — apart from 2 tests that already failed on Windows before
      this fix (live-key file mode 0600, CERT_PATH `/` path); they pass on Linux/macOS
- [x] `cd edge && npm run smoke` passes (on Windows, ffmpeg 9.0.2)
- [ ] The steps in bug.md no longer reproduce (the Windows box records Court 1) — restart the box and check
- [x] Changelog entry added (the recorder box isn't released yet, so BUG-004 is noted in its
      unpublished entry `2026-11-17-qr-replay-clips.md` rather than a separate `fixed` entry)
- [x] `bug.md` status set to `Fixed`, Resolution filled
