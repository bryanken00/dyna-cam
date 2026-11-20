# CR-025 · Live view and Save the last … on the player's game page — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered

## Build

- [x] API: `GET /public/sessions/:shareToken` returns `live` (while recording) and `capture`
- [x] API: `POST /public/sessions/:shareToken/captures` — rate-limited, same refusals as the device
- [x] Tests: live link only while recording; save from the page; limit; ended game refused; bad
      token 404
- [x] Web: `hls.js`; live panel (camera switch, sound, ⟲ 10 s, Back to live, Wi-Fi notice) with a
      source kept stable across polls
- [x] Web: "Save the last …" control on the page; Recording notice updated

## Acceptance

- [ ] On the venue Wi-Fi, a recording game's page plays the court's live video
- [ ] Two-camera court: Cam 1 / Cam 2 switch
- [ ] Sound off at first, toggle; ⟲ 10 s and Back to live
- [ ] Off the venue Wi-Fi: notice, rest of the page works
- [ ] Save the last … appears under Your saves, counts toward the limit
- [ ] No End game on the page
- [ ] Unpaid game: live + Save, videos locked
- [ ] Game ends: live and Save go, saving progress shows

## Wrap-up

- [x] `cd back && npm run lint && npm test` passes
- [x] `cd front && npm run lint && npm run build` passes
- [x] Changelog entry added (`ref: CR-025`)
- [ ] Requester shown the result and signed off
- [ ] `request.md` status set to `Done`
