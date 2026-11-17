# Auth & State Management

When working with authentication, authorization, or protected routes, follow these patterns.

---

## Tech Stack

- **State:** Zustand with `persist` middleware (localStorage)
- **Permissions:** React Query (`usePermissions` hook) fetching from API
- **Route guards:** `<Auth>` / `<UnAuth>` wrappers + `<ProtectedRoute>` component
- **Tokens:** JWT stored in Zustand, attached via Axios interceptor

---

## Auth Stores — `src/store/authStore.js`

One store for the one portal (Admin). Don't add another.

| Store               | localStorage key                | Fields                                             |
| ------------------- | ------------------------------- | -------------------------------------------------- |
| `useAdminAuthStore` | `${VITE_STORE_KEY}-admin-auth`  | `userData`, `token`, `refreshToken`, `permissions` |

### Store shape

```js
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export const useAdminAuthStore = create(
  persist(
    (set) => ({
      userData: null,
      token: null,
      refreshToken: null,
      permissions: [],
      setToken: (token) => set({ token }),
      setRefreshToken: (refreshToken) => set({ refreshToken }),
      setUserData: (userData) => set({ userData }),
      setUser: (userData) => set({ userData }),
      setPermissions: (permissions) => set({ permissions }),
      reset: () =>
        set({
          userData: null,
          token: null,
          refreshToken: null,
          permissions: [],
        }),
    }),
    {
      name: `${import.meta.env.VITE_STORE_KEY}-admin-auth`,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
```

### Rules

1. Always use `createJSONStorage(() => localStorage)` — never raw `localStorage`.
2. Always include a `reset()` that clears all fields — this is the logout action.
3. `setUser` is an alias for `setUserData` (backward compat). Use `setUserData` in new code.
4. Never store derived data (like "isAdmin") — compute it from `userData.type` or permissions.
5. Every browser-storage key — a persisted store's `name` or a raw `localStorage` key — starts with
   `${import.meta.env.VITE_STORE_KEY}-`, so two apps built from the template on one origin never
   share a session. `vite.config.js` defines it (fallback `app`); in `index.html` it's
   `%VITE_STORE_KEY%`.

---

## Login Flow

1. Call login API → receive `{ success, message, data: { user, token, refreshToken, permissions } }`
2. Store token: `setToken(data.token)`
3. Store refresh token: `setRefreshToken(data.refreshToken.token)`
4. Store user: `setUserData(data.user)`
5. Store permissions: `setPermissions(data.permissions)`
6. Navigate to `/admin/dashboard`

The Axios interceptor reads the token from the store and attaches it as `Authorization: Bearer <token>` on every request.

### Logout

Call `reset()` from the store. This clears localStorage and triggers a re-render — the `<Auth>` guard redirects to login.

```js
const { reset } = useAdminAuthStore();
// On logout button click:
reset();
```

