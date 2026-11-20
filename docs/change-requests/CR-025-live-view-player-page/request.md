# CR-025 · Live view and Save the last … on the player's game page

> **Status:** Done · **Requested:** 2026-11-20 · **Requested by:** bryanken00 · **Size:** M
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [PLAN-002](../../plans/PLAN-002-setup-menu-device-pairing/plan.md) (session device, live view), [CR-007](../CR-007-device-live-cam-switch/request.md) (Cam 1 / Cam 2), [CR-013](../CR-013-save-last-minutes/request.md) (Save the last …), [CR-014](../CR-014-live-rewind/request.md) (⟲ 10 s), [CR-015](../CR-015-pay-before-download/request.md) (pay before download)

## Requested change

> Possible to add live view here? Like what's on the app? Add control also.

While a game is recording, the player's game page (the link from the game's QR) shows the court's
live video and the court device's controls, so a player can watch and save from their own phone.

## Today

- While recording, the game page says "Recording now — your whole game appears here as one video
  when it ends." There is nothing to watch or press.
- The live video, its controls (Cam 1 / Cam 2, sound, ⟲ 10 s, Back to live) and "Save the last …"
  are only on the court device that staff paired to the game.

## Why

Players can follow the game and save a good rally from their own phone, not only from the court
device.

## How it would work

| | Today | Requested |
| --- | --- | --- |
| Game page while recording | "Recording now" notice | Notice + **live video** of the court |
| Live controls | Court device only | Also on the page: **Cam 1 / Cam 2** (two-camera courts), **sound on/off**, **⟲ 10 s** (up to about 50 s back), **Back to live** |
| Save the last … | Court device only | Also on the page: pick 1 min and up in 15 s steps, **Save**. Uses the same per-game save limit; the save shows under "Your saves" |
| End game | Court device, Admin | **Unchanged.** Not on the page, since anyone with the shared link could stop the game |
| Off the venue Wi-Fi | — | The page says "Live view needs the venue Wi-Fi". Recording isn't affected; Save still works |
| Unpaid game (CR-015) | Pay code, videos locked | Live view and Save work during the game; the finished videos stay locked until paid |

## Scope

**In**

- Live video on the game page while recording, from the venue's recorder box (same signed,
  15-minute link as the court device).
- Viewing controls: camera switch, sound, ⟲ 10 s / Back to live.
- "Save the last …" on the page, under the same limits as the court device.

**Out**

- End game from the page (decided: stays on the court device and Admin).
- Deleting a save from the page (the court device can).
- Stream to Facebook / YouTube from the page.
- Live view over the internet (only on the venue Wi-Fi, like the court device).

## Acceptance criteria

- On the venue Wi-Fi, a recording game's page plays the court's live video.
- A two-camera court shows Cam 1 / Cam 2 and switching changes the video.
- Sound is off at first and can be turned on; ⟲ 10 s goes back, Back to live returns.
- Off the venue Wi-Fi, the page says the live view needs the venue Wi-Fi and the rest of the page
  works.
- After the first minute, "Save the last …" makes a save that appears under "Your saves" and
  counts toward the game's save limit; at the limit it says so.
- There is no End game on the page.
- An unpaid game's page shows the live video and Save; its videos stay locked.
- When the game ends, the live video and Save go away and the page shows saving progress as now.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Web: the player's game page (`/session/:shareToken`). |
| Data | None. A save from the page has no paired device (`pairedAppId` NULL, already allowed). |
| API | `GET /public/sessions/:shareToken` adds `live` (the same signed LAN HLS link as `/app/session`) and `capture` (limits, played seconds). New `POST /public/sessions/:shareToken/captures` (rate-limited per IP, `RATE_LIMIT_PUBLIC_CAPTURE_POINTS`, default 10/min; same rules as the device's save; answers no IDs). ⚠️ The live link's path carries the court's ID (`/live/<courtId>/…`) because that is where the box serves it — an accepted exception to "no business IDs on public routes": the link is signed, expires in 15 minutes and only works on the venue Wi-Fi. |
| Build / rollout | Server + web deploy. Web gains `hls.js`, loaded only when the browser can't play HLS itself (Safari / iOS can). If the page is served over HTTPS, the box needs its certificate (`CERT_PATH`, `LIVE_HOST` = a name it covers) or the browser blocks the plain-HTTP live video. No app or recorder box update. |
| Permissions | None. The game's share link is the credential, as for the rest of the page. |
| Existing users | Nothing is taken away. Anyone holding a game's link can now add saves to it (up to its limit). Release impact `minor`. |
| Size | M: public endpoint + save route, live player with hls.js, save control, tests. |

## Open questions

- [x] **Which controls:** viewing controls + Save the last … (bryanken00, 2026-11-20)
- [x] **End game on the page:** leave it off (bryanken00, 2026-11-20)
- [x] **Off the venue Wi-Fi:** venue Wi-Fi only, no relay (bryanken00, 2026-11-20)
- [x] **Unpaid games:** show live and Save while unpaid; videos stay locked (bryanken00,
      2026-11-20)

## Design notes (as built)

- API (`controllers/v1/public/public.controller.js`): the game page's answer gains `live` (from
  `utils/sessionDevices.js` `liveLink`, null unless recording) and `capture` (`minSeconds`,
  `available`, `maxPerGame`, `used`, `playedSeconds`). The save calls the device's
  `createCapture` with no paired device, so the refusals (`TOO_EARLY`, `TOO_MANY`,
  `NOT_RECORDING`) and the double-tap rule are the same.
- Web (`pages/Public/Session/components/`): `LivePanel` (the link kept stable across the 10 s
  polls, renewed 2 minutes before it expires; native HLS or hls.js; Cam 1 / Cam 2, sound,
  ⟲ 10 s up to 50 s, Back to live; "Live view needs the venue Wi-Fi" when it can't play) and
  `SaveLastMinutes` (−/+ 15 s, a slider over the game so far, Save; played time ticks from the
  answer's `playedSeconds`). Shown while the game records, paid or not.

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-20 | Asked directly ("add live view here … add control also"); questions answered the same day |
| Signed off — Done | bryanken00 | 2026-11-20 | Marked done by the requester ("mark CR-025 done"); acceptance items ticked on that sign-off, not re-checked one by one |
