---
name: changelog
description: Queue a finished change for the next release by adding one small file to docs/changelog/unpublished/ with its type, impact (major/minor/patch), audience, and a plain-language summary. Use AUTOMATICALLY, without being asked, right after you finish any change that will ship in the app (anything under src/, App.js, index.js, global.css, tailwind/babel/metro config, app.json, assets/, or a dependency in package.json) — feature, fix, UI change, removal, security fix, performance work, dependency upgrade, or internal refactor — before reporting the task done. Also use when the user runs /changelog or asks to add or update a changelog entry. Skip changes that only touch docs/, .claude/, README.md, CLAUDE.md, or comments.
argument-hint: "[what changed] (defaults to the work just finished)"
---

# Changelog entry

Queues one change for the next release. Later, `/publish` turns the queue into
client-facing release notes and picks the version number from the entries'
`impact`.

Change: **$ARGUMENTS**. If that's empty, describe the work just finished in this
session, using `git status` / `git diff` to see what it covered.

## When to write one

Write an entry when a change to **what a build contains** is finished and will
ship: `src/`, `App.js`, `index.js`, `global.css`, `tailwind.config.js`,
`babel.config.js`, `metro.config.js`, `app.json`, `assets/`, or the
dependencies in `package.json`. Don't write one for:

- changes to docs, `.claude/`, README, CLAUDE.md, or comments only
- work still in progress. Write the entry when the work is done, not after each
  step.
- **a fix to something that hasn't been released yet.** Users never saw that
  bug. If the fix changes what the feature does, update the feature's existing
  unpublished entry instead.

Write **one entry per change a user would describe as one thing**, not one per
file or commit. A new module with its table, requests, screen, sheet, route and
Menu row is a single entry.

## Step 1: Check for an existing entry

```bash
ls docs/changelog/unpublished/
```

If an entry already covers this work (same feature, same `ref`), update that
file instead of adding a second one.

## Step 2: Classify

| `type` | Use for |
| --- | --- |
| `added` | A new capability: screen, filter, field, setting, export |
| `improved` | Something existing works better or differently: polish, speed, clearer messages, a new field on a row |
| `fixed` | Something that was broken now works |
| `removed` | A feature, screen, option, or field was taken away |
| `security` | A security fix or hardening |

| `impact` | Rule |
| --- | --- |
| `major` | Existing users must change how they work or take action, or something they relied on is gone or behaves differently. Examples: removals, a changed sign-in flow, everyone signed out by a changed storage key, local data reset, an API change that breaks older installs. |
| `minor` | Users can do something new. |
| `patch` | Fixes, polish, performance, security hardening that doesn't change behaviour, internal work. |

The usual pairing is `added` → minor, `improved` → minor or patch, `fixed` /
`security` → patch, and `removed` → major. If you're unsure between minor and
patch, pick patch and mention it in your report. **If you're unsure whether
something is breaking, ask.** An unmarked breaking change is the costliest
mistake this file can make.

| `audience` | Use for |
| --- | --- |
| `user` | Someone using the app, or the client, would notice. Listed in the release notes. |
| `internal` | Refactors, dependency upgrades, logging, dev tooling. Bumps the version but isn't listed on its own. |

## Step 3: Write the file

Path: `docs/changelog/unpublished/YYYY-MM-DD-<kebab-slug>.md`, using today's
date and a 2–5 word slug.

````md
---
type: added
impact: minor
audience: user
ref: PLAN-004
---

<Plain-language summary: one or two sentences.>

## Dev notes

- <files, hooks, tables, env vars, anything a developer or whoever ships needs>
````

Omit `ref` when the change didn't come from a plan, bug, or CR. Put anything a
release needs in Dev notes, because `/publish` surfaces those lines to whoever
ships it:

- a new native module or config plugin → "needs a new build" (it can't reach
  an existing install)
- a new `EXPO_PUBLIC_*` variable → its name and what to set it to
- a local SQLite migration → its name and what it changes
- a new OS permission → the prompt users will see
- a changed persisted-store `name` or shape → who gets signed out or reset

### Writing the summary

The summary is what the client eventually reads, so write it for them now while
the context is fresh.

- Write from the user's side: what they can now do, or what works now.
- Say where: "on the Items screen", "in the Menu", "on the sign-in screen".
  Name the platform when only one is affected ("On Android, …").
- Leave out file names, component, hook or library names, and table or column
  names. Also leave out jargon such as API, refactor, migration, backend,
  query, cache, null, endpoint, SQLite, native module, and build.
- For a fix, describe the symptom that's gone, not the cause.

| ❌ Technical | ✅ Plain |
| --- | --- |
| Added `useExportItems` mutation with expo-sharing | You can share your item list as a spreadsheet from the Items screen. |
| Filtered `status = 'Deleted'` out of `db_getItems` | Deleted items no longer appear in the Items list. |
| Added `React.memo` to `DataListRow` | Scrolling long lists is smoother. |
| Debounced `FilterBar` search | Searching the Items list no longer stutters while you type. |

## Step 4: Report

Add one line to your final message:
`Changelog: docs/changelog/unpublished/<file> (<type>, <impact>, <audience>)`.
The user can edit or delete it before publishing.
