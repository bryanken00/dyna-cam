# CR-028 · The courtside device's controls on the game page — Checklist

> Request: [request.md](request.md)

## Build

- [x] API: `POST /public/sessions/:shareToken/end` (End game, as the device's Stop)
- [x] API: `DELETE /public/sessions/:shareToken/captures/:number?savedAt=` (no IDs on public routes; `savedAt` guards against numbers shifting)
- [x] API: `POST /public/sessions/:shareToken/stream-link` and `POST …/stream/stop`; GET returns `stream` and `canStream`
- [x] API tests
- [x] Page: End game (confirm), delete on each save (confirm), stream block, save picker greyed in the first minute with a countdown

## Acceptance

Covered by `back/tests/game-page-controls.test.js` at the API level; still to be tried on the page.

- [ ] End game stops recording and shows saving
- [ ] Delete removes a save and frees a slot
- [ ] Stream setup opens; Change / Stop streaming work
- [ ] First minute: picker greyed with a countdown

## Wrap-up

- [x] `cd back && npm run lint && npm test` passes
- [x] `cd front && npm run lint && npm run build` passes
- [x] Changelog entry added (`ref: CR-028`)
- [ ] Requester shown the result and signed off
- [ ] `request.md` status set to `Done`