Ending a session also **clears the whole React Query cache** (queries and mutations).
`authStore.js` subscribes to the store and calls `queryClient.clear()` when `token`
goes from set to empty. That covers a manual logout and an expired/revoked token (the axios
interceptor's `handleSessionExpired` → `reset()`), while a token refresh or a login leaves the
cache alone. Don't add `queryClient.clear()` to individual logout handlers — clearing the token is
enough.

The singleton client lives in `src/config/queryClient.js`. Import it from there only in non-React
code; inside components and hooks use `useQueryClient()`.

---

## Route Guards — `src/routes/ValidateAuth.jsx`

Two components that wrap route groups:

```jsx
// Requires token — redirects to login if missing
<Auth store={useAdminAuthStore} redirect="/admin" />

// Requires NO token — redirects to dashboard if logged in
<UnAuth store={useAdminAuthStore} redirect="/admin/dashboard" />
```

### Forced password change

When the login response has `user.mustChangePassword: true` (e.g. the seeded Owner's first
login), `<Auth>` redirects every protected path to `/admin/account-settings`, which shows a
notice above the password form. The backend returns 403 `PASSWORD_CHANGE_REQUIRED` for everything
else until the password is changed. `PasswordSection` clears the flag in `userData` on success, and
the axios interceptor sets it if a 403 with that code arrives mid-session. Don't build a second
guard or bypass — keep `account-settings` routed under `<Auth>`.

A newly created user is always flagged, so the "Temporary password" an admin types is only good
for the first sign-in.

### Sessions

Access tokens last 15 minutes and refresh tokens 7 days. The axios layer renews the access token
on a 401, so pages never handle expiry themselves. Three responses need care:

- **Change password** (`PUT /auth/me/password`) ends every session of the account and returns a
  new one. Store its `token` and `refreshToken.token` (see `PasswordSection.jsx`), or the user is
  signed out a few minutes later.
- **423 `ACCOUNT_LOCKED`** on login means too many wrong passwords. Show the backend's message.
- **401 `INVALID_CREDENTIALS`** from an authenticated form (a wrong "current password") is not an
  expired session; the axios layer does not log the user out for it.

Usage in route files:

```jsx
<Routes>
  {/* Public routes (login) */}
  <Route
    element={<UnAuth store={useAdminAuthStore} redirect="/admin/dashboard" />}
  >
    <Route path="/" element={<Login />} />
  </Route>

  {/* Protected routes */}
  <Route element={<Auth store={useAdminAuthStore} redirect="/admin" />}>
    <Route
      element={
        <BasicLayout navigations={navigations} store={useAdminAuthStore} />
      }
    >
      {/* page routes */}
    </Route>
  </Route>
</Routes>
```

---

## Permission System — `src/hooks/usePermissions.js`

Fetches permissions via React Query (10min stale time). Returns helper functions.

### Permission data shape

```js
{
  permissionId: "perm_users_list",
  module: "users",
  submodule: "list",        // null for top-level modules
  description: "Users list management",
  accessLevel: "write",     // "read" | "write"
  source: "role",
}
```

### Access level hierarchy

`none (0) < read (1) < write (2)`

A user with `write` access implicitly has `read`. Always check for the minimum required level.

### Available helpers

| Function                                         | Returns   | Use case                       |
| ------------------------------------------------ | --------- | ------------------------------ |
| `hasPermission(module, submodule, level)`        | `boolean` | Check specific permission      |
| `hasModuleAccess(module)`                        | `boolean` | Check top-level module access  |
| `hasSubmoduleAccess(module, submodule)`          | `boolean` | Check any access to submodule  |
| `hasAnyPermission([{module, submodule, level}])` | `boolean` | Check if user has ANY of these |
| `getModulePermissions(module)`                   | `array`   | Get all perms for a module     |

### Usage in pages

```js
const { hasPermission } = usePermissions();
const canWrite = hasPermission("users", "list", "write");

// Gate UI elements
{canWrite && <Button>Add User</Button>}

// Gate table row selection
rowSelection={canWrite ? rowSelection : null}
```

---

## ProtectedRoute — `src/components/ProtectedRoute.jsx`

Wraps page components in route definitions. Shows loading spinner while permissions load, 403 screen if denied.

```jsx
<ProtectedRoute module="users" submodule="list" accessLevel="read">
  <UsersPage />
</ProtectedRoute>
```

Props:

| Prop           | Type     | Default              | Description                     |
| -------------- | -------- | -------------------- | ------------------------------- |
| `module`       | `string` | required             | Module name                     |
| `submodule`    | `string` | `null`               | Submodule (optional)            |
| `accessLevel`  | `string` | `"read"`             | Minimum required access         |
| `fallbackPath` | `string` | `"/admin/dashboard"` | Where to redirect on 403 action |

### Rules

1. Always wrap lazy-loaded pages with `<ProtectedRoute>` inside a `<Suspense>`.
2. Use `accessLevel="read"` for viewing pages — never `"write"` for page access.
3. Use `hasPermission` in the page hooks for write-action gating (buttons, row selection, etc.).

---

## Adding a new permission

1. Add the permission record to the `permissions` table in the database (via migration or seed script)
2. Use it in `<ProtectedRoute>` in the route file
3. Use `hasPermission()` in the page hooks to gate write actions
4. Add to the navigation's `permission` field so sidebar filters correctly

---

## Do / Don't

**Do:**

- Use `useAdminAuthStore` for auth state
- Call `reset()` for logout — never manually clear individual fields
- Check `hasPermission("module", "submodule", "write")` before showing create/edit/delete buttons
- Let `<ProtectedRoute>` handle the loading and 403 states — don't duplicate that logic

**Don't:**

- Don't store tokens in cookies or sessionStorage — always localStorage via Zustand persist
- Don't create new auth stores — use the existing one
- Don't call permission API directly — always go through `usePermissions()` hook
- Don't check permissions in the store's `permissions` array directly — use the hook helpers
- Don't add `isAdmin` or `isLoggedIn` booleans to the store — derive from `token` presence
