---
name: bug-report
description: Log a bug as a document and investigate it. Creates docs/bug-reports/BUG-NNN-<slug>/ with bug.md (summary, severity, where, steps to reproduce, expected vs actual, root cause, resolution) and fix.md (the fix checklist). Use AUTOMATICALLY, without being asked, whenever the user reports or asks to fix something under front/ or back/ that should already work and doesn't — an error, a crash, wrong data, a broken page or flow — before fixing it. Also use when the user runs /bug-report, asks to log or write up a bug, or names a BUG-NNN id to resume. Wanting existing behaviour to work DIFFERENTLY is a change request, not a bug. Not Claude Code's built-in /bug (feedback to Anthropic).
argument-hint: "<what's broken> | BUG-NNN"
---

# Bug report

Records a bug, finds its root cause, and lays out the fix as a checklist. Output lives in
`docs/bug-reports/BUG-NNN-<slug>/`.

Report: **$ARGUMENTS** (when this runs automatically, the report is the user's message)

## When this runs on its own

Write a bug report automatically, before touching code, whenever something **should already
work and doesn't**: an error message, a 4xx/5xx, a crash, wrong or missing data, a page or button
that does nothing, data showing to someone without permission. The user doesn't have to say
"bug". Route the rest elsewhere:

- It works as built, but they want it to work differently → **`change-request`**.
- It's a brand-new feature → **`plan-doc`**.
- You break something yourself while building a plan or CR, before it ships → fix it as part of
  that checklist; it isn't a separate bug.

## Step 1: Resume or new?

- **Existing ID or slug**: open the folder, read `bug.md` + `fix.md`, and continue.
- **Automatic**: if the user already described the symptom and where, don't ask anything up
  front. Write bug.md from what they said, investigate, and fill the gaps from the code.
- **New**: at minimum you need **what happened** and **where** (page or endpoint). If
  either is missing, ask once. In the same message, ask for steps, the account's role, and any
  error text or screenshot the user has. Don't block on nice-to-haves; mark them `Unknown`.

## Step 2: Allocate the ID

```bash
ls docs/bug-reports | grep -oE '^BUG-[0-9]+' | sort -t- -k2 -n | tail -1
```

Take the next number, zero-padded to 3. The slug is 2–5 kebab-case words for the **symptom**, e.g.
`BUG-012-roles-list-403`. Skim the existing titles first. If this is the same bug, resume that one
instead.

## Step 3: Write bug.md with what's known

Status `Open`. Pick the severity from the table in `docs/bug-reports/README.md`. If the bug lets
a user see or change data their permissions don't allow, or reach the Owner account or role, it's
**Critical**.

````md
# BUG-NNN · <Short symptom>

> **Status:** Open · **Severity:** <Critical|High|Medium|Low> · **Reported:** YYYY-MM-DD · **Reported by:** <name or —>
> **Fix checklist:** [fix.md](fix.md)

## Summary

<One or two sentences in plain words: what's broken, and for whom.>

## Where

- **Page / endpoint:** <e.g. Admin → User Management → Roles · `GET /api/v1/admin/roles`>
- **Account / role:** <e.g. operations manager with read-only access>
- **Environment:** <local / staging / production · browser>

## Steps to reproduce

1. …

## Expected

…

## Actual

<What happens instead: error text, status code, screenshot path.>

## Root cause

<Filled after investigation: [file.js:42](../../../back/…) and why it fails. Starts with
"Hypothesis:" until confirmed.>

## Resolution

<Filled when fixed: what changed, in a sentence or two.>
````

## Step 4: Investigate

Set the status to `Investigating`. Load `frontend-conventions` and/or `backend-conventions` for
the sides involved, then trace the path from the UI through the request to the query. Common
culprits in this repo:

- Owner protection: a users/roles query missing `roleName != 'Owner'`, so the Owner becomes reachable
- a permission slug that differs between `checkPermission()` and `<ProtectedRoute>` / the nav entry
- the two-hop unwrap `apiData?.data?.<entity>` done with one hop
- a missing `status != 'Deleted'` filter
- a React Query key that isn't invalidated after a mutation
- a `NULL` DB column validated as required (or the reverse)

Fill **Root cause** with the actual lines (`file:line` links) and why they fail. If you can't
confirm it, write it as `Hypothesis:` and say what would confirm it. **Never present a guess as
the cause.**

## Step 5: Write fix.md

````md
# BUG-NNN · <Short symptom> — Fix checklist

> Bug: [bug.md](bug.md)

## Confirm

- [ ] Reproduced with the steps in bug.md
- [ ] Root cause confirmed (not a hypothesis) and written in bug.md

## Fix

- [ ] <concrete change: which file, and what>

## Check nothing else broke

- [ ] Searched for the same pattern elsewhere (<what to grep>); other hits fixed or logged as their own bug
- [ ] Access still holds: a user without the permission is refused, and the Owner stays out of reach
- [ ] <neighbouring flow that shares the changed code>

## Wrap-up

- [ ] `cd back && npm run lint` passes
- [ ] `cd front && npm run lint && npm run build` passes
- [ ] The steps in bug.md no longer reproduce
- [ ] Changelog entry added (`type: fixed`, `ref: BUG-NNN`)
- [ ] `bug.md` status set to `Fixed`, Resolution filled
````

Drop lines that don't apply, such as backend lint for a CSS-only fix.

## Step 6: Hand off

Report the root cause (or best hypothesis), the planned fix, severity, and paths. If the user
asked for it to be fixed (or just reported it while you're working together), go ahead and fix
it. **Ask first** only if they asked just to log it, or the root cause is still a hypothesis and
the fix would be a guess. While fixing, set the status to `Fixing` and
tick items as they land. When done:

- set the status to `Fixed` and fill **Resolution**
- **immediately** add a changelog entry through the `changelog` skill (`type: fixed`,
  `ref: BUG-NNN`), before reporting done. A finished checklist always gets its entry. If the bug
  is in a feature whose own entry is still in `docs/changelog/unpublished/` (users never saw the
  bug), the `changelog` skill updates that entry instead of announcing a fix.
- leave `Verified` for the user or QA to set once they've confirmed it in the real app
