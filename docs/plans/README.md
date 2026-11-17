# Plans

Implementation plans, design proposals, RFCs, and migration strategies, one folder per plan.

Claude creates one automatically for any **fully new** feature or module (or run
`/plan-doc <what you want to build>`). Each `PLAN-NNN-<slug>/` folder holds:

- `plan.md`: goal, context, approach, affected areas, risks, open questions
- `checklist.md`: the ordered build steps, ticked as the work lands

Statuses: `Draft` → `Approved` → `In progress` → `Done` (or `Dropped`).

A plan is **how we'll build something**. If a client asked for it, the ask itself lives in
[`../change-requests/`](../change-requests/) and the two link each other. Shared conventions:
[`../README.md`](../README.md).
