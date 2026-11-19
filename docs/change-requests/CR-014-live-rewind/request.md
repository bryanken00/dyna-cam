# CR-014 · Rewind the live view on the courtside device

> **Status:** In progress · **Requested:** 2026-11-19 · **Requested by:** bryanken00 · **Size:** M
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** PLAN-002 §5.4 (live view), CR-007 (Cam 1 / Cam 2 switch), CR-013 (saves)

## Requested change

Video controls on the live view of the courtside device: "<- 10secs    live ->". Go back 10
seconds to see a point again, and jump back to live.

## Today

The device plays the court live from the venue's recorder box. The box's live stream only lists
its newest 5 segments (about 10 seconds), so there is nothing to go back to, and the device has
no controls apart from the sound.

## Why

Players want to see the last point again right away, at the bench, without saving anything.

## Scope

**In**

- Under the live video: **⟲ 10 s** (tap again for 20, 30 … up to about 50 seconds back) and
  **Live →** to return to live. While behind, it says how far ("20 s behind"); at live, a red
  LIVE mark.
- Switching Cam 1 / Cam 2 or the live link being renewed returns to live.
- The recorder box keeps the last minute in its live stream (`LIVE_DVR_SECONDS`, default 60), from
  the footage it already keeps; nothing more is stored.

**Out**

- Rewinding further than about a minute (that's what saves are for, CR-013).
- Slow motion, or rewinding the player's own Facebook / YouTube stream.

## Acceptance criteria

- On the device, ⟲ 10 s replays the last 10 seconds; tapping it again goes further back.
- Live → returns to live, and the LIVE mark comes back.
- A box not yet updated still plays live; rewinding only goes back a few seconds there.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Courtside app: the live view on the game screen. |
| Data | None. |
| Build / rollout | **Recorder box update** (the minute of live history). App: JavaScript only (next app update). No API change. Old boxes keep working with ~10 s of history. |
| Permissions | None. |
| Existing users | The live view gains controls; it still opens at live. |
| Size | M: the box's live playlist window and its tests, the app's controls. |

## Open questions

- [ ] One minute of rewind enough, or longer (up to the box's `BUFFER_SECONDS`)?

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-19 | Asked directly |
