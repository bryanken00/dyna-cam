# CR-040 · Videos stay at the venue and go straight to Google Drive — Checklist

> Request: [request.md](request.md) · Build steps: [PLAN-005 checklist](../../plans/PLAN-005-videos-local-drive-only/checklist.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered

## Build

- [ ] Every item in the PLAN-005 checklist

## Acceptance

- [ ] No game video on the cloud server's disk; on the box and in Drive
- [ ] Game page: Drive links only, no player from our site
- [ ] Upload progress while sending; link + email when on Drive
- [ ] Internet cut and restored: videos still reach Drive
- [ ] Court without Drive: staff see why there's no video

## Wrap-up

- [ ] `cd back && npm run lint && npm test` passes
- [ ] `cd front && npm run lint && npm run build` passes
- [ ] `cd edge && npm run lint && npm test && npm run smoke` passes
- [ ] `cd app && npx expo-doctor@latest && npx expo export --platform android --clear` passes
- [ ] Migration applied, or noted as pending for deploy
- [ ] Changelog entry added (`ref: CR-040`)
- [ ] Requester shown the result and signed off
- [ ] `request.md` status set to `Done`
