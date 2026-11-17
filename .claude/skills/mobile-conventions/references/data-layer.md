# Data Layer

How data reaches a screen: the network (`services/`), the session
(`store/*.js`), and the device (`store/database/`). Read this before touching
any of them.

---

## `services/api/` vs `services/requests/` — the central convention

```
src/services/
├── api/                  pure calls — take a payload, return response.data
│   ├── axios.js          the instances + interceptors
│   └── <domain>.js       e.g. auth.js
└── requests/             React Query hooks — own every side effect
    └── <domain>.js       same file name as its api/ twin
```

| | `api/<domain>.js` | `requests/<domain>.js` |
| --- | --- | --- |
| Does | one HTTP call per function, returns `response.data` | `useQuery` / `useMutation` around the `api/` function |
| Owns | nothing else | toasts, store writes, invalidation, demo mode |
| try/catch | never — errors propagate to React Query | `onError` |
| Imported by | `requests/` only | screens and module hooks |

**Screens only ever import from `requests/`.** A screen that imports from
`api/` has nowhere to put the toast, and demo mode can't reach it.

### Axios instances

From `services/api/axios.js`:

- `createDeviceAxiosInstance()` — the paired device's calls to
  `/api/v1/app/*`. The request interceptor reads the token from
  `usePairedStore.getState()` and sends `Authorization: App <token>` (plus an
  `Idempotency-Key` on mutations); never pass a token by hand. Create one per
  file at module scope.
- `axiosPair` — no credentials, for `POST /api/v1/pair/app` only.

```js
// services/api/session.js
import { createDeviceAxiosInstance } from "./axios";

const axiosDevice = createDeviceAxiosInstance();

export const getDeviceSessionApi = async () => {
  const response = await axiosDevice.get("/api/v1/app/session");
  return response.data;
};
```

### Response shapes

`api/` returns `response.data` — the API's envelope. Every endpoint in this
repo's API (`back/`) replies `{ success, message, data: { … } }`, so the payload
is **one more `.data` hop**: the device's session is `response.data.session`,
a list would be `response.data.<entities>` + `response.data.pagination`. Read the controller in
`back/server/src/controllers/` for the exact keys before writing an unwrap.

