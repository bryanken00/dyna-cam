# Module templates — steps 1–13

Worked example: a **Products** module. Rename throughout:

| In the templates | Becomes |
| --- | --- |
| `Product` / `Products` | Entity / Entities |
| `product` / `products` | entity / entities (also the table, query key and response key) |
| `productId` | entityId |
| `Box` | Icon |
| `/api/v1/admin/products` | API base |
| `name`, `description`, `status` | the field table |

Skip the sections your data source doesn't use. `memory` modules need only
§8a's renames plus §9–§13.

---

## 1. Table — `src/store/database/tables/products.table.js` (`local`)

```js
import db from "../db";

/**
 * products — one row per product in the catalogue.
 *
 * Follows example.table.js: idempotent CREATE (this runs on every start), a
 * local rowid plus a UUID `productId` for anything that leaves the device, an
 * `isSync` flag, and TEXT timestamps.
 *
 * `status` is stored exactly as the UI shows it ("Active" / "Inactive"). Soft
 * delete is "Deleted" — a value the UI never offers, so it can't collide with
 * a status the user picked.
 */
export const createProductsTable = () => {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS products (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      productId   TEXT    UNIQUE NOT NULL,
      name        TEXT    NOT NULL,
      description TEXT,
      status      TEXT    NOT NULL DEFAULT 'Active',
      isSync      INTEGER DEFAULT 0,
      createdAt   TEXT    DEFAULT (datetime('now')),
      updatedAt   TEXT
    )
  `);
};

export const initProductsTable = () => {
  createProductsTable();
};
```

## 2. Register it — `src/store/database/initDatabase.js` (`local`)

```js
import { initProductsTable } from "./tables/products.table";

// in initIndexes(): every read filters on status
db.execSync(
  `CREATE INDEX IF NOT EXISTS idx_products_status
   ON products(status)`,
);

// in initDatabase(), under ── Tables ──
initProductsTable();
```

A table that isn't registered here is never created, and every `db_*` call
against it throws.

## 3. Endpoints — `src/store/database/endpoints/products.endpoints.js` (`local`)

```js
import db from "../db";
import { generateUUID } from "../helpers/uuid";

/**
 * Products endpoints — one SQL statement per function, `db_` prefix, `?`
 * binding, plain data back. See example.endpoints.js for the bulk-write and
 * sync helpers (db_markItemsSynced, db_replaceAllItems) when this table
 * starts syncing with a server.
 */

// ── Reads ────────────────────────────────────────────────────────────────────

/** Every product that isn't soft-deleted, newest first. */
export const db_getProducts = () => {
  return db.query(
    `SELECT * FROM products WHERE status != 'Deleted' ORDER BY createdAt DESC`,
  );
};

export const db_getProductById = (productId) => {
  return db.queryFirst(`SELECT * FROM products WHERE productId = ?`, [
    productId,
  ]);
};

// ── Writes ───────────────────────────────────────────────────────────────────

/** Returns the generated (or supplied) productId. */
export const db_insertProduct = (product) => {
  const productId = product.productId || generateUUID();

  db.run(
    `INSERT INTO products (productId, name, description, status, isSync)
     VALUES (?,?,?,?,0)`,
    [productId, product.name, product.description ?? null, product.status || "Active"],
  );

  return productId;
};

export const db_updateProduct = (productId, product) => {
  const result = db.run(
    `UPDATE products
     SET name = ?, description = ?, status = ?, isSync = 0, updatedAt = datetime('now')
     WHERE productId = ?`,
    [product.name, product.description ?? null, product.status, productId],
  );
  return result.changes;
};

/** Soft delete — keeps the row so a later sync can reconcile it. */
export const db_deleteProduct = (productId) => {
  const result = db.run(
    `UPDATE products SET status = 'Deleted', isSync = 0, updatedAt = datetime('now')
     WHERE productId = ?`,
    [productId],
  );
  return result.changes;
};
```

## 4. API — `src/services/api/products.js` (`api`)

Mirrors `services/api/auth.js`. Confirm every path and verb against the server.

```js
/**
 * API — Products
 * All functions return response.data (no side effects, no store access).
 */
import { createAxiosInstanceWithInterceptor } from "./axios";

const axiosDefault = createAxiosInstanceWithInterceptor("data");

const BASE = "/api/v1/admin/products";

