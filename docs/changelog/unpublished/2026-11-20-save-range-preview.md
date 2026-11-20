---
type: added
impact: minor
audience: user
ref: CR-029
---

On a game's page, saving a part of the game now has two handles: drag the start and the end
anywhere in the game so far (at least a minute), or nudge each end by 5 seconds. The end stays on
"now" and follows the game until you move it. **Preview** plays the picked stretch before you
save it, so you can check it's the right moment. Preview plays on the venue Wi-Fi, like the live
view.

## Dev notes

- edge/: **update every recorder box** for Preview — new signed replay playlist
  `GET /live/:courtId/[cam2/]replay.m3u8?from&to&exp&sig` (`live.js`). Old boxes keep recording and
  saving; only Preview says it can't play until the box is updated.
- back/: a save (`POST /public/sessions/:shareToken/captures`, and the app's) also takes
  `{ fromSeconds, toSeconds }` (seconds into the game; new refusal `BAD_RANGE`); new
  `GET /public/sessions/:shareToken/preview?from&to` signs a replay link for that stretch only
  (`utils/sessionDevices.js` `replayLink`, `signReplayLink`).
- front/: game page `SaveStretch` + `PreviewPlayer` replace `SaveLastMinutes`.
- No migration, no app build.
