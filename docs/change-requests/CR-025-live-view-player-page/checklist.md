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

- [x] On the venue Wi-Fi, a recording game's page plays the court's live video
- [x] Two-camera court: Cam 1 / Cam 2 switch
- [x] Sound off at first, toggle; ⟲ 10 s and Back to live
- [x] Off the venue Wi-Fi: notice, rest of the page works
- [x] Save the last … appears under Your saves, counts toward the limit
- [x] No End game on the page
- [x] Unpaid game: live + Save, videos locked
- [x] Game ends: live and Save go, saving progress shows

## Wrap-up

- [x] `cd back && npm run lint && npm test` passes
- [x] `cd front && npm run lint && npm run build` passes
- [x] Changelog entry added (`ref: CR-025`)
- [x] Requester shown the result and signed off
- [x] `request.md` status set to `Done`
