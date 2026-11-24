# BUG-007 · Checking in a few minutes early says the booking code is wrong

> **Status:** Fixed · **Severity:** Medium · **Reported:** 2026-11-24 · **Reported by:** bryanken00
> **Fix checklist:** [fix.md](fix.md)

## Summary

A player who enters their real booking code on the court's QR page before check-in opens is told
"That code doesn't match a booking on this court right now — check the code on your booking
page", as if they had typed it wrong. Nothing tells them to wait until check-in opens.

## Where

- **Page / screen / endpoint:** court QR page `/court/:qrToken` → `POST /api/v1/public/courts/:qrToken/check-in`
- **Account / role:** player (no login)
- **Environment:** local (dev), desktop browser

## Steps to reproduce

1. Book Court 1 at BigPickle for 10:00–11:00 AM (booking X2B4MW, paid online). Its page says
   "scan the QR sign on Court 1 from 9:50 AM".
2. At 9:49 AM, open Court 1's QR page and enter X2B4MW.
3. Tap Check in and start.

## Expected

The page says the code is right but it's too early: check in from 9:50 AM.

## Actual

"That code doesn't match a booking on this court right now — check the code on your booking page"
(404). The same message is given for a code that's on another day, already over, cancelled, or for
another court.

## Root cause

[public.controller.js `POST /courts/:qrToken/check-in`](../../../back/server/src/controllers/v1/public/public.controller.js)
looks the code up only **inside** the check-in window
(`b.startAt <= now + checkInEarlyMinutes AND b.endAt > now`, statuses Confirmed / CheckedIn /
Pending). Any booking outside that window, or cancelled / expired, or on another court, finds no
row, and every "no row" gets the one wrong-code message. Confirmed against the dev data: X2B4MW
is Confirmed, Paid, 10:00–11:00 on Court 1, `checkInEarlyMinutes = 10`; the attempt was at
09:49 Manila time, one minute before the window opens.

## Resolution

When the code finds no booking in the check-in window, the court QR now looks it up again at the
same venue and says what's wrong (409): "Too early — your booking is 10:00 AM – 11:00 AM. Check in
from 9:50 AM.", the booking's day when it's another day, "is over", "was cancelled", "wasn't paid in
time", or "This code is for Court 2 — scan the QR sign on Court 2." A code that matches nothing at
the venue (or is another venue's) still gets the one wrong-code 404. Tests in
`back/tests/booking-check-in.test.js`.
