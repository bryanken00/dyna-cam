# BUG-008 · A game's "Started by Booking …" link opens Page not found — Fix checklist

> Bug: [bug.md](bug.md)

## Confirm

- [x] Reproduced with the steps in bug.md (reported with screenshots)
- [x] Root cause confirmed (not a hypothesis) and written in bug.md

## Fix

- [x] `front/src/utils/dynaCam.js`: `BOOKINGS_PATH` → `/admin/dyna-cam/bookings`

## Check nothing else broke

- [x] Searched for the same pattern elsewhere (every `"/admin/…"` / `` `/admin/…` `` path in
      `front/src` against `AdminRoute.jsx`'s routes) — only `BOOKINGS_PATH` was wrong
- [x] Access still holds: the link shows only with Bookings read, and the page is behind the same permission

## Wrap-up

- [x] `cd front && npm run lint && npm run build` passes
- [x] The steps in bug.md no longer reproduce (needs a signed-in browser — for the reporter)
- [x] Changelog: court booking (PLAN-003) is unreleased, so its entry gets a BUG-008 note
- [x] `bug.md` status set to `Fixed`, Resolution filled
