# Changelog

Release notes for clients and end users, plus the queue of changes waiting for the next release.

| Folder | What | Written by |
| --- | --- | --- |
| [`unpublished/`](unpublished/) | One small file per finished change since the last release (the queue) | Claude, automatically (the `changelog` skill), or `/changelog <what changed>` |
| [`published/`](published/) | One file per release, in plain language, safe to send to a client | `/publish` |

## Releases

<!-- /publish adds a row directly under the header, newest first -->

| Version | Date | Highlights |
| --- | --- | --- |
| [v1.0.0](published/v1.0.0.md) | 2026-09-10 | First release: company management, team members, roles, and access control |

## Unpublished entry format

File name: `YYYY-MM-DD-<kebab-slug>.md`. There is one file per change so that parallel branches
never conflict on a shared file.

```md
---
type: added        # added | improved | fixed | removed | security
impact: minor      # major | minor | patch (decides the version bump)
audience: user     # user = listed in the release notes · internal = bumps the version only
ref: PLAN-004      # optional: the PLAN-/BUG-/CR- this came from
---

Admins can now download the user list as an Excel file from the Users page.

## Dev notes

- New `GET /api/v1/admin/users/export`; streams an .xlsx.
```

The first paragraph is the **plain-language summary**, and `/publish` builds the release note
from it. `## Dev notes` is for the team and never reaches the published notes. Anything a deploy
needs (e.g. "run `npm run db:migrate`") goes there too, and `/publish` surfaces it as deploy notes.

## How the version is chosen

Versions follow `MAJOR.MINOR.PATCH`. `/publish` looks at every unpublished entry and bumps by the
heaviest one:

| Impact | When | Example | 1.4.2 → |
| --- | --- | --- | --- |
| `major` | Users must re-learn something or take action; something they relied on is gone or works differently | A page removed, login works differently, an import file format changed | 2.0.0 |
| `minor` | Users can do something new | New page, report, filter, field, or setting | 1.5.0 |
| `patch` | Fixes, polish, speed, security hardening, behind-the-scenes work | A wrong total fixed, faster table loading, a clearer error message | 1.4.3 |

Override with `/publish major|minor|patch|X.Y.Z`; preview without writing anything with
`/publish --dry-run`.
