# CR-007 · Session device: Cam 1 / Cam 2 switch on the live view — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered

## Build

- [x] API `utils/sessionDevices.js` `liveLink`: on a two-camera court add
      `cameras: [{ camera: 1, hlsUrl }, { camera: 2, hlsUrl: …/cam2/index.m3u8 }]`; `hlsUrl` stays Cam 1
- [x] API test: two-camera court gets both links (same signature, cam2 path); one-camera court has
      no `cameras`
- [x] App `LivePanel`: Cam 1 | Cam 2 switch when `live.cameras` has two; plays the chosen camera's
      link through `useLiveSource`; the offline message names the camera
- [x] App `services/api/session.js` doc comment updated

## Acceptance

- [ ] Two-camera court: Cam 1 live with a Cam 1 | Cam 2 switch
- [ ] Cam 2 shows Cam 2's live video; Cam 1 goes back
- [ ] Cam 2 offline: the panel says so; Cam 1 still works
- [ ] One-camera court: no switch
- [ ] Recording unaffected by switching

## Wrap-up

- [x] `cd back && npm run lint && npm test` passes (228/228; lint 0 errors, warnings are older files)
- [x] `cd app && npx expo export --platform android --clear` bundles; `expo-doctor`'s one failing check (SDK patch versions of 5 packages) fails the same without this change
- [x] Changelog entry added (`ref: CR-007`)
- [ ] Requester shown the result and signed off
- [ ] `request.md` status set to `Done`