/** params: { page, pageSize, search, status } — undefined keys are dropped */
export const getProductsApi = async (params = {}) => {
  const response = await axiosDefault.get(BASE, { params });
  return response.data;
};

export const createProductApi = async (payload) => {
  const response = await axiosDefault.post(BASE, payload);
  return response.data;
};

export const updateProductApi = async (productId, payload) => {
  const response = await axiosDefault.put(`${BASE}/${productId}`, payload);
  return response.data;
};

export const deleteProductApi = async (productId) => {
  const response = await axiosDefault.delete(`${BASE}/${productId}`);
  return response.data;
};
```

## 5. Demo fixtures — `src/constants/demo.js` (`api` + fixtures)

Append to the file, and change its header comment from "`services/requests/auth.js`"
to "`services/requests/`", since it now has more than one consumer.

```js
/** Product rows, shaped exactly like one entry of the API's list response. */
export const DEMO_PRODUCTS = [
  { productId: "demo-product-1", name: "Aluminium Bracket", description: "Structural mounting part", status: "Active" },
  { productId: "demo-product-2", name: "Copper Wire Spool", description: "2.5mm, 100m reel", status: "Active" },
  { productId: "demo-product-3", name: "Rubber Gasket", description: null, status: "Inactive" },
];
```

Include at least one row with a `null` optional field — it's the case that
crashes a careless sheet.

## 6. Requests — `src/services/requests/products.js` (`api`)

Mirrors `services/requests/auth.js`: relative imports, a divider per hook,
demo branch inside the `queryFn` / `mutationFn`.

```js
/**
 * Request hooks — Products
 *
 * Side effects live here: toasts and cache invalidation. The api/ layer stays
 * pure. Screens and module hooks import from this file, never from api/.
 *
 * Demo mode: when `IS_DEMO` is on, every hook resolves from
 * `constants/demo.js` without touching the network. Demo writes succeed and
 * save nothing, the same as `useChangePassword`.
 */
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import Toast from "react-native-toast-message";
import { IS_DEMO } from "../../constants";
import { DEMO_PRODUCTS, demoDelay } from "../../constants/demo";
import {
  createProductApi,
  deleteProductApi,
  getProductsApi,
  updateProductApi,
} from "../api/products";

const KEY = "products";

/**
 * Filters and pages the fixtures the way the server would, so demo mode runs
 * the same paths as a real response.
 *
 * ⚠️ Must return exactly what getProductsApi returns: this repo's API wraps
 * every payload as `{ success, message, data: { … } }`, so the fixture does too.
 */
const demoList = ({ page = 1, pageSize = 20, search, status } = {}) => {
  const q = search?.toLowerCase();
  const matches = DEMO_PRODUCTS.filter(
    (p) =>
      (!q || p.name.toLowerCase().includes(q)) &&
      (!status || p.status === status),
  );

  return {
    success: true,
    message: "Products",
    data: {
      products: matches.slice((page - 1) * pageSize, page * pageSize),
      pagination: { total: matches.length },
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// useGetProducts
// ─────────────────────────────────────────────────────────────────────────────
export const useGetProducts = (params = {}) => {
  return useQuery({
    // Every input is in the key, so a new page or search is a new cache entry
    queryKey: [KEY, params],
    queryFn: async () => {
      if (IS_DEMO) {
        await demoDelay();
        return demoList(params);
      }
      return getProductsApi(params);
    },
    // Keep the current page on screen while the next one loads
    placeholderData: keepPreviousData,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// useCreateProduct
// ─────────────────────────────────────────────────────────────────────────────
export const useCreateProduct = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload) => {
      if (IS_DEMO) {
        await demoDelay();
        // Nothing reads a mutation's response in this module yet. If
        // something starts to, return the API's exact shape here.
        return { message: "Product created" };
      }
      return createProductApi(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY] });
      Toast.show({
        type: "success",
        text1: "Product created",
        ...(IS_DEMO && { text2: "Demo mode — nothing was saved" }),
      });
    },
    onError: (error) => {
      Toast.show({
        type: "error",
        text1: "Couldn't create product",
        text2: error.response?.data?.message || "Something went wrong",
      });
    },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// useUpdateProduct
// ─────────────────────────────────────────────────────────────────────────────
export const useUpdateProduct = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ productId, data }) => {
      if (IS_DEMO) {
        await demoDelay();
        return { message: "Product updated" };
      }
      return updateProductApi(productId, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY] });
      Toast.show({
        type: "success",
        text1: "Product updated",
        ...(IS_DEMO && { text2: "Demo mode — nothing was saved" }),
      });
    },
    onError: (error) => {
      Toast.show({
        type: "error",
        text1: "Couldn't update product",
        text2: error.response?.data?.message || "Something went wrong",
      });
    },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// useDeleteProduct
