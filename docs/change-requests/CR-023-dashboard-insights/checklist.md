# CR-023 · Dashboard insights — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)
- [x] Open questions answered (7/30 switch, all unpaid games, games started per hour, on the Dashboard)

## Build

### API (`back/`)

- [x] `GET /admin/dashboard/insights?days=7|30` (`dashboard` read): games played (+ previous
      period), average game length, recorded time per day, unpaid finished games (all dates),
      cash collected + average per paid game, per-day series, games by start hour, games by
      weekday — Manila time; Cancelled / not-started games left out
- [x] Validator for `days` (7 or 30, default 7)
- [x] Tests: the numbers for a known set of games and payments; `days` refused otherwise;
      read-only staff can see it, staff without Dashboard can't
- [x] `cd back && npm run lint && npm test` — 304 pass (5 in `tests/dashboard-insights.test.js`),
      no new lint warnings

### Web (`front/`)

- [x] Dashboard: Insights section — period switch, five cards, Games per day, Peak hours,
      Busiest days charts (shared chart components)
- [x] "Not paid yet" links to Sessions with the Unpaid filter
- [x] Sessions: Payment filter (Unpaid / Paid / Free), read from `?payment=` on open
- [x] `cd front && npm run lint && npm run build`

### 2026-11-20 revision — card sizing

- [x] `StatCard`: `h-full`, value `whitespace-nowrap`, caption wraps under it
- [x] Insights: linked card `h-full`; grid 1 / 2 / 3 / 5 columns; shorter captions
- [x] `cd front && npm run lint && npm run build`

## Acceptance

- [x] The Dashboard shows Insights with the cards and charts; the period switch updates them
- [x] "Not paid yet" matches Sessions → Unpaid, and the click opens that list
- [x] Average game length / recorded per day match the period's games
- [x] Peak hours show when games start; the busiest hour is named
- [x] Staff without the Dashboard permission don't see it

## Wrap-up

- [x] Changelog entry added (`ref: CR-023`)
- [x] Requester shown the result and signed off (bryanken00, 2026-11-20)
- [x] `request.md` status set to `Done`
