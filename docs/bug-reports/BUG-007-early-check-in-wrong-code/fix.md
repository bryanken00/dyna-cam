# BUG-007 · Checking in a few minutes early says the booking code is wrong — Fix checklist

> Bug: [bug.md](bug.md)

## Confirm

- [x] Reproduced with the steps in bug.md (dev data: X2B4MW, attempt at 09:49, window opens 09:50)
- [x] Root cause confirmed (not a hypothesis) and written in bug.md

## Fix

- [x] When no booking matches in the window, look the code up again at the same venue (any time,
      any status) and say what's wrong: too early (check in from …, today or on its day), already
      ended, cancelled, released unpaid, or another court's code (scan that court's sign). A code
      that matches nothing keeps the one wrong-code 404
- [x] Tests in `booking-check-in.test.js`: too early, another day, ended, cancelled, another court,
      wrong code

## Check nothing else broke

- [x] Searched for the same pattern elsewhere (check-in from the booking's own page uses the
      booking link, not a code — its messages already say why)
- [x] A code from another venue still gets the plain wrong-code message (nothing about it is told)

## Wrap-up

- [x] `cd back && npm run lint` passes, `npm test` passes
- [x] The steps in bug.md no longer reproduce
- [x] Changelog: court booking (PLAN-003) is unreleased, so its entry gets a BUG-007 note instead of a `fixed` entry
- [x] `bug.md` status set to `Fixed`, Resolution filled
