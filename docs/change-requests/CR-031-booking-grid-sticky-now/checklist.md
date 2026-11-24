# CR-031 · Bookings day grid: courts stay in view, opens at the current time — Checklist

> Request: [request.md](request.md)

## Before starting

- [x] Approved (see request.md → Approval)

## Build

- [x] `DayGrid`: the court label column and the hour row's corner are `position: sticky; left: 0`
      on a solid surface above the blocks
- [x] `DayGrid`: on each new day on screen (its date + courts), scroll today to the now line (a
      third of the visible hours before it), other days to the start; refetches don't scroll

## Acceptance

- [ ] Scrolling sideways keeps the court names visible
- [ ] Today opens on the current time; another date opens at its first hour

## Wrap-up

- [x] `cd front && npm run lint && npm run build` passes
- [x] Changelog entry added (`ref: CR-031`)
- [ ] Requester shown the result and signed off
- [ ] `request.md` status set to `Done`
