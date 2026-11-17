---
name: changelog
description: Queue a finished change for the next release by adding one small file to docs/changelog/unpublished/ with its type, impact (major/minor/patch), audience, and a plain-language summary. Use AUTOMATICALLY, without being asked, EVERY TIME a plan (PLAN-NNN), change request (CR-NNN), or bug report (BUG-NNN) checklist is finished, and after any other finished change under front/ or back/ that will ship (feature, fix, UI change, removal, security fix, performance work, or internal refactor), before reporting the task done. Also use when the user runs /changelog or asks to add or update a changelog entry. Skip changes that only touch docs/, .claude/, README.md, CLAUDE.md, or comments.
argument-hint: "[what changed] (defaults to the work just finished)"
---

# Changelog entry

Queues one change for the next release. Later, `/publish` turns the queue into client-facing
release notes and picks the version number from the entries' `impact`.

Change: **$ARGUMENTS**. If that's empty, describe the work just finished in this session, using
`git status` / `git diff` to see what it covered.

## When to write one

**Every time a checklist is finished**: the last item of a plan's `checklist.md`, a CR's
`checklist.md`, or a bug's `fix.md` is ticked and its status moves to `Done` / `Fixed`. Write the
entry right then, with `ref:` set to that doc's ID, before reporting done. Don't wait to be asked
and don't batch several finished checklists into one entry.

Also write one for any other change under `front/` or `back/` that is **finished and will ship**
without a tracking doc. Don't write one for:

- changes to docs, `.claude/`, README, CLAUDE.md, comments, or lint config only
- work still in progress. Write the entry when the work is done, not after each step.
- **a fix to something that hasn't been released yet.** Users never saw that bug, so don't add a
  `fixed` entry. Update the feature's existing unpublished entry instead (add the `BUG-NNN` to its
  Dev notes, and adjust the summary if the fix changes what the feature does). That update is
  this checklist's changelog step.

Write **one entry per change a user would describe as one thing**, not one per file or commit. A
new module with its table, API, page, and menu entry is a single entry.

## Step 1: Check for an existing entry

```bash
ls docs/changelog/unpublished/
```

If an entry already covers this work (same feature, same `ref`), update that file instead of adding
a second one.

## Step 2: Classify

| `type` | Use for |
| --- | --- |
| `added` | A new capability: page, report, filter, field, setting, export |
| `improved` | Something existing works better or differently: polish, speed, clearer messages, a new column |
| `fixed` | Something that was broken now works |
| `removed` | A feature, page, option, or field was taken away |
| `security` | A security fix or hardening |

| `impact` | Rule |
| --- | --- |
| `major` | Existing users must change how they work or take action, or something they relied on is gone or behaves differently. Examples: removals, a changed login flow, a changed import/export format, an API change that breaks an integration, a migration that needs manual steps. |
| `minor` | Users can do something new. |
| `patch` | Fixes, polish, performance, security hardening that doesn't change behaviour, internal work. |

The usual pairing is `added` → minor, `improved` → minor or patch, `fixed` / `security` → patch,
and `removed` → major. If you're unsure between minor and patch, pick patch and mention it in your
report. **If you're unsure whether something is breaking, ask.** An unmarked breaking change is
the costliest mistake this file can make.

| `audience` | Use for |
| --- | --- |
| `user` | Someone using the app, or the client, would notice. Listed in the release notes. |
| `internal` | Refactors, dependency upgrades, logging, dev tooling, tests. Bumps the version but isn't listed on its own. |

## Step 3: Write the file

Path: `docs/changelog/unpublished/YYYY-MM-DD-<kebab-slug>.md`, using today's date and a 2–5 word
slug.

````md
---
type: added
impact: minor
audience: user
ref: PLAN-004
---

<Plain-language summary: one or two sentences.>

## Dev notes

- <endpoints, files, migrations, env vars, anything a developer or deployer needs>
````

Omit `ref` when the change didn't come from a plan, bug, or CR. Put anything a deploy needs
("run `npm run db:migrate`", "add `FOO_KEY` to `.env`") in Dev notes, because `/publish` surfaces
those lines to whoever ships the release.

### Writing the summary

The summary is what the client eventually reads, so write it for them now while the context is
fresh.

- Write from the user's side: what they can now do, or what works now.
- Say where: "on the Users page", "in Account Settings".
- Leave out file names, endpoints, component or library names, and table or column names. Also
  leave out jargon such as API, refactor, migration, backend, frontend, query, cache, null,
  endpoint, and deploy.
- For a fix, describe the symptom that's gone, not the cause.

| ❌ Technical | ✅ Plain |
| --- | --- |
| Added `GET /users/export` endpoint using exceljs | Admins can download the user list as an Excel file from the Users page. |
| Added `status != 'Deleted'` filter to the roles query | Deleted roles no longer appear in the Roles list. |
| Fixed permission slug mismatch on roles route | Managers with access to roles can open the Roles page again. |
| Debounced the search input in `hooks.jsx` | Searching the Users table feels smoother. |

## Step 4: Report

Add one line to your final message:
`Changelog: docs/changelog/unpublished/<file> (<type>, <impact>, <audience>)`. The user can edit
or delete it before publishing.
