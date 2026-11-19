# CR-015 · Pay at the front desk before the game's videos open

> **Status:** In progress · **Requested:** 2026-11-19 · **Requested by:** bryanken00 · **Size:** L
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** CR-005 (open games), CR-006 (one file per game), CR-013 (saves), PLAN-001 Phase 4 (clip payments)

## Requested change

"Once the recording ended, the player must go to staff and pay. On the app it must show the code
to staff, to show the link where they can download the video."

The flow: go to staff → staff give the pairing key → start the game → … → end the game → go to
staff → staff open that game in Sessions and record the payment → the player can now see where to
download.

Decisions (2026-11-19):

- Staff **type the amount** when recording the payment (no set game price).
- Until the game is paid, the courtside device shows **no download QR** (during or after the
  game) and the player's page is **locked** (no videos, no downloads, just "pay at the front desk").
- Staff record the payment **on the game in Sessions**.
- The device's "Pair this device" screen gets **Find a game**: type the game's code; once it's
  paid the device shows that game's download QR, before that "Not paid yet — pay at the front desk".

## Today

- A game's download QR is on the courtside device from the start of the game, and on the Ended
  screen for 10 minutes after. Anyone with the link can watch and download every video at once.
- Games are free. Only single 60-second replays (court QR / button) can be priced — they show a
  pay code and staff take the cash on the Payments page.

## Why

The venue charges for the game's video. Today players can walk away with it without paying.

## Scope

**In**

- Every new game gets a short **game code** (e.g. `K7QM2P`) and starts **unpaid**.
- Courtside device: in place of the QR, the game code with "Pay at the front desk to get your
  videos" — during the game and on the Ended screen. Once staff record the payment the QR appears
  (the device checks every few seconds).
- Player's page (the link): while unpaid, the game, its status and pictures, the code and "Pay at
  the front desk" — no players, no downloads, no Google Drive link. It opens by itself once paid.
- Admin → Sessions: each game shows Unpaid (with its code) or Paid (amount); search by code; the
  game's detail has **Record payment** (amount + optional note) for staff with the Payments
  permission. The payment is listed on the Payments page with clip payments and counts in its
  totals; refunding it locks the game again.
- Device "Pair this device" screen: **Find a game** by code → the game (court, venue, time) and,
  once paid, its download QR; not paid → "Not paid yet — pay at the front desk"; no such code →
  says so.

**Out**

- Online payment (still cash at the desk).
- A fixed price per venue for games.
- Single replays (court QR / button) — unchanged, still priced by the venue's clip price.
- The device's own preview of saves (CR-013) still plays on the device.

## Acceptance criteria

- A new game: the courtside device shows the game code, not a QR, while the game runs and after
  End game.
- Opening the game's link before payment shows "Pay at the front desk" with the code, and no
  video can be played or downloaded.
- In Sessions, staff find the game (or search its code), tap Record payment, type the amount → the
  device shows the QR within a few seconds and the link plays and downloads.
- The payment shows on the Payments page; refunding it locks the game's page again.
- After the device unpairs, typing the code in Find a game on "Pair this device" shows the QR once
  paid, "Not paid yet" before.
- Games recorded before this change stay open (no payment needed).

## Impact

| Area | Detail |
| --- | --- |
| Screens | App: Session, Ended, Pair (+ Find a game). Web: player's game page; Admin Sessions list + detail; Payments list |
| Data | Migration `021`: `recording_sessions.paymentStatus` (Free/Unpaid/Paid) + `payCode`; `payments.sessionId`, `payments.clipId` nullable. Existing games → Free |
| Build / rollout | No new native module — an app update (JS) is enough. No recorder box change |
| Permissions | Recording a game payment uses the existing **Payments** permission (write); the button is hidden without it |
| Existing users | **Breaking:** every new game needs a payment at the desk before players get its videos. Staff must record it in Sessions |
| Size | L — API, migration, player page, Admin, and three app screens |

## Open questions

- [x] Price — staff type it (2026-11-19)
- [x] Lock — hide the QR and lock the page (2026-11-19)
- [x] Where staff record it — on the game in Sessions (2026-11-19)

## Revisions

- 2026-11-19: staff typed a game's code into **Payments → Take payment** and got "No clip has that
  pay code". Take payment now finds a game by its code too (court, time, status, payment) and asks
  for the amount; new codes never repeat between clips and games.
- 2026-11-19: the link under the download QR on the device opens the game's page when tapped.
- 2026-11-19: **Free game** option on New game — no code, the device shows the download QR and the
  player's page opens at once (the player doesn't go to the desk). Anyone who can create games can
  tick it.

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-19 | Asked directly; breaking change requested by the venue owner |
