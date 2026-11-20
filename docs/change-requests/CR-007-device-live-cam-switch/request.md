# CR-007 · Session device: Cam 1 / Cam 2 switch on the live view

> **Status:** Done · **Requested:** 2026-11-18 · **Requested by:** bryanken00 · **Size:** S
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [PLAN-002](../../plans/PLAN-002-setup-menu-device-pairing/plan.md) (session device live view; "stays Cam 1"), two cameras per court (PLAN-002 §7)

## Requested change

> on app no preview for other cam

On a court with two cameras, the session device (the paired phone or tablet) can show either
camera's live video, with a **Cam 1 | Cam 2** switch above it. One video plays at a time.

## Today

The session device's live view always shows Cam 1. Cam 2 is recorded (its own whole-game video
since CR-003/CR-006) but players at the court can't see it live.

## Why

With two cameras, players want to check the second angle while they play, the same way they can
check the first.

## Scope

**In**

- The live view on the session device: a Cam 1 | Cam 2 switch on two-camera courts, starting on
  Cam 1. Switching changes the video within a few seconds.
- If the chosen camera has no live video (camera offline), the panel says which camera, and the
  switch stays so the other can be chosen.
- One-camera courts look exactly as today (no switch).

**Out**

- Both cameras at once (decided: one at a time — lighter on the device and the venue Wi-Fi).
- The player's own Facebook/YouTube stream and the venue's court stream (they already have
  Cam 1 / Cam 2 / Both).
- The web Admin.

## Acceptance criteria

- On a two-camera court, the session device shows Cam 1 live with a Cam 1 | Cam 2 switch above it.
- Tapping Cam 2 shows Cam 2's live video; tapping Cam 1 goes back.
- With Cam 2 unplugged, choosing Cam 2 says Cam 2 has no live video; Cam 1 still works.
- On a one-camera court nothing changes: no switch.
- Recording is never affected by switching.

## Impact

| Area | Detail |
| --- | --- |
| Screens | App → Session screen (live panel). |
| Data | None. The API's `live` answer gains `cameras: [{ camera, hlsUrl }]` on two-camera courts; `hlsUrl` stays Cam 1 so installed apps keep working. |
| Build / rollout | API update; app is JavaScript only (over-the-air update, no store build, no new permission). **No recorder box update:** the box already serves Cam 2 at `/live/<court>/cam2/…` with the same signature. |
| Permissions | None. |
| Existing users | One-camera courts unchanged; two-camera courts gain the switch. Not breaking. |
| Size | S: one API field + test, one app component change. |

## Open questions

- [x] One video with a switch, or both at once? — **Switch, one at a time** (bryanken00, 2026-11-18)

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-18 | Chose "Cam 1 / Cam 2 switch" after reporting no preview for the other cam |
| Signed off — Done | bryanken00 | 2026-11-20 | Bulk sign-off by the requester ("check all CR and plan… mark all complete"); acceptance items ticked on that sign-off, not re-checked one by one |
