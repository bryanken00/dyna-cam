# Bug reports

One folder per bug. Claude creates one automatically whenever something that should work doesn't
(or run `/bug-report <what's broken>`). Claude writes it up,
investigates the root cause, and lays out the fix. Each `BUG-NNN-<slug>/` folder holds:

- `bug.md`: summary, severity, where, steps to reproduce, expected vs actual, root cause,
  resolution
- `fix.md`: the fix checklist (confirm → fix → check nothing else broke → wrap-up)

Statuses: `Open` → `Investigating` → `Fixing` → `Fixed` → `Verified` (or `Won't fix`).
`Verified` is set by whoever confirms the fix in the real app, not by the person who fixed it.

| Severity | Meaning |
| --- | --- |
| Critical | Data loss, a security hole, a user reaching data their permissions don't allow, or a core flow (login, saving) down for everyone |
| High | A main feature is broken with no workaround |
| Medium | Broken, but there's a workaround or it affects few users |
| Low | Cosmetic, wording, minor annoyance |

Shared conventions: [`../README.md`](../README.md).
