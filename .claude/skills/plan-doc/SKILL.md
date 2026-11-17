---
name: plan-doc
description: Write an implementation plan as a document. Creates docs/plans/PLAN-NNN-<slug>/ with plan.md (goal, context, approach, affected areas, risks, open questions) and checklist.md (ordered, tickable build steps). Use AUTOMATICALLY, without being asked, before building any FULLY NEW feature or module under front/, back/, app/ or edge/ (something the app doesn't do yet and that isn't an add-on to an existing module; changes to existing features go to change-request, broken things to bug-report). Also use when the user runs /plan-doc, asks to write a plan, RFC, or design proposal as a doc, or names a PLAN-NNN id to resume. Not Claude Code's built-in plan mode (/plan).
argument-hint: "<what to plan> | PLAN-NNN"
---

# Plan doc

Turns an idea into a written plan plus a checklist someone can work through. Output lives in
`docs/plans/PLAN-NNN-<slug>/`.

Request: **$ARGUMENTS** (when this runs automatically, the request is the user's message)

## When this runs on its own

A plan is for **fully new** work: a new module, a new portal area, a new capability with no
existing home in the app. Write it automatically, before any code, whenever the user asks for
such a thing, even if they never mention a plan. Route everything else elsewhere:

- It changes, extends, or adds a feature to something that already exists, including a plan
  that's already `Done` → **`change-request`** skill instead.
- Something that should work doesn't → **`bug-report`** skill instead.
- It belongs to a plan that's still open → resume that plan (Step 1) and add a dated line under
  **Revisions** instead of starting a new one.

## Step 1: Resume or new?

- **Existing ID** (`PLAN-004`, or a slug matching a folder): open that folder, read both files,
  and continue from where it stands. Update the plan, tick finished items, and move the status. If
  the work is finished, go straight to Step 5.
- **New**: if the request is empty or too vague to plan (no clear outcome), ask one round of
  questions first. Ask what should be possible when it's done, who uses it (which roles or
  permissions), and any hard constraints or deadline.

## Step 2: Research before writing

A plan that doesn't match the code is worse than none. Before drafting:

- Find the code it touches (pages, controllers, validators, tables, permissions) and name real
  files.
- If it touches `front/src`, `back/` or `app/src`, load `frontend-conventions` /
  `backend-conventions` / `mobile-conventions` so the approach follows them. A new CRUD entity
  takes its build order from the `new-module` skill; its mobile screens from `new-mobile-module`.
- Check `docs/plans/` and `docs/change-requests/` for related or overlapping work, and link it.

## Step 3: Allocate the ID

```bash
ls docs/plans | grep -oE '^PLAN-[0-9]+' | sort -t- -k2 -n | tail -1
```

Take the next number, zero-padded to 3 (`PLAN-001` if there are none). The slug is 2–5 kebab-case
words from the goal, e.g. `PLAN-007-user-export`.

## Step 4: Write both files

`docs/plans/PLAN-NNN-<slug>/plan.md`:

````md
# PLAN-NNN · <Title>

> **Status:** Draft · **Created:** YYYY-MM-DD · **Owner:** <name or —> · **Checklist:** [checklist.md](checklist.md)
> **Related:** <CR-NNN / BUG-NNN / PLAN-NNN, or —>

## Goal

<One or two sentences: what will be possible when this is done, and for whom.>

## Context

<Why now. What exists today, with file links, and what's missing.>

## Approach

<The chosen design: data model changes, API endpoints, UI changes, permissions. Enough that
someone else could build it without asking you.>

### Alternatives considered

- <Option>: <why not>

## Affected areas

| Area | Files / tables | Change |
| --- | --- | --- |
| Database | `back/database/…` | … |
| API | `back/server/src/…` | … |
| UI | `front/src/pages/…` | … |
| Permissions | `module` / `submodule` | … |

## Out of scope

- …

## Risks

- <Risk>: <mitigation>

## Open questions

- [ ] …

## Revisions

- YYYY-MM-DD: Created.
````

`docs/plans/PLAN-NNN-<slug>/checklist.md`:

````md
# PLAN-NNN · <Title> — Checklist

> Tick items as they land. Plan: [plan.md](plan.md)

## Backend

- [ ] …

## Frontend

- [ ] …

## Wrap-up

- [ ] `cd back && npm run lint` passes
- [ ] `cd front && npm run lint && npm run build` passes
- [ ] `cd app && npx expo-doctor@latest && npx expo export --platform android --clear` passes
- [ ] Migration applied, or noted as pending for deploy
- [ ] Tried in the browser (or on a device, for `app/`): <the main flow, in one line>
- [ ] Changelog entry added in `docs/changelog/unpublished/` (`ref: PLAN-NNN`)
- [ ] `plan.md` status set to `Done`
````

Rules:

- Links in these files are relative to the plan folder, so repo files are `../../../back/…`.
- Checklist items must be concrete and verifiable. Write "Add `export` route to the users router
  behind `checkPermission("users", null, "read")`", not "Do backend".
- Put items in build order (backend before frontend, per `new-module`). Drop sections and wrap-up
  lines that don't apply, such as Backend for a UI-only plan or the migration line when there's no
  schema change.
- Status starts at `Draft`. Put unknowns under Open questions and don't invent answers.

## Step 5: Hand off

Report the two paths and the open questions. If the user asked for the feature to be **built**
("add a Products module"), set the status to `Approved` and carry on implementing, unless an
open question blocks the approach, in which case ask it first. If they only asked for a plan,
stop and ask whether to start. While implementing:

- Tick items (`- [x]`) only as each one actually lands, and set the status to `In progress`.
- If scope changes partway through, update `plan.md` and add a dated line under **Revisions**
  instead of silently rewriting it.
- When every item is ticked, set the status to `Done` and **immediately** add a changelog entry
  through the `changelog` skill with `ref: PLAN-NNN`, before reporting done. A finished checklist
  always gets its entry.
