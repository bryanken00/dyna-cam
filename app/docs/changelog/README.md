# Changelog

Release notes for clients and end users, plus the queue of changes waiting for
the next release.

| Folder | What | Written by |
| --- | --- | --- |
| [`unpublished/`](unpublished/) | One small file per finished change since the last release (the queue) | Claude, automatically (the `changelog` skill), or `/changelog <what changed>` |
| [`published/`](published/) | One file per release, in plain language, safe to send to a client or paste into the stores | `/publish` |

## Releases

<!-- /publish adds a row directly under the header, newest first -->

| Version | Date | Highlights |
| --- | --- | --- |

## Unpublished entry format

File name: `YYYY-MM-DD-<kebab-slug>.md`. There is one file per change so that
parallel branches never conflict on a shared file.

```md
---
type: added        # added | improved | fixed | removed | security
impact: minor      # major | minor | patch (decides the version bump)
audience: user     # user = listed in the release notes · internal = bumps the version only
ref: PLAN-004      # optional: the PLAN-/BUG-/CR- this came from
---

You can now export your item list as a spreadsheet from the Items screen.

## Dev notes

- New `useExportItems` mutation in `services/requests/items.js`.
- **Native:** adds `expo-sharing`, so this needs a new build; it can't ship
  to an existing install.
```

The first paragraph is the **plain-language summary**, and `/publish` builds
the release note from it. `## Dev notes` is for the team and never reaches the
published notes. Anything a release needs goes there too, and `/publish`
surfaces it as release notes for whoever ships: a new native module (so a new
build), a new `EXPO_PUBLIC_*` variable, a local SQLite migration, a new OS
permission prompt.

## How the version is chosen

Versions follow `MAJOR.MINOR.PATCH`. `/publish` looks at every unpublished
entry and bumps by the heaviest one:

| Impact | When | Example | 1.4.2 → |
| --- | --- | --- | --- |
| `major` | Users must re-learn something or take action; something they relied on is gone or works differently | A screen removed, sign-in works differently, users must sign in again | 2.0.0 |
| `minor` | Users can do something new | New screen, filter, field, or setting | 1.5.0 |
| `patch` | Fixes, polish, speed, security hardening, behind-the-scenes work | A wrong total fixed, smoother scrolling, a clearer error message | 1.4.3 |

The version lives in `app.json` (`expo.version`, the one the stores show),
`package.json`, and `src/constants/version.js`. `/publish` bumps all three.
Build numbers are separate: `eas.json` keeps them on EAS
(`appVersionSource: "remote"`) and auto-increments them on production builds.

Override with `/publish major|minor|patch|X.Y.Z`; preview without writing
anything with `/publish --dry-run`.
