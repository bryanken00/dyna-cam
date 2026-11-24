# BUG-009 · Copy buttons inside a drawer or dialog copy nothing on the LAN address — Fix checklist

> Bug: [bug.md](bug.md)

## Confirm

- [x] Reproduced (headless browser, LAN address, focus-trapping dialog: old helper copied "")
- [x] Root cause confirmed (not a hypothesis) and written in bug.md

## Fix

- [x] `front/src/utils/clipboard.js`: fallback textarea inside the focused dialog; focus + select
      it; remove it and restore focus after

## Check nothing else broke

- [x] Searched for the same pattern elsewhere (other `execCommand` / textarea copies in
      `front/src`) — `copyText()` is the only one; all 13 callers go through it
- [x] Outside a dialog the textarea still goes on `<body>` (same as before)

## Wrap-up

- [x] `cd front && npm run lint && npm run build` passes
- [x] The steps no longer reproduce in the headless check (fixed helper copies the full text)
- [x] Reporter confirms in the real Admin
- [x] Changelog: unreleased features (court booking entry) get a BUG-009 note
- [x] `bug.md` status set to `Fixed`, Resolution filled
