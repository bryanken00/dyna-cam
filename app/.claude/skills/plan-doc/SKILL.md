---
name: plan-doc
description: Write an implementation plan as a document. Creates docs/plans/PLAN-NNN-<slug>/ with plan.md (goal, context, approach, affected areas, risks, open questions) and checklist.md (ordered, tickable build steps). Use when the user runs /plan-doc, or asks to write, draft, create, or save a plan, RFC, design proposal, or implementation plan as a doc. Also use to resume or update an existing plan by its PLAN-NNN id. Not Claude Code's built-in plan mode (/plan).
argument-hint: "<what to plan> | PLAN-NNN"
---

# Plan doc

Turns an idea into a written plan plus a checklist someone can work through.
Output lives in `docs/plans/PLAN-NNN-<slug>/`.

Request: **$ARGUMENTS**

## Step 1: Resume or new?

- **Existing ID** (`PLAN-004`, or a slug matching a folder): open that folder,
  read both files, and continue from where it stands. Update the plan, tick
  finished items, and move the status. If the work is finished, go straight to
  Step 5.
- **New**: if the request is empty or too vague to plan (no clear outcome), ask
  one round of questions first. Ask what should be possible when it's done, who
  uses it, which platforms matter (Android, iOS, web), whether it must work
  offline, and any hard constraints or deadline.

## Step 2: Research before writing

A plan that doesn't match the code is worse than none. Before drafting:

- Find the code it touches (screens, hooks, `services/api` + `services/requests`,
  stores, SQLite tables, navigation) and name real files.
- Load `frontend-conventions` so the approach follows this repo's rules. A new
  list/detail screen takes its build order from the `new-module` skill.
- Flag early anything that changes what a **build** contains, because it can't
  reach an existing install without a new one: a new native module, a config
  plugin or permission in `app.json`, an `EXPO_PUBLIC_*` variable.
- Check `docs/plans/` and `docs/change-requests/` for related or overlapping
  work, and link it.

## Step 3: Allocate the ID

```bash
ls docs/plans | grep -oE '^PLAN-[0-9]+' | sort -t- -k2 -n | tail -1
```

Take the next number, zero-padded to 3 (`PLAN-001` if there are none). The slug
is 2–5 kebab-case words from the goal, e.g. `PLAN-007-offline-items`.

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

<The chosen design: screens and navigation, data flow (API, local SQLite, or
both), state, any native or config change. Enough that someone else could
build it without asking you.>

### Alternatives considered

- <Option>: <why not>

## Affected areas

| Area | Files | Change |
| --- | --- | --- |
| Screens | `src/Screens/…` | … |
| Navigation | `src/constants/navigations.js`, `src/Navigation/index.js` | … |
| Data | `src/services/api/…`, `src/services/requests/…` | … |
| Local DB | `src/store/database/…` | … |
| State | `src/store/…` | … |
| Native / config | `app.json`, `package.json` | … (needs a new build?) |

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

## Data

- [ ] …

## Screens

- [ ] …

## Wrap-up

- [ ] `npx expo-doctor@latest` passes
- [ ] `npx expo export --platform android --clear` bundles, and the asset list holds nothing unexpected
- [ ] New native module → `npx expo prebuild --clean` and a new dev build
- [ ] Local schema change → table file updated, plus a migration if the table is already on devices
- [ ] Checked in light **and** dark, at ~320px and on a tablet
- [ ] Ran on a device or emulator: <the main flow, in one line>
- [ ] Changelog entry added in `docs/changelog/unpublished/` (`ref: PLAN-NNN`)
- [ ] `plan.md` status set to `Done`
````

Rules:

- Links in these files are relative to the plan folder, so repo files are
  `../../../src/…`.
- Checklist items must be concrete and verifiable. Write "Add `useGetItems` to
  `services/requests/items.js` with key `["items", { page, search }]`", not
  "Do data layer".
- Put items in build order (data before screens, per `new-module`). Drop
  sections and wrap-up lines that don't apply, such as the native-build line
  when no native module is added.
- Status starts at `Draft`. Put unknowns under Open questions and don't invent
  answers.

## Step 5: Hand off

Report the two paths and the open questions, then ask whether to start.
**Don't implement unless the user says so.** When you do implement:

- Tick items (`- [x]`) only as each one actually lands, and set the status to
  `In progress`.
- If scope changes partway through, update `plan.md` and add a dated line under
  **Revisions** instead of silently rewriting it.
- When every item is ticked, set the status to `Done` and add a changelog entry
  through the `changelog` skill with `ref: PLAN-NNN`.
