# CR-024 · Remove the Clips page from the Admin portal

> **Status:** Done · **Requested:** 2026-11-20 · **Requested by:** bryanken00 · **Size:** S
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [CR-019](../CR-019-sidebar-order/request.md) (sidebar), [CR-021](../CR-021-hide-settings/request.md)

## Requested change

> Remove this clips module. → Only the Clips page (bryanken00, 2026-11-20).

## Today

Dyna Cam → **Clips** lists the 60-second replays players saved (court QR / court button) and the
old 5-minute parts of earlier sessions, view only.

## Why

Staff work from Sessions and Payments; the Clips list (mostly old session parts) isn't needed.

## Scope

**In**

- Remove Dyna Cam → Clips from the sidebar and remove the page; its old address
  (`/admin/dyna-cam/clips`) opens Sessions instead.

**Out** — unchanged

- Players saving 60-second replays (court QR / button), the replay's own page, replay payments in
  Payments, the Dashboard's "Replays saved".
- The `clips` permission (Sessions uses it) and the API.

## Acceptance criteria

- The Dyna Cam group shows Sessions and Payments only.
- Opening the old Clips address lands on Sessions.
- Players can still save a replay and staff can still take its payment in Payments.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Web: sidebar, Clips page removed. |
| Data | None. |
| Build / rollout | Web deploy only. |
| Permissions | None — `clips` stays (it gates Sessions). |
| Existing users | Clips is gone from the menu. Release impact `patch`. |
| Size | S. |

## Open questions

- [x] Page only, or the whole replay feature? → **Page only** (bryanken00, 2026-11-20)

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-20 | Asked directly; page only |
| Signed off — Done | bryanken00 | 2026-11-20 | Tried in the running app and accepted |
