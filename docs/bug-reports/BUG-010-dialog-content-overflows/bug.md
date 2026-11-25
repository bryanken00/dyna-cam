# BUG-010 · Dialog content runs past the dialog's right edge

> **Status:** Fixed · **Severity:** Low · **Reported:** 2026-11-25 · **Reported by:** bryanken00
> **Fix checklist:** [fix.md](fix.md)

## Summary

In Admin → Sessions, the **Game in Google Drive** dialog is drawn wider inside than the dialog
itself. The description, the notes and the button row run into the right edge, and the QR code
sits off-centre. Every button still works; it just looks broken.

## Where

- **Page / screen / endpoint:** Admin → Sessions → a finished game → **Game in Google Drive**
  (`front/src/pages/Admin/DynaCam/Sessions/components/GameDriveDialog.jsx`)
- **Account / role:** staff with Sessions write access (the **Email it** button only shows for
  them, on a game with a player email)
- **Environment:** any desktop browser at a width of 640 px or more. On phones the buttons stack,
  so it doesn't happen there.

## Steps to reproduce

1. As staff who can edit Sessions, open Admin → Sessions on a desktop browser.
2. Pick a finished game sent to Google Drive that has a player email.
3. Open **Game in Google Drive**.

## Expected

All content sits inside the dialog with even margins, the QR is centred, and the buttons fit or
wrap onto a second line.

## Actual

Screenshot 2026-11-25. The text lines and the **Email it · Copy link · Open in Google Drive** row
reach the dialog's right edge with no margin, and the content is centred about 20 px right of the
dialog's centre.

## Root cause

The shared dialog box is a CSS grid with **no column template**
([dialog.jsx:61](../../../front/src/components/ui/dialog.jsx#L61): `grid w-full … p-6 … sm:max-w-lg`).
Its one implicit column is `auto`, and grid items default to `min-width: auto`, so the column
grows to the **widest child's minimum width** even when that's wider than the box.

- **The footer is the widest child.** From 640 px up it's a flex row that never wraps
  ([dialog.jsx:98](../../../front/src/components/ui/dialog.jsx#L98): `flex flex-col-reverse gap-2
  sm:flex-row sm:justify-end`), and buttons don't wrap their labels.
- **This dialog has the widest footer.** With **Email it**, the three buttons need about 395 px.
  The dialog is `sm:max-w-105` (420 px), which leaves 372 px inside its padding
  ([GameDriveDialog.jsx:50](../../../front/src/pages/Admin/DynaCam/Sessions/components/GameDriveDialog.jsx#L50)).
- **Everything else follows.** The column becomes about 395–412 px, so every child (description,
  QR block, link, notes) is laid out that wide and spills past the right padding. The QR is
  centred in the wider column, not in the dialog.

The confirm dialog has the same layout
([alert-dialog.jsx:52](../../../front/src/components/ui/alert-dialog.jsx#L52) grid with no
column template; [alert-dialog.jsx:83](../../../front/src/components/ui/alert-dialog.jsx#L83)
footer with no wrap). It doesn't overflow today, but any long button label or unbreakable text
would.

**Other dialogs checked** (2026-11-25), every `DialogContent` / `AlertDialogContent` in
`front/src`. None overflows today: each has at most two footer buttons, and its long values
either wrap (`break-all` / `break-words`) or are cut short with `truncate`.
- `ConfirmDialog`, `PairingKeyDialog`, `AuditDetailModal`, `UserViewModal`
- Bookings: `CancelBookingFormModal`, `MoveBookingFormModal`
- Payments: `TakePaymentFormModal`
- Sessions: `AddTimeFormModal`, `GamePaymentFormModal`, `PairDeviceFormModal`, `SessionEmailFormModal`
- the component gallery

## Resolution

Fixed 2026-11-25, in three places:
- **Shared dialog and confirm dialog.** Both now give their one column a width it can't grow past
  (`grid-cols-[minmax(0,1fr)]`), so nothing inside can widen the box. From 640 px up, their footers
  wrap a button row that doesn't fit (`sm:flex-wrap`), instead of pushing the dialog wider.
- **Game in Google Drive.** The dialog is now 460 px wide (`sm:max-w-115`), so its three buttons
  stay on one line.

Every other dialog looks the same as before. Unreleased: the dialog's own changelog entry (CR-018)
carries the note.
