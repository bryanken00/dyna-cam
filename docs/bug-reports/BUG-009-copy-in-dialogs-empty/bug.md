# BUG-009 · Copy buttons inside a drawer or dialog copy nothing on the LAN address

> **Status:** Fixed · **Severity:** Medium · **Reported:** 2026-11-24 · **Reported by:** bryanken00
> **Fix checklist:** [fix.md](fix.md)

## Summary

On the Admin opened at the LAN address (`http://192.168.254.121:4020`), **Copy the player's link**
in a booking's detail drawer copies nothing — the toast says it worked, the clipboard stays as it
was. Every copy button inside a drawer or dialog does the same there.

## Where

- **Page / screen / endpoint:** Admin → Bookings → a booking's detail → Copy the player's link
  (and any `copyText()` call from inside a drawer / dialog)
- **Account / role:** System Owner (any)
- **Environment:** local (dev) over plain http on a LAN IP — not a secure context

## Steps to reproduce

1. Open the Admin at `http://192.168.254.121:4020` (not localhost / https).
2. Bookings → open a booking → **Copy the player's link**.
3. Paste anywhere.

## Expected

The booking's link is pasted.

## Actual

The old clipboard contents are pasted (nothing was copied), though "Link copied" showed.

## Root cause

[`front/src/utils/clipboard.js`](../../../front/src/utils/clipboard.js) `copyText()`: off a
secure context (plain http on a LAN IP) the async Clipboard API isn't available, so it falls back
to a hidden textarea + `document.execCommand("copy")`. The textarea was appended to `<body>`, but
the booking drawer is a Radix dialog whose focus trap pulls focus back inside the dialog the
moment anything outside takes it — the textarea's selection is lost, `execCommand` copies an
empty selection and still returns `true`. Confirmed in a headless browser on the LAN address with
a focus-trapping dialog: the old helper copied `""`, the fixed one the full text.

## Resolution

The fallback textarea now goes inside the dialog that holds focus (or `<body>` when there's
none), takes focus and the selection there, copies, is removed, and focus returns to the button.
Fixes every `copyText()` caller (13 places), not just this button.
