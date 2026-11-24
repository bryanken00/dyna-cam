# CR-032 · Booking page uses the full screen on desktop — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered

## Build

- [x] `PublicLayout` gains a `wide` prop (wider top bar, main and footer); default stays narrow
- [x] `CourtSlotPicker` gains a `columnsClassName` prop (default `grid-cols-3`)
- [x] Book page: two columns from `lg` — picker card left, sticky details card right; a "pick a
      time" card on the right before a slot is picked (wide screens only); phones unchanged
- [x] Revision: both columns stretch to the row's height; the right card grows to fill its column
      and its contents are sticky inside it

## Acceptance

- [x] Wide screen: picker left, details and form right
- [x] Picking a time shows it and its price at the top of the right side, form in view
- [x] Before picking, the right side says to pick a time
- [x] Both cards the same height, before and after picking
- [x] Phone width: unchanged single column

## Wrap-up

- [x] `cd front && npm run lint && npm run build` passes
- [x] Changelog entry added (`ref: CR-032`)
- [x] Requester shown the result and signed off
- [x] `request.md` status set to `Done`
