---
name: new-mobile-module
description: Scaffold a complete list/detail module in the Expo staff app (app/) — the list screen (ScreenHeader, stat row, DataList card, FilterBar, ListFooter, Fab), its use<Module>Module state hook, the create/edit FormSheet, its data source (in-memory, API via services/api + services/requests with demo-mode fixtures, or local SQLite via a table + db_ endpoints), the SCREEN_NAVIGATION route, stack registration, and the row under the Menu tab. Use whenever the user asks to add, create, or scaffold a new module, screen, list, or CRUD feature in the mobile app (e.g. "add a Clips screen to the app", "new Courts screen in the staff app"). Also use to add just the data layer or just the screen of such a module. For the web Admin portal and API half use new-module instead (it runs first when the module needs a new table or endpoint).
argument-hint: "<module name> [fields…]"
---

# New mobile module scaffold

All paths below are relative to `app/`.

Builds one entity's full vertical slice — data source to Menu row — to this
repo's conventions. `src/Screens/Example/` is the reference implementation and
the starting point: a new module **is** a copy of it, renamed, with its
in-memory array swapped for a real data source.

Request: **$ARGUMENTS**

## Step 0 — Load the conventions

Read before writing anything (they override this skill if they disagree):

- The **`mobile-conventions`** skill, then its references
  (`architecture-and-traps.md`, `code-conventions.md`, `data-layer.md`)
- [module-pattern.md](../mobile-conventions/references/module-pattern.md) — the screen,
  row and sheet anatomy, and the per-module conversion checklist
- [engineering-checklist.md](../mobile-conventions/references/engineering-checklist.md) — §2,
  §3, §5 and §6 in particular
- All three files in `src/Screens/Example/`

## Step 1 — Pin the spec, then stop

Fill this table and **show it to the user before writing code**. Never guess
the field list — if the user gave only a module name, ask for the fields.

| Slot | Meaning | Example |
| --- | --- | --- |
| Entity | PascalCase singular — sheet, hook names | `Product` |
| Entities | PascalCase plural — folder, route, title | `Products` |
| entities | camelCase plural — query key, api/requests file, response key | `products` |
| entityId | the stable ID field — a UUID, **never** the SQLite rowid or an array index | `productId` |
| Icon | one lucide-react-native icon — Menu row, stat card, sheet chip, empty state | `Box` |
| Data source | `memory` (prototype, like the example) · `api` · `local` (SQLite) · `local+api` | `api` |
| API base | only for `api` — the server path | `/api/v1/admin/products` |
| Table | only for `local` — SQLite table, lowercase plural | `products` |
| Demo mode | only for `api` — resolve from fixtures when `IS_DEMO` is on, or not at all | `fixtures` |

Plus a **field table** — for each field: name, type, required?, the control
(`Input`, multiline `Input` with a counter, `StatusToggle`, …), max length, and
default. Every module also gets `entityId` and `status` (`"Active"` /
`"Inactive"`) automatically; a `local` table also gets `id`, `isSync`,
`createdAt`, `updatedAt`.

### Stop and ask if

- The field list is missing or ambiguous (types, which are required).
- The data source is `api` and the endpoint doesn't exist yet. Build it first
  with `new-module` (back end + web), then read its controller for the exact
  keys. Every response is `{ success, message, data: { … } }` — **don't invent
  a different envelope**.
- The data source is `local+api`. Build `local` first, then the API hooks, and
  write the sync strategy (when unsynced rows are pushed, which side wins a
  conflict) as a plan with `plan-doc`. This skill doesn't scaffold sync.
- A field needs a control the kit doesn't have (date, select, photo). Check
  `components/` first (`DateRangePicker`, `useCamera`), then RNR via the CLI.
  A new dependency is the user's call.
- The user wants it as a bottom tab. Modules are Menu rows by design
  (module-pattern.md §3); confirm it's deliberate.

## Step 2 — Build in this order

Data first — the hook and sheet are shaped by it. Skip the rows your data
source doesn't use.

