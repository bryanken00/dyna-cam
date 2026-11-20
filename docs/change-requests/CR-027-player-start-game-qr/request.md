# CR-027 · Players start their own game from the court QR

> **Status:** In progress · **Requested:** 2026-11-20 · **Requested by:** bryanken00 · **Size:** L
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [PLAN-001](../../plans/PLAN-001-court-replay-cameras/plan.md) (court QR sign, 60-second clips, court button), [PLAN-002](../../plans/PLAN-002-setup-menu-device-pairing/plan.md) (Setup → Court), [CR-016](../CR-016-game-time-limit/request.md) (game time), [CR-013](../CR-013-save-last-minutes/request.md) (saves per game), [CR-015](../CR-015-pay-before-download/request.md) (free games), [CR-025](../CR-025-live-view-player-page/request.md) (the game page)

## Revisions

- 2026-11-20 — First built as a **second**, separate Start-a-game QR beside the 60-second sign.
  After seeing it the requester asked: *"Can we completely remove this 60 secs? I want this like
  on session, it can capture the whole game — exactly what's on session."* Now the court's **one**
  QR sign starts a game, and the 60-second save is removed everywhere, including the court's Wi-Fi
  button. The separate Start-a-game QR is dropped (migration `029` removes its column).

## Requested change

> Player will start the game. So on Setup › Court, generate a QR code that will share the link of
> the website where they can start the game. The fields on that are almost the same as a session,
> but no payment and max clip. On the player's side the max clip is only 5.
>
> Can we completely remove this 60 secs? … Once they scan the QR, fill up like on the session
> form, then start.

The court's QR sign starts a game. A player scans it, fills in a short form (how long they'll
play, and optionally their name, phone and email) and taps **Start game**. The camera records the
whole game at once and the player lands on their game's page, with the live view, Save the
last …, and their videos when the game ends.

"Save the last 60 seconds" goes away completely: from the QR sign and from the court's Wi-Fi
button.

## Today

Only staff start a game: Admin → Sessions → New game (court, game time, name, phone, email,
Free game, Maximum saves). The court's QR sign, and its optional Wi-Fi button, save the last 60
seconds as a clip.

## Why

Courts are reserved and paid for outside the system, so the desk shouldn't have to make every
game by hand. The player who booked the court starts the recording themselves, and gets the whole
game rather than 60-second pieces.

## Scope

**In**

- The court's QR sign (Setup › Court → QR sign, Print sign, Copy player link — the same code
  already printed) opens the **Start a game** page: venue and court, game time (hours + minutes,
  with quick picks), name, phone, email, **Start game**.
- A game started there records right away, ends by itself at the end of the game time, is
  **free** (no pay code, videos open at once — the court was paid at reservation), and allows
  **5 saves**.
- If the court already has a game, the page says so (and until when) and doesn't start another.
- Admin → Sessions shows such a game as started by **Player (QR)**.
- Remove "Save the last 60 seconds": the QR page's button, the court's Wi-Fi button (its setup
  section and its Button column in the venue's court list), and the wording on the print sign and
  landing page.

**Out**

- Payment of any kind on the player's page.
- Choosing the number of saves on the player's page (fixed at 5).
- Booking ahead — the player's game always starts now.
- Opening a game that's already running from the court QR — the player who started it has its
  page.
- Clips already saved: their links keep working until they expire (7 days, CR-026).
- The recorder box's button listener: left in place on the boxes. The API refuses presses, which
  the box drops — no box update needed.

## Acceptance criteria

- Scanning the court's QR sign (old printed signs too) opens a page with the venue and court where
  I enter how long we'll play and, optionally, a name, phone number and email.
- There is no "Save the last 60 seconds" anywhere: not on the QR page, the print sign, the court
  setup page or the landing page; there is no Button section on the court setup page.
- Tapping Start game starts recording at once and takes me to the game's page with the live view.
- The game allows 5 saves, needs no payment, and its videos open as soon as they're ready.
- The game stops by itself when the game time is up.
- If a game is already running on that court, the page says the court is busy and nothing new
  starts.
- After Issue new code, the old printed sign stops working.
- In Admin → Sessions the game shows as started by Player (QR), marked Free, with 5 saves.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Public: `/court/:qrToken` becomes the Start a game page; it hands off to `/session/:shareToken`. Admin: Setup › Court (QR sign wording, Button section removed), the print sign, the venue's court list (Button column removed), Sessions (Started by). Landing page copy. |
| Data | Migration `028` (applied in dev): `courts.startToken`, `recording_sessions.startedByPlayer`. Migration `029`: drops `courts.startToken` and `courts.buttonCode`. Existing clips and clip payments are untouched. |
| Build / rollout | No app build. No recorder-box update: the API stops accepting button presses (404), which boxes already drop. |
| Permissions | No new permission. The player's page needs no login; the court QR token is the credential, and starting a game is rate-limited. |
| Existing users | Printed QR signs now start a game instead of saving 60 seconds, and court buttons stop doing anything. Not a breaking release: 60-second clips and court buttons were never published (the last release, v1.0.0, is the base platform), so their queued changelog entries are corrected instead of logging a `major` removal. Venues already testing must re-check any printed signs (they keep working, with the new page). |
| Size | L — public page and endpoints reworked, a feature removed across API, web and tests, two migrations. |

## Open questions

- [x] Do player-started games pay at the desk? — No, they're free; the court is paid at
      reservation, outside the system.
- [x] Replace the existing 60-second QR or add a second one? — First: a second one. Revised: the
      one court QR starts a game; the 60-second save is removed.
- [x] Does the court's Wi-Fi button go too? — Yes.
- [x] Scanning while a game runs — open it, or say busy? — The requester asked only for "scan,
      fill in the form, start"; built as "busy", which exposes nobody else's game. Easy to change.

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-20 | Asked directly |
| Approved (revision) | bryanken00 | 2026-11-20 | Asked directly — one court QR, remove 60-second save and the button |
