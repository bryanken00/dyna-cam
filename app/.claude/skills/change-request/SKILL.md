---
name: change-request
description: Record a client or stakeholder change request. Creates docs/change-requests/CR-NNN-<slug>/ with request.md (who asked, today vs requested behaviour, why, scope, impact, size, approval) and checklist.md (build steps, acceptance criteria, sign-off). Use when the user runs /change-request, or says a client, boss, or stakeholder wants something added, changed, or removed in the app and asks to log, record, or write it up. Also use to resume a CR by its CR-NNN id.
argument-hint: "<what they want changed> | CR-NNN"
---

# Change request

Captures what someone outside the dev team asked for, what it would take, and
how everyone will know it's done. Output lives in
`docs/change-requests/CR-NNN-<slug>/`.

Request: **$ARGUMENTS**

A CR is **the ask and its approval**, written so the requester can read the top
half. A plan is **how we'll build it**. Small CRs carry their build steps in
their own checklist. A large one (new module, local-schema redesign, a new
native dependency, size `L`/`XL`) also gets a plan through the `plan-doc`
skill, and the two link each other.

## Step 1: Resume or new?

- **Existing ID or slug**: open the folder, read both files, and continue. That
  can mean recording approval, ticking items, or moving the status.
- **New**: you need **what they want** and **who asked**. Ask once for
  whatever's missing: requester (name, company), how it works today vs what
  they want, why (the problem it solves), which platforms it matters on, and
  any deadline. Mark unknowns `TBD`.

## Step 2: Allocate the ID

```bash
ls docs/change-requests | grep -oE '^CR-[0-9]+' | sort -t- -k2 -n | tail -1
```

Take the next number, zero-padded to 3. The slug is 2–5 kebab-case words, e.g.
`CR-003-item-photos`.

## Step 3: Assess the impact

Read the code it touches, enough to fill **Impact** honestly. Load
`frontend-conventions`. Flag each of these explicitly:

- **Needs a new build**: a new native module, config plugin, or `app.json`
  change can't reach existing installs until users update from the store. Say
  so, because it sets the timeline, not just the effort.
- **New OS permission** (camera, photos, location, notifications): users see a
  new prompt, `app.json` gains its usage text, and store review may ask about
  it.
- **Local schema change**: a table already on devices needs a migration, not
  just an edit to its `tables/` file.
- **Server dependency**: does it need an API endpoint that doesn't exist yet?
  Who builds it, and should demo mode fake it meanwhile?
- **Different behaviour for existing users**: this is a breaking change, and it
  will make the release a `major`.

Size: `S` (half a day or less) · `M` (1–2 days) · `L` (3–5 days) · `XL` (more
than a week, so split it or write a plan).

## Step 4: Write both files

Status `Requested`. Write **Requested change**, **Today**, **Why**, and
**Acceptance criteria** in plain language the requester understands, with no
file paths or jargon. Technical detail belongs in **Impact** and in the
checklist.

`docs/change-requests/CR-NNN-<slug>/request.md`:

````md
# CR-NNN · <Title>

> **Status:** Requested · **Requested:** YYYY-MM-DD · **Requested by:** <name, company> · **Size:** <S|M|L|XL>
> **Checklist:** [checklist.md](checklist.md) · **Plan:** <PLAN-NNN or —>

## Requested change

<In the requester's terms: what they want to be able to do.>

## Today

<How it works now.>

## Why

<The problem this solves or the business value. Quote the requester if it helps.>

## Scope

**In**

- …

**Out**

- …

## Acceptance criteria

Plain statements the requester can check themselves in the app:

- …

## Impact

| Area | Detail |
| --- | --- |
| Screens | <screens affected> |
| Data | <new fields; API endpoint needed? local table change, migration needed?> |
| Build | <new native module, plugin, or permission? if yes, it ships only with a store update> |
| Existing users | <anything that works differently for them; if yes, it's a breaking change> |
| Size | <S/M/L/XL, one line on why> |

## Open questions

- [ ] …

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Pending | — | — | — |
````

`docs/change-requests/CR-NNN-<slug>/checklist.md`:

````md
# CR-NNN · <Title> — Checklist

> Request: [request.md](request.md)

## Before starting

- [ ] Approved (see request.md → Approval)
- [ ] Open questions answered

## Build

- [ ] …

## Acceptance

<One checkbox per criterion in request.md, checked in the running app.>

- [ ] …

## Wrap-up

- [ ] `npx expo-doctor@latest` passes
- [ ] `npx expo export --platform android --clear` bundles
- [ ] New native module → `npx expo prebuild --clean` and a new dev build
- [ ] Local schema change → migration added for tables already on devices
- [ ] Checked on Android **and** iOS, in light **and** dark
- [ ] Changelog entry added (`ref: CR-NNN`)
- [ ] Requester shown the result and signed off
- [ ] `request.md` status set to `Done`
````

Drop lines that don't apply.

## Step 5: Hand off

Report the paths, the size, anything flagged in Step 3, and the open questions.
**Don't implement an unapproved CR.** Ask the user whether it's approved.

- **Approved**: set the status to `Approved` and fill the Approval row. While
  building, set it to `In progress` and tick items as they land.
- **Done**: set the status to `Done` and add a changelog entry through the
  `changelog` skill (`ref: CR-NNN`). Use `major` impact if Impact → Existing
  users said the behaviour changes.
- **Rejected**: set the status to `Rejected` and put the reason in the Approval
  row.
