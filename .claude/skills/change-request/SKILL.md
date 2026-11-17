---
name: change-request
description: Record a change request. Creates docs/change-requests/CR-NNN-<slug>/ with request.md (who asked, today vs requested behaviour, why, scope, impact, size, approval) and checklist.md (build steps, acceptance criteria, sign-off). Use AUTOMATICALLY, without being asked, before changing anything that ALREADY EXISTS under front/ or back/ — updating, tweaking, or removing an existing module, page, field, or flow, or ADDING A NEW FEATURE ONTO an existing module or a finished plan/CR — whoever asked (the user, a client, a boss). Fully new modules go to plan-doc; broken things go to bug-report. Also use when the user runs /change-request or names a CR-NNN id to resume.
argument-hint: "<what they want changed> | CR-NNN"
---

# Change request

Captures a change to something that already exists: what was asked for, what it would take, and
how everyone will know it's done. Output lives in `docs/change-requests/CR-NNN-<slug>/`.

Request: **$ARGUMENTS** (when this runs automatically, the request is the user's message)

## When this runs on its own

Write a CR automatically, before any code, whenever the request touches something the app
**already has**, even if nobody says "change request":

- updating, tweaking, renaming, or removing an existing module, page, field, column, or flow
- adding a **new feature onto an existing one**: a new field on Users, an export button on Roles,
  a filter on an existing list
- a follow-up to a plan or CR that's already `Done`. Write a new CR and put the old ID under
  **Related**.

Route the rest elsewhere: a fully new module or feature with no existing home → **`plan-doc`**;
something that should work and doesn't → **`bug-report`**. If the request belongs to a CR that's
still open, resume it (Step 1) instead of starting another.

A CR is **the ask and its approval**, written so the requester can read the top half. A plan is
**how we'll build it**. Small CRs carry their build steps in their own checklist. A large one (schema
redesign, size `L`/`XL`) also gets a plan through the `plan-doc` skill, and the two
link each other. A **fully new** module isn't a CR at all; it's a plan.

## Step 1: Resume or new?

- **Existing ID or slug**: open the folder, read both files, and continue. That can mean recording
  approval, ticking items, or moving the status.
- **New**: you need **what they want** and **who asked**. When the user asks directly, the
  requester is the user (git `user.name`) unless they name someone else. Fill **Today** from the
  code yourself. Ask once only for what you can't work out (why, deadline, a named client), and
  mark the rest `TBD` rather than blocking on it.

## Step 2: Allocate the ID

```bash
ls docs/change-requests | grep -oE '^CR-[0-9]+' | sort -t- -k2 -n | tail -1
```

Take the next number, zero-padded to 3. The slug is 2–5 kebab-case words, e.g.
`CR-003-department-field`.

## Step 3: Assess the impact

Read the code it touches, enough to fill **Impact** honestly. Load `frontend-conventions` /
`backend-conventions` for the sides involved. Flag each of these explicitly:

- **Schema change**: new columns or tables mean a migration.
- **New permission**: it has to be seeded and granted, or nobody but the Owner sees it.
- **Different behaviour for existing users**: this is a breaking change, and it will make the
  release a `major`.
- **Who gets it**: which role or permission should see it, and whether it touches the Owner
  account or role (hidden from Users and Roles).

Size: `S` (half a day or less) · `M` (1–2 days) · `L` (3–5 days) · `XL` (more than a week, so split
it or write a plan).

## Step 4: Write both files

Status `Requested`. Write **Requested change**, **Today**, **Why**, and **Acceptance criteria** in
plain language the requester understands, with no file paths or jargon. Technical detail belongs
in **Impact** and in the checklist.

`docs/change-requests/CR-NNN-<slug>/request.md`:

````md
# CR-NNN · <Title>

> **Status:** Requested · **Requested:** YYYY-MM-DD · **Requested by:** <name, company> · **Size:** <S|M|L|XL>
> **Checklist:** [checklist.md](checklist.md) · **Plan:** <PLAN-NNN or —> · **Related:** <the PLAN/CR it extends, or —>

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
| Screens | <pages affected> |
| Data | <new fields / tables; migration needed?> |
| Permissions | <new permission? which roles get it?> |
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

- [ ] `cd back && npm run lint` passes
- [ ] `cd front && npm run lint && npm run build` passes
- [ ] Migration applied, or noted as pending for deploy
- [ ] Changelog entry added (`ref: CR-NNN`)
- [ ] Requester shown the result and signed off
- [ ] `request.md` status set to `Done`
````

Drop lines that don't apply.

## Step 5: Hand off

Report the paths, the size, anything flagged in Step 3, and the open questions. **Don't implement
an unapproved CR.**

- **The user asked for the change to be made** ("add a department field to Users"): that is the
  approval. Fill the Approval row (`Approved` · the user · today · "asked directly") and carry on
  building, unless Step 3 flagged a breaking change or an open question blocks the build, in which
  case ask first.
- **It's someone else's ask, or the user only asked to log it**: ask whether it's approved.
- **Approved**: set the status to `Approved` and fill the Approval row. While building, set it to
  `In progress` and tick items as they land.
- **Done**: when every checklist item is ticked, set the status to `Done` and **immediately** add a
  changelog entry through the `changelog` skill (`ref: CR-NNN`), before reporting done. A
  finished checklist always gets its entry. Use `major` impact if Impact → Existing users said the behaviour changes.
- **Rejected**: set the status to `Rejected` and put the reason in the Approval row.