Unwrap **once**, in the module hook (or in a `requests/` hook's `onSuccess`),
and return plain arrays and numbers from it, so the screen never knows the
envelope:

```js
const data = query.data?.data ?? null;
const session = data?.session ?? null;
const live = data?.live ?? null;
```

Demo-mode fixtures return the same envelope (see `demoEnvelope()` in
`constants/demo.js`), so the unwrap needs no demo branch.

### The device token

There is no staff sign-in, so none of the web client's Bearer / CSRF /
refresh rules apply (the `/app/*` routes use no cookies). The device
instance's one piece of session logic, in `axios.js`:

- A **401 `TOKEN_INVALID`** carrying the CURRENT token clears the pairing
  (`usePairedStore.unpair`), with a notice for the Pair screen — "The session
  has ended…" if the device already knew it had, else "This device was
  unpaired…". A request from an older pairing can't unpair a newer one.
- **Anything else** — no response, 5xx, 409 — is only an error for the
  screen. The device stays paired.
- **Never log** an axios error or response on these paths: the error's
  `config.headers` holds the token, `POST /pair/app`'s body holds it, and
  `GET /app/session`'s holds the live link's `sig`.

---

## React Query (v5)

`App.js` creates the one `QueryClient`, with defaults: `staleTime` 15s, and
`retry` only for no response or a 5xx (a 4xx is final). Override per query
where it matters — permissions 10 min, pay-code lookups 0, and the paired
queries poll with `refetchInterval` (a saving clip every 3s, courts every
30s, anything every 5s while the API can't be reached).

### Query keys

Hierarchical, and including **every input**:

| Pattern | Key |
| --- | --- |
| List | `["items", { page, search, status }]` |
| One record | `["items", itemId]` |
| Nested | `["items", itemId, "photos"]` |
| Invalidate them all | `{ queryKey: ["items"] }` |
| Session | `["auth", "me"]` |

A key without an input serves stale data when that input changes.

### v5 names

| Want | Use | Not |
| --- | --- | --- |
| First load, nothing to show yet | `isLoading` on a query | — |
| Any fetch in flight (pull-to-refresh spinner) | `isFetching` | `isLoading` |
| A mutation in flight | `isPending` | `isLoading` (v4) |
| Keep the old page on screen while the next loads | `placeholderData: keepPreviousData` | `keepPreviousData: true` (v4) |
| Invalidate | `invalidateQueries({ queryKey: ["items"] })` | `invalidateQueries(["items"])` |
| Wait for data you don't have yet | `enabled: !!itemId` | firing and discarding |
| Infinite scroll | `useInfiniteQuery` | manual page arrays |

### Mutations

Invalidation and toasts belong in the mutation hook's `onSuccess` / `onError`,
not in the screen. Don't call `refetch()` by hand after a write.

```js
export const useDeleteItem = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (itemId) => deleteItemApi(itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["items"] });
      Toast.show({ type: "success", text1: "Item deleted" });
    },
    onError: (error) => {
      Toast.show({
        type: "error",
        text1: "Couldn't delete item",
        text2: error.response?.data?.message || "Something went wrong",
      });
    },
  });
};
```

---

## Demo mode

`EXPO_PUBLIC_DEMO_MODE=true` sets `IS_DEMO`, and every auth hook resolves from
`constants/demo.js` with zero network calls. The bypass lives in `requests/`,
never in `api/`, because `api/` describes the server and a fake response is not
something the server does.

A new request hook that should work in demo mode branches **inside**
`queryFn` / `mutationFn`, and returns **the exact shape the API returns**, so
`onSuccess`, the unwrap and every screen stay identical:

```js
queryFn: async () => {
  if (IS_DEMO) {
    await demoDelay();
    return { items: DEMO_ITEMS, pagination: { total: DEMO_ITEMS.length } };
  }
  return getItemsApi(params);
},
```

Fixtures go in `constants/demo.js`. `EXPO_PUBLIC_*` is
inlined at build time: a release built with demo mode on ships with it on.

---

## Zustand stores (`src/store/`)

- Two stores: `usePairedStore` (the device's pairing: token, device,
  sessionId, whether the session has ended) persists to
  **expo-secure-store** under `paired-app`, because that token is a shared
  device's only credential; `useThemeStore` (theme) persists to AsyncStorage
  under `theme-storage`. Anything secret goes in secure store, never
  AsyncStorage (unencrypted).
- **Server data never goes in a store.** The session is React Query data
  (`["session"]`), polled every 5 s.
- Read with a selector: `usePairedStore((s) => s.token)`. Outside React
  (interceptors), use `getState()`.
- `token` is the only thing that decides whether the device is paired.
  Navigation swaps the whole navigator on it (and on the session's state).
- **Renaming a persist `name`, or changing the persisted shape, resets every
  installed device's saved state** — for `paired-app` that unpairs it. Bump
  the persist `version` and add a `migrate` instead (`paired-app` is on
  version 1: v0 was the Phase C/D venue-wide pairing, dropped on upgrade),
  and record it in the changelog entry's Dev notes.

---

## Local SQLite (`src/store/database/`)

Three folders, one file per table in each:

| Folder | Holds | Runs |
| --- | --- | --- |
| `tables/<table>.table.js` | `CREATE TABLE IF NOT EXISTS` — the initial schema | every startup, from `initDatabase.js` |
| `endpoints/<table>.endpoints.js` | one SQL statement per `db_*` function | when called |
| `migrations/NNN_<what>.js` | a change to a table already on devices | once per device, tracked in `migrations` |

- **A new table is registered in `initDatabase.js`**, or it never gets created.
  Indexes for filtered or sorted columns go in `initIndexes()` there.
- **Initial schema goes in `tables/`, not a migration.** A migration is only for
  a table that is already installed on someone's device. Never edit an applied
  one.
- **`db_` prefix on every endpoint**, so a call site reads as a local hit, not
  a network call.
- **Always bind with `?`**, never interpolate a value into SQL.
- **Endpoints return plain data.** No toasts, store writes or navigation.
- The API is **synchronous** (`query`, `queryFirst`, `run`, `transaction`,
  `prepare` on `db.js`). Bulk writes go in `db.transaction()` with a prepared
  statement, finalized in `finally`.
- **Two IDs**: `id` is the local rowid and never leaves the device; `<entity>Id`
  is a UUID from `helpers/uuid.js`, used for joins and anything sent to a
  server.
- **Timestamps** are `TEXT` from `datetime('now')`.
- **`isSync`**: `0` = created or changed locally, `1` = matches the server.
- **Soft delete** keeps the row so a later sync can reconcile it.

### Status values

Store `status` **exactly as the UI shows it** (`"Active"` / `"Inactive"`), and
soft-delete to a value the UI never offers (`"Deleted"`), excluded from every
read:

```sql
SELECT * FROM products WHERE status != 'Deleted' ORDER BY createdAt DESC
```


### Offline-first

Read SQLite first and treat the network as a refresh, not a prerequisite. A
screen that can't render without a response isn't offline-capable, whatever its
table says.
