# Change requests

Changes asked for by a client, a manager, or another stakeholder, one folder
per request. Create one with `/change-request <what they want>`. Each
`CR-NNN-<slug>/` folder holds:

- `request.md`: who asked, what they want vs how it works today, why, scope,
  impact, size, approval. The top half is written so the requester can read it.
- `checklist.md`: build steps, the acceptance criteria to check, and sign-off

Statuses: `Requested` → `Approved` → `In progress` → `Done` (or `Rejected`).

A CR is **the ask and its approval**. Small CRs carry their build steps in
their own checklist. Big ones (new module, local-schema redesign, a new native
dependency, several days' work) also get a plan in [`../plans/`](../plans/),
and the two link each other. Shared conventions: [`../README.md`](../README.md).