// ─────────────────────────────────────────────────────────────────────────────
export const useDeleteProduct = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (productId) => {
      if (IS_DEMO) {
        await demoDelay();
        return { message: "Product deleted" };
      }
      return deleteProductApi(productId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY] });
      Toast.show({
        type: "success",
        text1: "Product deleted",
        ...(IS_DEMO && { text2: "Demo mode — nothing was saved" }),
      });
    },
    onError: (error) => {
      Toast.show({
        type: "error",
        text1: "Couldn't delete product",
        text2: error.response?.data?.message || "Something went wrong",
      });
    },
  });
};
```

Without demo fixtures, drop the `IS_DEMO` branches, `demoList`, and the
`constants` imports.

## 7. Debounce — `src/hooks/useDebounce.js` (`api`, only if it doesn't exist yet)

```js
import { useEffect, useState } from "react";

/**
 * Returns `value` once it has stopped changing for `delay` ms.
 *
 * For search: bind the input to the raw value so typing stays instant, and
 * give the debounced value to the query, so a request goes out when typing
 * pauses rather than on every keystroke.
 *
 *   const debouncedSearch = useDebounce(search.trim(), 300);
 */
export const useDebounce = (value, delay = 300) => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);

  return debounced;
};

export default useDebounce;
```

## 8. Module hook — `src/Screens/Products/useProductsModule.js`

Every variant returns the **same contract**, so §10's screen works for all of
them:

```
pageItems, stats, total, isLoading, isError, isRefreshing, refresh,
search, setSearch, statusFilter, setStatusFilter, showFilters, setShowFilters,
hasActiveFilters, clearFilters, page, pageSize, setPage,
editing, openCreate, openEdit, closeSheet, save, saving, remove
```

### 8a. `memory` and `local` — start from `useExampleModule.js`

Copy it, rename (`useExampleModule` → `useProductsModule`, `itemId` →
`productId`), then:

- **Null-safe search.** A nullable field must not reach `.toLowerCase()`:
  `(r.description ?? "").toLowerCase().includes(q)`.
- **Add the uniform fields** to the return:
  `isLoading: false, isError: false, isRefreshing: false, saving: false`, and
  `refresh` (a no-op for `memory`, `reload` for `local`).

For `local`, replace the `SEED` array and the in-memory writes:

```js
import {
  db_deleteProduct,
  db_getProducts,
  db_insertProduct,
  db_updateProduct,
} from "@/store/database/endpoints/products.endpoints";

// SQLite reads are synchronous, so the first render already has rows.
const [records, setRecords] = useState(() => db_getProducts());
const reload = () => setRecords(db_getProducts());

const save = (draft) => {
  const { productId, ...fields } = draft;
  if (productId) db_updateProduct(productId, fields);
  else db_insertProduct(fields);
  reload();
  setEditing(null);
};

const remove = (productId) => {
  db_deleteProduct(productId);
  reload();
};
```

Filtering and paging stay client-side, as in the example — fine for a local
table of hundreds. For thousands, move them into SQL (`LIKE ?`,
`LIMIT ? OFFSET ?`) with the inputs as endpoint arguments.

### 8b. `api` — server-side search and paging

```js
import { useState } from "react";
import useDebounce from "@/hooks/useDebounce";
import {
  useCreateProduct,
  useDeleteProduct,
  useGetProducts,
  useUpdateProduct,
} from "@/services/requests/products";

/**
 * Module state for Products: search, filter, pagination, the form sheet, and
 * the server data behind them.
 *
 * Search and paging run on the server. Every input is part of the query key,
 * so changing any of them fetches the right page. Typing updates `search` at
 * once, keeping the input responsive; the query only sees it after a 300ms
 * pause.
 *
 * The response is unwrapped here and nowhere else — the screen only ever sees
 * plain arrays and numbers.
 */

