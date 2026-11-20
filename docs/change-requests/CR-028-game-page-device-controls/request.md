# CR-028 · The courtside device's controls on the game page

> **Status:** In progress · **Requested:** 2026-11-20 · **Requested by:** bryanken00 · **Size:** M
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [CR-025](../CR-025-live-view-player-page/request.md) (live view and Save on the game page — this lifts its "no End game" rule), [CR-027](../CR-027-player-start-game-qr/request.md) (players start their own game), [CR-013](../CR-013-save-last-minutes/request.md) (saves), [PLAN-002](../../plans/PLAN-002-setup-menu-device-pairing/plan.md) Phase G (player's own stream)

## Requested change

> The clip control is missing like on the app. This must be like what the control app has.

With CR-027 a player starts the game from the court QR and has no courtside device, so the game's
page gets the device's controls:

- **End game** — stop recording early; the whole game so far is saved.
- **Delete a save** — each save under "Your saves" can be deleted, freeing one of the 5.
- **Stream to your Facebook / YouTube** — add, change or stop the player's own live stream.
- **Save the last …** shows from the start of the game: during the first minute it's there but
  disabled, with a countdown, instead of a single sentence.

## Today

The game page has the live view and Save the last … (CR-025). End game, deleting a save and the
player's own stream are only on the paired courtside device. During the first minute the save
card only says "You can save once the first minute has been played."

## Why

A player-started game (CR-027) has no paired device, so without these the player can't end early,
undo a save or stream.

## Scope

**In** — the four controls above on the game page, for any game while it records (delete also
after it ends, as on the device).

**Out** — Cam 1 / Cam 2 and ⟲ 10 s (already on the page, CR-025). Unpair (no device).

## Acceptance criteria

- While a game records, its page has an End game button; after confirming, recording stops and
  the page shows the game being saved.
- Each save under Your saves has a delete button; after confirming, it disappears and the count
  goes down.
- "Stream to your Facebook / YouTube" opens the stream setup page; with a stream set, the page
  shows it with Change stream and Stop streaming.
- In the first minute the Save card shows the picker greyed out with "Available in 0:42".

## Impact

| Area | Detail |
| --- | --- |
| Screens | Public game page (`/session/:shareToken`). |
| Data | None. |
| Build / rollout | Web and API only. |
| Permissions | None — the game's share link is the credential, so **anyone holding a game's link can end it, delete its saves and set its stream**. CR-025 kept End game off for that reason; the requester accepted it (asked directly, 2026-11-20). Writes are rate-limited per IP. |
| Existing users | Staff-made games: the link given to players now also ends the game. |
| Size | M — four public endpoints with tests, and the page. |

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-20 | Asked directly; chose all four controls knowing the link holder gets them |
