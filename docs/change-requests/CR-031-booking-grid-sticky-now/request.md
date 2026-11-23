# CR-031 · Bookings day grid: courts stay in view, opens at the current time

> **Status:** In progress · **Requested:** 2026-11-23 · **Requested by:** bryanken00 · **Size:** S
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [PLAN-003](../../plans/PLAN-003-court-booking/plan.md) (Bookings day view)

## Requested change

> The court must fix, also possible auto focus current time

On Admin → Bookings → Day:
- the court names stay on the left while staff scroll through the hours;
- today's grid opens already scrolled to the current time.

## Today

The whole grid scrolls sideways together, so the court names slide out of view and staff lose
track of which row is which court. The grid always opens at the venue's opening hour, so in the
afternoon staff have to scroll right to find "now".

## Why

Staff use the day grid at the desk, mostly to see what's happening now and next. They should see
the current time and the court names without scrolling.

## Scope

**In**

- The court name column stays fixed while the hours scroll.
- On today's date the grid opens scrolled so the red "now" line is in view, with the last hour or
  so before it still visible.
- Other dates open at the start of the day.
- Picking another venue or date scrolls again. The grid's own refresh doesn't move the scroll
  under the user.

**Out**

- The List view; the hour row staying fixed while scrolling down (the grid isn't tall enough to
  need it).

## Acceptance criteria

- Scrolling the day grid sideways keeps the court names visible.
- Opening Bookings today shows the current time without scrolling.
- Another date opens at its first hour.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Admin → Bookings → Day (`DayGrid`) |
| Data | None |
| Build / rollout | None |
| Permissions | None |
| Existing users | Only the grid's scrolling changes |
| Size | S |

## Open questions

- [ ] —

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-23 | Asked directly |