const PAGE_SIZE = 20;

export const useProductsModule = () => {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(null); // null = all
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);

  // Form sheet: null = closed, {} = create, {…record} = edit
  const [editing, setEditing] = useState(null);

  const debouncedSearch = useDebounce(search.trim(), 300);

  const query = useGetProducts({
    page,
    pageSize: PAGE_SIZE,
    search: debouncedSearch || undefined,
    status: statusFilter || undefined,
  });
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();

  // ⚠️ Match the shape your server actually returns (data-layer.md →
  // Response shapes). This is the only place that knows it.
  const pageItems = query.data?.data?.products ?? [];
  const total = query.data?.data?.pagination?.total ?? pageItems.length;

  const save = (draft) => {
    const { productId, ...fields } = draft;
    const onSuccess = () => setEditing(null);

    if (productId) {
      updateProduct.mutate({ productId, data: fields }, { onSuccess });
    } else {
      createProduct.mutate(fields, { onSuccess });
    }
  };

  const remove = (productId) =>
    deleteProduct.mutate(productId, {
      // Deleting the only row on the last page would strand you on an empty one
      onSuccess: () => {
        if (pageItems.length === 1 && page > 1) setPage((p) => p - 1);
      },
    });

  // Any filter narrowing the set — drives the Filters button's active state
  const hasActiveFilters = Boolean(statusFilter);

  return {
    // data
    pageItems,
    // Counts across ALL records have to come from the server — one page of
    // rows can't produce them. ⚠️ Read them from wherever your response puts
    // them, or add a stats query, and drop any card you can't fill.
    stats: {
      total,
      active: query.data?.stats?.active,
      inactive: query.data?.stats?.inactive,
    },
    total,
    isLoading: query.isLoading,
    isError: query.isError,
    // Pull-to-refresh only: a page change keeps the old rows on screen
    // (placeholderData) and shouldn't spin the refresh control.
    isRefreshing: query.isRefetching && !query.isPlaceholderData,
    refresh: query.refetch,
    // search + filter
    search,
    setSearch: (v) => {
      setSearch(v);
      setPage(1);
    },
    statusFilter,
    setStatusFilter: (v) => {
      setStatusFilter(v);
      setPage(1);
    },
    showFilters,
    setShowFilters,
    hasActiveFilters,
    clearFilters: () => {
      setStatusFilter(null);
      setPage(1);
    },
    // pagination
    page,
    pageSize: PAGE_SIZE,
    setPage,
    // form sheet
    editing,
    openCreate: () => setEditing({}),
    openEdit: (record) => setEditing(record),
    closeSheet: () => setEditing(null),
    save,
    saving: createProduct.isPending || updateProduct.isPending,
    remove,
  };
};

export default useProductsModule;
```

## 9. Sheet — `src/Screens/Products/ProductFormSheet.js`

Adapted from `ExampleFormSheet.js`, with three changes: the draft is hydrated
field by field through `toDraft`, the payload is mapped explicitly, and a
`saving` prop disables the save button while a write is in flight.

```js
import { Box } from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { FormSheet, SectionLabel, StatusToggle } from "@/components/pattern";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";

const BLANK = { name: "", description: "", status: "Active" };
const DESCRIPTION_MAX = 140;

/**
 * Turns a record into a form draft, field by field. Never `{ ...entity }`: a
 * row can carry `null` (SQLite, JSON) and extra columns (`id`, `isSync`,
 * `createdAt`), and every input below needs a string.
 */
const toDraft = (entity) =>
  entity?.productId
    ? {
        productId: entity.productId,
        name: entity.name ?? "",
        description: entity.description ?? "",
        status: entity.status ?? "Active",
      }
    : BLANK;

/**
 * Create / edit form — `{ open, onClose, onSubmit, entity, saving }`. The
 * sheet owns its own chrome.
 *
 * Save stays disabled until something actually changes, and while a save is
 * in flight so a double tap can't create two records.
 */
