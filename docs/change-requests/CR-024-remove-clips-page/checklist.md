# CR-024 · Remove the Clips page — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered

## Build

- [x] `AdminRoute.jsx`: Clips nav item + route removed; `/admin/dyna-cam/clips` → Sessions
- [x] `pages/Admin/DynaCam/Clips` deleted; `useGetClips` / `getClipsApi` / `getClipByIdApi`
      removed (`useGetClipOptions` stays — Sessions uses it); unused `CLIP_DRIVE_LABEL` /
      `CLIP_SOURCE_LABEL` removed from `utils/dynaCam.js`
- [x] `cd front && npm run lint && npm run build`

## Acceptance

- [x] Dyna Cam shows Sessions and Payments only
- [x] The old Clips address opens Sessions
- [x] Replays and their payments still work

## Wrap-up

- [x] Changelog entry added (`ref: CR-024`)
- [x] Requester shown the result and signed off (bryanken00, 2026-11-20)
- [x] `request.md` status set to `Done`
