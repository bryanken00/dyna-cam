# Change requests

Changes to something that already exists, including new features added onto an existing module
or a finished plan/CR, whoever asked for them. One folder per request. Claude creates one
automatically (or run `/change-request <what they want>`). Each `CR-NNN-<slug>/` folder holds:

- `request.md`: who asked, what they want vs how it works today, why, scope, impact, size,
  approval. The top half is written so the requester can read it.
- `checklist.md`: build steps, the acceptance criteria to check, and sign-off

Statuses: `Requested` → `Approved` → `In progress` → `Done` (or `Rejected`).

A CR is **the ask and its approval**. Small CRs carry their build steps in their own checklist.
Big ones (schema redesign, several days' work) also get a plan in
[`../plans/`](../plans/), and the two link each other. Shared conventions:
[`../README.md`](../README.md).