const ProductFormSheet = ({ open, onClose, onSubmit, entity, saving = false }) => {
  const isEdit = Boolean(entity?.productId);
  const [draft, setDraft] = useState(BLANK);

  // Reload whenever a different record is opened
  useEffect(() => {
    setDraft(toDraft(entity));
  }, [entity]);

  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));

  const original = toDraft(entity);
  const dirty =
    draft.name.trim() !== original.name ||
    draft.description.trim() !== original.description ||
    draft.status !== original.status;

  const valid = draft.name.trim().length > 0;
  const canSave = dirty && valid && !saving;

  // Only the fields this form owns, with empty optionals sent as null
  const submit = () =>
    onSubmit({
      productId: draft.productId,
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      status: draft.status,
    });

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      icon={Box}
      title={isEdit ? "Edit Product" : "Create New Product"}
      subtitle={
        isEdit ? "Update product information" : "Add a new product to the catalogue"
      }
      footer={
        <>
          <Button variant="outline" onPress={onClose} className="h-12 flex-1">
            <Text>Cancel</Text>
          </Button>
          <Button onPress={submit} disabled={!canSave} className="h-12 flex-1">
            <Text>
              {saving ? "Saving…" : isEdit ? "Update Product" : "Create Product"}
            </Text>
          </Button>
        </>
      }
    >
      <SectionLabel>Details</SectionLabel>

      <View className="gap-4">
        <View className="gap-2">
          <Label nativeID="name">
            <Text className="font-sans-medium text-[13px]">Product name</Text>
          </Label>
          <Input
            aria-labelledby="name"
            value={draft.name}
            onChangeText={set("name")}
            placeholder="e.g. Aluminium Bracket"
            className="h-12"
          />
        </View>

        <View className="gap-2">
          <Label nativeID="description">
            <Text className="font-sans-medium text-[13px]">Description</Text>
          </Label>
          <Input
            aria-labelledby="description"
            value={draft.description}
            onChangeText={set("description")}
            placeholder="Size, material, packaging…"
            multiline
            numberOfLines={3}
            maxLength={DESCRIPTION_MAX}
            className="h-24 py-3"
            style={{ textAlignVertical: "top" }}
          />
          <Text className="text-muted-foreground text-right text-[11.5px]">
            {draft.description.length}/{DESCRIPTION_MAX}
          </Text>
        </View>
      </View>

      <View className="mt-7">
        <SectionLabel>Status</SectionLabel>
        <StatusToggle value={draft.status} onChange={set("status")} />
      </View>

      {!valid ? (
        <Text className="text-muted-foreground mt-4 text-[12.5px]">
          A product name is required before you can save.
        </Text>
      ) : null}
    </FormSheet>
  );
};

export default ProductFormSheet;
```

## 10. Screen — `src/Screens/Products/index.js`

Adapted from `Screens/Example/index.js`: the `empty` slot picks between
loading, error and empty; refresh is wired to the hook; the sheet gets
`saving`. Works unchanged for every data source, because §8 returns the same
contract.

```js
import { useNavigation } from "@react-navigation/native";
import {
  AlertTriangle,
  Archive,
  Box,
  CheckCircle2,
  Plus,
} from "lucide-react-native";
import { Alert, View } from "react-native";
import DotsLoader from "@/components/Loading/DotsLoader";
import ScreenHeader from "@/components/ScreenHeader";
import {
  DataList,
  DataListRow,
  EmptyState,
  Fab,
  FAB_CLEARANCE,
  FilterBar,
  ListFooter,
  StatCard,
  StatusToggle,
} from "@/components/pattern";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/hooks/useTheme";
import ProductFormSheet from "./ProductFormSheet";
import { useProductsModule } from "./useProductsModule";

/**
 * Products — list screen. Layout only: state and data live in
 * useProductsModule. See the mobile-conventions skill, references/module-pattern.md.
 *
 * The header sits OUTSIDE the list so it stays put while the rows scroll.
 * Everything that should scroll goes in `ListHeaderComponent` — DataList is a
 * FlatList and nesting it in a ScrollView breaks virtualisation.
 */
