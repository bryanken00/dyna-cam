---
name: bug-report
description: Log a bug as a document and investigate it. Creates docs/bug-reports/BUG-NNN-<slug>/ with bug.md (summary, severity, where, steps to reproduce, expected vs actual, root cause, resolution) and fix.md (the fix checklist). Use when the user runs /bug-report, or asks to log, file, record, or write up a bug, defect, crash, or issue in this project. Also use to resume a bug by its BUG-NNN id. Not Claude Code's built-in /bug (feedback to Anthropic).
argument-hint: "<what's broken> | BUG-NNN"
---

# Bug report

Records a bug, finds its root cause, and lays out the fix as a checklist.
Output lives in `docs/bug-reports/BUG-NNN-<slug>/`.

Report: **$ARGUMENTS**

## Step 1: Resume or new?

- **Existing ID or slug**: open the folder, read `bug.md` + `fix.md`, and
  continue.
- **New**: at minimum you need **what happened** and **where** (screen, and
  platform). If either is missing, ask once. In the same message, ask for
  steps, the device and OS version, how the app was run (Expo Go, dev build,
  release build), whether demo mode was on, and any error text, red-box stack
  or screenshot. Don't block on nice-to-haves; mark them `Unknown`.

## Step 2: Allocate the ID

```bash
ls docs/bug-reports | grep -oE '^BUG-[0-9]+' | sort -t- -k2 -n | tail -1
```

Take the next number, zero-padded to 3. The slug is 2–5 kebab-case words for
the **symptom**, e.g. `BUG-012-items-list-blank-dark`. Skim the existing titles
first. If this is the same bug, resume that one instead.

## Step 3: Write bug.md with what's known

Status `Open`. Pick the severity from the table in
`docs/bug-reports/README.md`. If the bug loses local data or shows one user
another user's data, it's **Critical**.

````md
# BUG-NNN · <Short symptom>

> **Status:** Open · **Severity:** <Critical|High|Medium|Low> · **Reported:** YYYY-MM-DD · **Reported by:** <name or —>
> **Fix checklist:** [fix.md](fix.md)

## Summary

<One or two sentences in plain words: what's broken, and for whom.>

## Where

- **Screen:** <e.g. Menu → Items → edit sheet>
- **Platform:** <Android / iOS / web> · <OS version> · <device or emulator>
- **Build:** <Expo Go / dev build / release APK / TestFlight> · app version <x.y.z>
- **Environment:** <demo mode on/off · API URL · light/dark theme>

## Steps to reproduce

1. …

## Expected

…

## Actual

<What happens instead: error text, red-box stack, status code, screenshot path.>

## Root cause

<Filled after investigation: [file.js:42](../../../src/…) and why it fails.
Starts with "Hypothesis:" until confirmed.>

## Resolution

<Filled when fixed: what changed, in a sentence or two.>
````

## Step 4: Investigate

Set the status to `Investigating`. Load `frontend-conventions`, then trace the
path from the screen through its module hook, `services/requests/`,
`services/api/` or the `db_*` endpoint. Common culprits in this repo, most of
them traps listed in `CLAUDE.md`:

- **Unstyled component**: the file sits outside `tailwind.config.js` `content`,
  so its classes were never compiled
- **Wrong in one theme only**: a colour changed in `global.css` but not in
  `src/lib/theme.js` (or the reverse), or `useColorScheme()` read the OS
  instead of `useThemeStore`
- **Bold text isn't bold**: `font-bold` instead of a family class
  (`font-sans-bold`)
- **`[Reanimated] Reading from 'value' during component render`**: a
  `transition-*` / `animate-*` class reached native outside
  `Platform.select({ web })`
- **"Text strings must be rendered within a `<Text>` component"**: a
  `count && <X/>` with `count === 0`, or a bare string in a `View`
- **Env change ignored**: `EXPO_PUBLIC_*` is inlined at build time; the bundler
  needs `--clear`, and a release build needs rebuilding
- **"Native module … not found"**: a native dependency was added without a new
  dev build (or the screen was opened in Expo Go)
- **Stale list**: a query key that leaves out an input, or a mutation that
  doesn't invalidate it
- **Whole screen re-renders**: a Zustand store read without a selector
- **Local data missing after an update**: a table changed in `tables/` with no
  migration for devices that already had it, or a table never registered in
  `initDatabase.js`
- **Works in demo mode, fails for real (or the reverse)**: the demo branch in
  `services/requests/` returns a different shape than the API

Fill **Root cause** with the actual lines (`file:line` links) and why they
fail. If you can't confirm it, write it as `Hypothesis:` and say what would
confirm it. **Never present a guess as the cause.**

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
- [ ] Checked on the other platform, and in the other theme
- [ ] <neighbouring flow that shares the changed code>

## Wrap-up

- [ ] `npx expo-doctor@latest` passes
- [ ] `npx expo export --platform android --clear` bundles
- [ ] The steps in bug.md no longer reproduce, on a device or emulator
- [ ] Changelog entry added (`type: fixed`, `ref: BUG-NNN`), or skipped because the bug never shipped
- [ ] `bug.md` status set to `Fixed`, Resolution filled
````

Drop lines that don't apply, such as the other-platform check for a bug in
`Platform.select({ ios })` code.

## Step 6: Hand off

Report the root cause (or best hypothesis), the planned fix, severity, and
paths. **Ask before fixing** unless the user already told you to fix it. While
fixing, set the status to `Fixing` and tick items as they land. When done:

- set the status to `Fixed` and fill **Resolution**
- add a changelog entry through the `changelog` skill (`type: fixed`,
  `ref: BUG-NNN`), **unless the bug came from a change that hasn't been
  published yet**. Users never saw that bug, so there's nothing to announce.
- leave `Verified` for the user or QA to set once they've confirmed it on a
  real device
