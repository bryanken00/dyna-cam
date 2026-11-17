# Final verification checklist

Walk this before reporting the module done, together with the per-module
conversion checklist in
[module-pattern.md §7](../../mobile-conventions/references/module-pattern.md), which covers the
screen, row and sheet anatomy. Anything unchecked gets reported to the user
with the reason — don't silently drop it.

## Data — `local`

- [ ] `tables/<table>.table.js` uses `CREATE TABLE IF NOT EXISTS`, with `id`
      rowid, a `UNIQUE NOT NULL` UUID `entityId`, `status` defaulting to
      `'Active'`, `isSync`, `createdAt`, `updatedAt`
- [ ] Table registered in `initDatabase.js`, with an index on `status` (and on
      anything else the screen filters or sorts by)
- [ ] No migration added for a brand-new table; a change to a table already on
      devices has one, registered in `migrations/index.js` and documented in
      `migrations/README.md`
- [ ] Every endpoint is `db_`-prefixed, binds with `?`, and returns plain data
- [ ] Every read excludes `status = 'Deleted'`; delete is a soft delete

## Data — `api`

- [ ] `services/api/<entities>.js` — one call per function, returns
      `response.data`, no try/catch, uses `createAxiosInstanceWithInterceptor`
- [ ] Paths and the response shape were confirmed against the server, not
      assumed
- [ ] `services/requests/<entities>.js` — `useQuery` key includes every input;
      `placeholderData: keepPreviousData` on the paged list
- [ ] Each mutation invalidates `{ queryKey: ["<entities>"] }` and toasts in
      `onSuccess` / `onError`
- [ ] Demo branches (if any) sit inside `queryFn` / `mutationFn` and return the
      API's exact shape; fixtures in `constants/demo.js` include a row with a
      `null` optional field
- [ ] Search is debounced (~300ms) before it reaches the query key

## Module hook

- [ ] All state, data and handlers live in `use<Entities>Module.js`; the
      response is unwrapped there and nowhere else
- [ ] Returns the full contract (`isLoading`, `isError`, `isRefreshing`,
      `refresh`, `saving` included, even when they're constants)
- [ ] Search and filters reset `page` to 1; deleting the last row on a page
      can't strand the user on an empty one
- [ ] Nullable fields can't reach `.toLowerCase()` / `.trim()`
- [ ] Stats are true across all records, not one page; cards that can't be
      filled were dropped

## Screen and sheet

- [ ] The screen imports no React Query hook, `api/` function, or `db_*`
      endpoint directly
- [ ] The `empty` slot shows loading, then error (with a retry) or empty — and
      the empty message changes when a search or filter is active
- [ ] Pull-to-refresh and the `FilterBar` refresh button both call `refresh`
- [ ] The sheet hydrates through `toDraft` (never `{ ...entity }`), maps its
      payload explicitly, and disables save while `saving` or not dirty
- [ ] Every text input with a counter also has `maxLength`
- [ ] Delete confirms first with a `destructive` button

## Wiring

- [ ] `SCREEN_NAVIGATION.Modules.<Entities>` added, with a name no other route
      uses
- [ ] `<Stack.Screen>` registered in the **authenticated** stack in
      `Navigation/index.js`
- [ ] Row added to the Modules section in `Screens/Home/Settings/index.js` —
      not a new tab
- [ ] `ScreenHeader` has `onBack={navigation.goBack}`

## Style

- [ ] Only `@/components/pattern`, `@/components/ui/*` and lucide icons; no new
      dependency without the user's say-so
- [ ] No hardcoded hex, shadow, gradient, green button, `font-bold`, or
      `transition-*` / `animate-*` reaching native
- [ ] Every string is inside RNR's `<Text>`; no `count && <X/>` with a number

## Release

- [ ] One entry in `docs/changelog/unpublished/` (via the `changelog` skill):
      `type: added`, `impact: minor`. Dev notes name any new table, new
      `EXPO_PUBLIC_*` variable, or new native dependency
- [ ] If this module created `hooks/useDebounce.js`, update the "Search is not
      debounced" row in
      [engineering-checklist §10](../../mobile-conventions/references/engineering-checklist.md)
      to say the module hooks debounce and `FilterBar` itself still doesn't

## Commands

```bash
npx expo-doctor@latest                       # 20/20 expected
npx expo export --platform android --clear   # bundles; read the asset list
```

There is no test runner, linter or formatter in this repo. Don't invent
`npm test`.

## Report

State what was created (file list), what doctor and the export actually said,
and which device checks you could not run: light **and** dark, ~320px width,
a tablet, and the full create → edit → delete loop on Android and iOS.