const ProductsScreen = () => {
  const colors = useThemeColors();
  const navigation = useNavigation();
  const m = useProductsModule();

  const confirmDelete = (record) =>
    Alert.alert(
      "Delete product",
      `Delete "${record.name}"? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => m.remove(record.productId),
        },
      ],
    );

  // DataList shows `empty` whenever there are no rows — including while the
  // first page is still loading — so decide here what that slot means now.
  const emptySlot = m.isLoading ? (
    <View className="items-center py-14">
      <DotsLoader color={colors.mutedForeground} />
    </View>
  ) : m.isError ? (
    <EmptyState
      icon={AlertTriangle}
      title="Couldn't load products"
      message="Check your connection and try again."
      action={
        <Button variant="outline" onPress={m.refresh}>
          <Text>Try again</Text>
        </Button>
      }
    />
  ) : (
    <EmptyState
      icon={Box}
      title="No products found"
      message={
        m.search || m.hasActiveFilters
          ? "Try a different search or clear your filters."
          : "Create your first product to get started."
      }
    />
  );

  return (
    <View className="bg-background flex-1">
      <ScreenHeader title="Products" onBack={navigation.goBack} />

      <DataList
        data={m.pageItems}
        keyExtractor={(item) => item.productId}
        onRefresh={m.refresh}
        refreshing={m.isRefreshing}
        // Reserve room so the FAB never covers the pager or the last row
        contentContainerClassName={FAB_CLEARANCE}
        renderItem={({ item, index }) => (
          <DataListRow
            index={(m.page - 1) * m.pageSize + index + 1}
            title={item.name}
            subtitle={item.description}
            status={item.status}
            onPress={() => m.openEdit(item)}
            onMenu={() => confirmDelete(item)}
          />
        )}
        ListHeaderComponent={
          // Drop any card the data source can't fill (see §8b's stats)
          <View className="flex-row flex-wrap gap-3 pb-5">
            <StatCard
              title="Total products"
              value={m.stats.total}
              change="all time"
              icon={Box}
              className="min-w-[45%] flex-1"
            />
            <StatCard
              title="Active"
              value={m.stats.active}
              change="in use"
              icon={CheckCircle2}
              className="min-w-[45%] flex-1"
            />
            <StatCard
              title="Inactive"
              value={m.stats.inactive}
              change="archived"
              icon={Archive}
              className="min-w-[45%] flex-1"
            />
          </View>
        }
        toolbar={
          <FilterBar
            value={m.search}
            onChangeText={m.setSearch}
            placeholder="Filter products…"
            onRefresh={m.refresh}
            refreshing={m.isRefreshing}
            onToggleFilters={() => m.setShowFilters(!m.showFilters)}
            filtersActive={m.showFilters || m.hasActiveFilters}
          >
            {m.showFilters ? (
              <View className="gap-3">
                <StatusToggle
                  value={m.statusFilter ?? "All"}
                  onChange={(v) => m.setStatusFilter(v === "All" ? null : v)}
                  options={[
                    { value: "All", accent: false },
                    { value: "Active" },
                    { value: "Inactive", accent: false },
                  ]}
                />
                {m.hasActiveFilters ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onPress={m.clearFilters}
                    className="self-end"
                  >
                    <Text className="text-muted-foreground text-[12.5px]">
                      Clear all
                    </Text>
                  </Button>
                ) : null}
              </View>
            ) : null}
          </FilterBar>
        }
        empty={emptySlot}
        footer={
          <ListFooter
            page={m.page}
            pageSize={m.pageSize}
            total={m.total}
            noun="product"
            onChangePage={m.setPage}
          />
        }
      />

      <Fab label="New product" icon={Plus} onPress={m.openCreate} />

      <ProductFormSheet
        open={m.editing !== null}
        onClose={m.closeSheet}
        onSubmit={m.save}
        entity={m.editing}
        saving={m.saving}
      />
    </View>
  );
};

export default ProductsScreen;
```

## 11. Route name — `src/constants/navigations.js`

```js
  Modules: {
    Items: "Items",
    Products: "Products",
  },
```

Route names are global to the stack — a name that matches an existing one
(`Home`, `Login`, `Items`) silently replaces it.

## 12. Register — `src/Navigation/index.js`

```js
import ProductsScreen from "../Screens/Products";

// in the authenticated stack, next to the Items screen
<Stack.Screen
  name={SCREEN_NAVIGATION.Modules.Products}
  component={ProductsScreen}
/>
```

## 13. Menu row — `src/Screens/Home/Settings/index.js`

Add the icon to the `lucide-react-native` import, then a row to the
`Modules` section's `items`:

```js
{
  title: "Products",
  description: "Manage your product catalogue",
  icon: Box,
  onPress: () => navigation.navigate(SCREEN_NAVIGATION.Modules.Products),
},
```

The `useMemo` already depends on `navigation`; a new row needs no new deps.
