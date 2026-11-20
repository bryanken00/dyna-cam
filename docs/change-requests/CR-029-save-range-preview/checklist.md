# CR-029 · Pick both ends of a save, and preview it — Checklist

> Request: [request.md](request.md)

## Build

- [x] API: a save takes `fromSeconds` + `toSeconds` (game offsets) as well as `seconds`; same limits, a minute at least, inside the game so far
- [x] Box: `GET /live/:courtId/[cam2/]replay.m3u8?from&to&exp&sig` — a VOD playlist of that stretch; the signature covers the stretch; its segments only inside it
- [x] API: `GET /public/sessions/:shareToken/preview?from&to` → signed replay links (per camera), only inside the game
- [x] Tests: API (range saves, preview link bounds) and box (route, signature, playlist)
- [x] Page: two-handle picker, end follows "now" until moved, Preview player, Save the range

## Acceptance

Covered by `back/tests/save-range-preview.test.js` and `edge/test/live.test.js`; still to be tried on the page with an updated box.

- [ ] Both handles move; at least a minute; times shown
- [ ] End at now keeps following the game
- [ ] Preview plays the stretch; Save saves it
- [ ] Old box: Preview says it needs an update; Save works

## Wrap-up

- [x] `cd back && npm run lint && npm test` passes
- [x] `cd edge && npm run lint && npm test` passes (268/270 — the 2 failures, live-key file mode and CERT_PATH, fail on this Windows machine without this change too)
- [x] `cd front && npm run lint && npm run build` passes
- [x] Changelog entry added (`ref: CR-029`)
- [ ] Requester shown the result and signed off
- [ ] `request.md` status set to `Done`
