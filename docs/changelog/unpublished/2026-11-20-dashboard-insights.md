---
type: added
impact: minor
audience: user
ref: CR-023
---

The Dashboard has a new **Insights** section for the last 7 or 30 days: games played (compared
with the period before), average game length, recorded time per day, games not paid yet, and cash
collected — plus charts of games per day, peak hours and the busiest days of the week. Clicking
**Not paid yet** opens Sessions showing the unpaid games, and Sessions now has a Payment filter.

## Dev notes

- back/: new `GET /api/v1/admin/dashboard/insights?days=7|30` (`dashboard` read); no migration.
- front/: Dashboard `InsightsSection`; Sessions reads `?payment=Unpaid|Paid|Free` and has a
  Payment filter.
