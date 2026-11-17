# Project docs

Home for **repo-level Markdown that isn't front- or back-specific**: plans, bug reports, change
requests, the release changelog, and any other cross-cutting notes. Put it here instead of at the
repo root (keep the root clean) or inside `front/` / `back/` (those hold code conventions only).

## Layout

```
docs/
├── README.md                  ← you are here
├── plans/                     ← /plan-doc
│   └── PLAN-001-<slug>/
│       ├── plan.md            the approach
│       └── checklist.md       the steps, ticked as work lands
├── bug-reports/               ← /bug-report
│   └── BUG-001-<slug>/
│       ├── bug.md             what's wrong, how to reproduce, root cause
│       └── fix.md             the fix checklist
├── change-requests/           ← /change-request
│   └── CR-001-<slug>/
│       ├── request.md         what was asked for, why, and its impact
│       └── checklist.md       build steps + acceptance + sign-off
├── changelog/                 ← /changelog (automatic) and /publish
│   ├── README.md              release index + entry format + versioning rules
│   ├── unpublished/           one small file per finished change, waiting for release
│   └── published/
│       └── v1.0.0.md          client-facing release notes, one file per version
└── <anything-else>.md         notes, ADRs, research, runbooks
```

## How the pieces connect

1. Work starts as a **plan**, a **bug report**, or a **change request**. Claude creates it
   **automatically** before writing code, no slash command needed, and picks the kind like this:

   | The request is… | Doc |
   | --- | --- |
   | A fully new feature or module | Plan |
   | A change to something that exists, including a new feature added onto an existing module or a finished plan/CR | Change request |
   | Something that should work and doesn't | Bug report |

   Each gets its own numbered folder with a write-up and a checklist.
2. As the work lands, the checklist gets ticked and the write-up's **Status** line moves.
3. **Every time a checklist is finished**, Claude drops an entry into `changelog/unpublished/`
   **automatically**, tagged with its weight (`major` / `minor` / `patch`) and the doc's ID.
4. `/publish` rolls every unpublished entry into one plain-language release note in
   `changelog/published/`, bumps the version in `front/` and `back/`, and empties the queue.

| Command | Creates | Skill |
| --- | --- | --- |
| `/plan-doc <what>` | `plans/PLAN-NNN-<slug>/plan.md` + `checklist.md` | [plan-doc](../.claude/skills/plan-doc/SKILL.md) |
| `/bug-report <what>` | `bug-reports/BUG-NNN-<slug>/bug.md` + `fix.md` | [bug-report](../.claude/skills/bug-report/SKILL.md) |
| `/change-request <what>` | `change-requests/CR-NNN-<slug>/request.md` + `checklist.md` | [change-request](../.claude/skills/change-request/SKILL.md) |
| `/changelog <what>` — also runs on its own | `changelog/unpublished/<date>-<slug>.md` | [changelog](../.claude/skills/changelog/SKILL.md) |
| `/publish [major\|minor\|patch\|X.Y.Z] [--dry-run]` | `changelog/published/vX.Y.Z.md` + version bump | [publish](../.claude/skills/publish/SKILL.md) |

Pass an existing ID to pick one back up: `/plan-doc PLAN-004`, `/bug-report BUG-012`.

> **Why not `/plan` and `/bug`?** Both are built-in Claude Code commands (plan mode, and
> reporting a bug to Anthropic). Built-ins win over project skills with the same name.

## Conventions

- **IDs are sequential per category and never reused**: `PLAN-001`, `BUG-014`, `CR-003`. The
  folder is `<ID>-<kebab-slug>`. If two branches grab the same number, whoever merges second
  renumbers.
- **Every write-up opens with a status line** (status, date, owner, link to its checklist). Keep
  it current, because that line is how stale docs get spotted.
- **Status values**
  - Plan: `Draft` → `Approved` → `In progress` → `Done` (or `Dropped`)
  - Bug: `Open` → `Investigating` → `Fixing` → `Fixed` → `Verified` (or `Won't fix`)
  - Change request: `Requested` → `Approved` → `In progress` → `Done` (or `Rejected`)
- **Cross-link by ID**. A CR that spawned a plan names it, and a changelog entry carries
  `ref: BUG-007`.
- **Loose docs** (notes, ADRs, research, runbooks) go straight in `docs/` as `kebab-case.md` with a
  `Created: YYYY-MM-DD` line. Give them a subfolder once there are several of a kind.

## What does NOT belong here

- **Coding conventions** for the client → the
  [`frontend-conventions`](../.claude/skills/frontend-conventions/SKILL.md) skill's `references/`.
- **Coding conventions** for the API → the
  [`backend-conventions`](../.claude/skills/backend-conventions/SKILL.md) skill's `references/`.
- The **high-level project map** → [`README.md`](../README.md) and [`CLAUDE.md`](../CLAUDE.md) at
  the root.
