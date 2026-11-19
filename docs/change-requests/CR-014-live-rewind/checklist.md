# CR-014 · Rewind the live view — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)

## Build

### Recorder box (`edge/`)

- [x] `LIVE_DVR_SECONDS` (default 60, below `BUFFER_SECONDS`): the live playlist lists that much
- [x] Tests: the playlist window follows the setting; restreams still start near live
- [x] README + edge skill

### App (`app/`)

- [x] Live view: ⟲ 10 s (up to ~50 s back), Live →, "N s behind" / LIVE mark; back to live on a
      camera switch or a renewed link

## Acceptance

- [ ] ⟲ 10 s replays; again goes further (on a device, updated box)
- [ ] Live → returns to live
- [ ] An old box still plays live

## Wrap-up

- [x] `cd edge && npm run lint && npm test` passes (258/258); `npm run smoke` OK (live view lists the
      longer window, ffprobe plays it; restreams still go live)
- [x] `cd app && npx expo export --platform android --clear` bundles
- [x] Changelog entry added (`ref: CR-014`)
- [ ] Requester shown the result and signed off
- [ ] `request.md` status set to `Done`
