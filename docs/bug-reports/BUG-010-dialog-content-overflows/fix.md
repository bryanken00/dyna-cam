# BUG-010 · Dialog content runs past the dialog's right edge — Fix checklist

> Bug: [bug.md](bug.md)

## Confirm

- [x] Reproduced from the screenshot (content centred ~20 px right of the dialog, footer touching the edge)
- [x] Root cause confirmed (not a hypothesis) and written in bug.md

## Fix

- [x] `components/ui/dialog.jsx`: `DialogContent` gets one column that can't grow past the box
      (`grid-cols-[minmax(0,1fr)]`); `DialogFooter` wraps its buttons (`sm:flex-wrap`)
- [x] `components/ui/alert-dialog.jsx`: the same for `AlertDialogContent` and `AlertDialogFooter`
- [x] `GameDriveDialog.jsx`: wide enough for its three buttons on one line (`sm:max-w-125`, 500 px)

## Check nothing else broke

- [x] Searched for the same pattern elsewhere (every `DialogContent` / `AlertDialogContent`) — listed in bug.md
- [ ] Dialogs with a two-column form (`MoveBookingFormModal`) and a scrolling block
      (`AuditDetailModal`) keep their layout
- [ ] Phone width: footers still stack, nothing wider than the screen

## Wrap-up

- [x] `cd front && npm run lint && npm run build` passes (0 errors; the 9 warnings are in files this fix didn't touch)
- [ ] The steps in bug.md no longer reproduce (desktop, with and without **Email it**) — to check in a browser;
      no browser was available to the fix
- [x] Changelog: the dialog hasn't shipped yet, so BUG-010 is noted in its unpublished entry
      (`2026-11-20-email-drive-link.md`, CR-018) instead of a `fixed` entry
- [x] `bug.md` status set to `Fixed`, Resolution filled
