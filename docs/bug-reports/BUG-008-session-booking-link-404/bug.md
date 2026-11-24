# BUG-008 · A game's "Started by Booking …" link opens Page not found

> **Status:** Fixed · **Severity:** Low · **Reported:** 2026-11-24 · **Reported by:** bryanken00
> **Fix checklist:** [fix.md](fix.md)

## Summary

In Admin → Sessions, a game started from a booking shows "Started by Booking X2B4MW" as a link.
Clicking it opens the Admin's "Page not found" instead of that booking.

## Where

- **Page / screen / endpoint:** Admin → DGSports → Sessions, Player column → the booking link
- **Account / role:** System Owner (any role with Bookings read)
- **Environment:** local (dev), desktop browser

## Steps to reproduce

1. Check a booking in so its game starts (booking X2B4MW).
2. Open Admin → Sessions; the game's Player column says "Started by Booking X2B4MW".
3. Click "Booking X2B4MW".

## Expected

Admin → Bookings opens with that booking's detail.

## Actual

`/admin/bookings?booking=…` — "404 · Page not found".

## Root cause

[`front/src/utils/dynaCam.js`](../../../front/src/utils/dynaCam.js) `BOOKINGS_PATH` is
`/admin/bookings`, but the Bookings page is a child of the sidebar's `dyna-cam` group, and
[`AdminRoute.jsx`](../../../front/src/routes/pageRoutes/AdminRoute.jsx) mounts every child at
`/admin/${page.key}${child.route}` — so the page lives at `/admin/dyna-cam/bookings`. `bookingPath()`
(used by the Sessions link) built a URL with no route. The other hard-coded Admin paths
(`/admin/dyna-cam/sessions`, `/admin/setup/…`) already match their routes.

## Resolution

`BOOKINGS_PATH` is now `/admin/dyna-cam/bookings`, so `bookingPath(id)` opens Bookings with
`?booking=<id>`, which the page already reads to open that booking's detail.