| # | File | When | What |
| --- | --- | --- | --- |
| 1 | `src/store/database/tables/<table>.table.js` | `local` | `CREATE TABLE IF NOT EXISTS` |
| 2 | `src/store/database/initDatabase.js` | `local` | register the table, add its indexes |
| 3 | `src/store/database/endpoints/<table>.endpoints.js` | `local` | `db_get…`, `db_insert…`, `db_update…`, `db_delete…` |
| 4 | `src/services/api/<entities>.js` | `api` | one call per function, returns `response.data` |
| 5 | `src/constants/demo.js` | `api` + fixtures | `DEMO_<ENTITIES>` in the API's row shape |
| 6 | `src/services/requests/<entities>.js` | `api` | `useGet…`, `useCreate…`, `useUpdate…`, `useDelete…` |
| 7 | `src/hooks/useDebounce.js` | `api`, if missing | debounce for server-side search |
| 8 | `src/Screens/<Entities>/use<Entities>Module.js` | always | all state; unwraps the data once |
| 9 | `src/Screens/<Entities>/<Entity>FormSheet.js` | always | owns its `FormSheet` |
| 10 | `src/Screens/<Entities>/index.js` | always | layout only |
| 11 | `src/constants/navigations.js` | always | `SCREEN_NAVIGATION.Modules.<Entities>` |
| 12 | `src/Navigation/index.js` | always | `<Stack.Screen>` in the authenticated stack |
| 13 | `src/Screens/Home/Settings/index.js` | always | a row in the Modules section |

Steps 8–10 start as `cp -R src/Screens/Example src/Screens/<Entities>` and
then change. Templates for every step, using `Product` as the worked example:
**[references/templates.md](references/templates.md)**.

## Step 3 — Verify before reporting done

Run these and report actual output; don't claim success on unrun checks.

```bash
npx expo-doctor@latest
npx expo export --platform android --clear
```

Read the export's asset list: it should not have grown, unless the module added
an asset on purpose.

Then walk [references/checklist.md](references/checklist.md). A bundle proves
the module *resolves*, not that it *behaves*. Say plainly which device checks
(light/dark, ~320px, tablet, the create-edit-delete loop) you could not run.

Finally, queue the release entry through the **`changelog`** skill
(`type: added`, `impact: minor`). A new module is one entry, not one per file.

## Hard rules (violating any of these means the module is wrong)

- **Copy the example, don't rebuild it** — `ScreenHeader`, `DataList`,
  `DataListRow`, `StatCard`, `FilterBar`, `EmptyState`, `ListFooter`, `Fab`,
  `FormSheet`, `SectionLabel`, `StatusToggle` from `@/components/pattern`.
- **The screen is layout-only** — all state, data and handlers live in
  `use<Entities>Module.js`. The screen imports no React Query hook directly.
- **Screens and hooks import from `services/requests/`, never `services/api/`.**
- **Unwrap the response once**, in the module hook. The screen sees plain
  arrays and numbers.
- **Query keys include every input** — `["products", { page, pageSize, search, status }]`.
  Mutations invalidate `["products"]` in `onSuccess`, in the requests file.
- **Server-side search and paging for `api`**, with search debounced (~300ms).
  Filters and search reset `page` to 1.
- **Demo branches return exactly the API's shape**, inside `queryFn` /
  `mutationFn`. Never in `api/`.
- **`DataList` is the root scroller.** No `ScrollView` around it; stat cards in
  `ListHeaderComponent`; `ScreenHeader` and `Fab` are its siblings; `Fab` gets
  `FAB_CLEARANCE`.
- **Three states** — loading, error (with retry), and empty, which says
  something different when a search or filter is active. `DataList`'s `empty`
  slot shows during loading too, so the screen picks which one to render there.
- **The sheet owns its `FormSheet`.** Props are `{ open, onClose, onSubmit, entity, saving }`.
  It hydrates the draft field by field (`?? ""` for anything nullable), never
  `{ ...entity }`; keeps the dirty-check disable; and disables save while
  `saving`.
- **Destructive actions confirm first** (`Alert.alert` with a `destructive`
  button, as in the example).
- **Route by constant** — `SCREEN_NAVIGATION.Modules.<Entities>`, registered in
  the authenticated stack, reached from a Menu row. `ScreenHeader` gets
  `onBack={navigation.goBack}`.
- **SQLite** — table registered in `initDatabase.js`; `db_` prefix; `?` binding;
  UUID `entityId`; `status` stored as the UI shows it, soft delete to
  `"Deleted"`, excluded from every read.
- **Tokens, never hex** — no shadow, no gradient, no green button, no
  `font-bold`, no `transition-*` reaching native.

## Partial builds

- **"Just the data layer for X"** → steps 1–7, then check the module hook
  contract in `templates.md` so the screen can consume it later.
- **"Just the screen for X"** → steps 8–13, after reading the existing
  `requests/` file or `db_*` endpoints to confirm the real names and shape.
- **"Add a field to an existing module"** → the table (plus a migration if the
  table is already on devices — see `src/store/database/migrations/README.md`),
  the endpoints' SQL, the demo fixtures, the sheet's `BLANK`, `toDraft`, dirty
  check, field and payload, then the row's `subtitle` if it should show — in
  that order.
