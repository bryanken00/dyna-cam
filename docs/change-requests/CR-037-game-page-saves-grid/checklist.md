# CR-037 · Game page: "Your saves" as a grid under the video on desktop — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered

## Build

- [x] `pages/Public/Session/index.jsx`: on wide screens the saves block sits in the left column,
      a two-per-row grid with a count in its heading; phones keep the list

## Acceptance

- [x] Computer: saves under the video, two per row; right column = controls
- [x] Phone: unchanged

## Wrap-up

- [x] `cd front && npm run lint && npm run build` passes
- [x] Changelog entry added (`ref: CR-037`)
- [x] Requester shown the result and signed off
- [x] `request.md` status set to `Done`
