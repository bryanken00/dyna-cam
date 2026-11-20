# CR-023 · Dashboard insights: game length, unpaid games, recorded time per day, peak hours

> **Status:** Done · **Requested:** 2026-11-20 · **Requested by:** bryanken00 · **Size:** M
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [CR-020](../CR-020-hide-recent-activity/request.md) (Dashboard), [CR-015](../CR-015-pay-before-download/request.md) (payments), [CR-016](../CR-016-game-time-limit/request.md) (game time)

## Requested change

> Improve dashboard, add more data like average time of recording, not paid yet, average recorded
> time per day, peak hour like that.

## Today

The Dashboard shows **today only**: games on court, replays saved, cash today, cameras rolling,
the court board, needs attention and recorder boxes. Nothing looks back over days, and nothing
shows unpaid games.

## Why

Owners want to see how the courts are used — how long games run, how many hours are recorded a
day, when it's busiest — and what is still unpaid.

## How it works

A new **Insights** section on the Dashboard, under today's numbers, with a **Last 7 days /
Last 30 days** switch (7 by default), all venues together:

| Card | Shows |
| --- | --- |
| Games played | Games recorded in the period (± vs the period before) |
| Average game length | Average recorded time per game, e.g. "1 h 12 min" |
| Recorded per day | Average recorded time per day, e.g. "6 h 40 min / day" |
| Not paid yet | **Every** finished game still unpaid (any date) — count; click opens Sessions filtered to Unpaid |
| Cash collected | Total in the period and average per paid game |

Charts:

- **Games per day** — bars for each day, with the recorded hours in the tooltip.
- **Peak hours** — games by the hour they started (e.g. 6 AM … 11 PM), with "Busiest: 6–7 PM".
- **Busiest days** — games by day of week (Mon … Sun).

## Scope

**In**

- Insights section (cards + charts above), period switch, all venues together.
- One new API endpoint for the numbers (Dashboard permission, like the rest of the page).
- Sessions: a **Payment** filter (Unpaid / Paid / Free), which the Dashboard link opens set to
  Unpaid (`/admin/dyna-cam/sessions?payment=Unpaid`).

**Out**

- Per-venue / per-court breakdown, exports, emailed reports (later if wanted).

## Acceptance criteria

- The Dashboard shows the Insights section with the cards and charts above.
- Switching the period updates every card and chart.
- "Not paid yet" matches the Unpaid games in Sessions, and clicking it opens that list.
- Average game length and recorded per day match the games in Sessions for that period.
- Peak hours show when games start; the busiest hour is named.
- Staff without the Dashboard permission don't see it (as today).

## Impact

| Area | Detail |
| --- | --- |
| Screens | Web: Dashboard (new Insights section). Sessions: new Payment filter, settable from the address. |
| Data | None — computed from games (`recording_sessions`) and `payments`. No migration. |
| API | New `GET /api/v1/admin/dashboard/insights?days=7` (`dashboard` read). |
| Build / rollout | Server + web deploy. |
| Permissions | None new. |
| Existing users | Adds a section; nothing else changes. Release impact `minor`. |
| Size | M: queries + endpoint + tests, cards and three charts — about a day. |

## Open questions

- [x] **Period:** **7 / 30 days switch**, default 7 (bryanken00, 2026-11-20)
- [x] **"Not paid yet":** **all unpaid games** (any date), click → Sessions filtered to Unpaid
      (bryanken00, 2026-11-20)
- [x] **Peak hours by:** **games started per hour** (bryanken00, 2026-11-20)
- [x] **Where:** **on the Dashboard, under today's numbers** (bryanken00, 2026-11-20)

## Design notes (as built)

- `GET /admin/dashboard/insights?days=7|30`: a game counts when it recorded (Recording,
  Processing, Ready or Failed — not Waiting, booked ahead or Cancelled), on the Manila day it
  started; its recorded time is start → end (→ now while it records). The previous period is the
  same number of days before. Cash = Paid payments (replays and games) in the period.
- "Not paid yet" = games that have ended (Processing / Ready) and are still Unpaid, any date.
  Sessions' Unpaid filter also lists unpaid games still recording or never played, so it can show
  a few more.
- Peak hours run 6 AM – 10 PM, wider when games started outside that.
- Placement: under today's numbers and Needs attention, above the court board.

## Revisions

- 2026-11-20: Card sizing fixed (bryanken00: "fix card sizing") — stat cards in a row are the
  same height (also the clickable Not paid yet), a value never wraps ("36 min" on one line),
  the caption moves under the value when narrow, shorter captions, 3 cards a row on mid-size
  screens and 5 on wide ones. The shared StatCard change applies to every page's stat cards.

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-20 | Asked directly ("Improve dashboard…"); open questions answered as recommended |
| Signed off — Done | bryanken00 | 2026-11-20 | Tried in the running app and accepted |
