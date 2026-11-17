# Bug reports

One folder per bug. Create one with `/bug-report <what's broken>`. Claude
writes it up, investigates the root cause, and lays out the fix. Each
`BUG-NNN-<slug>/` folder holds:

- `bug.md`: summary, severity, where, steps to reproduce, expected vs actual,
  root cause, resolution
- `fix.md`: the fix checklist (confirm → fix → check nothing else broke →
  wrap-up)

Statuses: `Open` → `Investigating` → `Fixing` → `Fixed` → `Verified` (or
`Won't fix`). `Verified` is set by whoever confirms the fix on a real device,
not by the person who fixed it.

| Severity | Meaning |
| --- | --- |
| Critical | Data loss (including local data wiped by an app update), a security hole, one user seeing another's data, the app crashing on launch, or a core flow (sign-in, saving) down for everyone |
| High | A main feature is broken with no workaround, or the app crashes inside one |
| Medium | Broken, but there's a workaround, or it affects few users, one platform, or one OS version |
| Low | Cosmetic, wording, minor annoyance |

Shared conventions: [`../README.md`](../README.md).
