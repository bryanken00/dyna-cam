# Backend Tests

API tests live in `back/tests/` and run with Node's built-in test runner — no test framework to
install.

```bash
cd back && npm test
```

There is no CI workflow in the repository: run `npm test` (and `npm run lint`) yourself before
reporting a backend change done.

---

## How a test run works

Every test file calls `startTestApp()` from `tests/helpers/testApp.js` once. It:

1. Creates a **throwaway database** named `tpl_test_<pid>_<random>` on the MySQL server from
   `DB_HOST` / `DB_USER` / `DB_PASS` (`back/.env`, or real environment variables).
2. Runs the real `scripts/setup-database.js` against it — schema, migrations, permissions, the
   Owner role and the first Owner account.
3. Starts the **real app** (`server/config/express.js`) on a random port, from a temp working
   directory, so uploads never land in `back/public`.
4. On `stop()`, drops the database and the temp directory.

The database named in `DB_DATABASE` is **never opened**. The MySQL user needs permission to create
and drop databases.

Each test file runs in its own process, so files are isolated from each other and run in parallel.
Inside a file, tests run in order and share the app.

---

## Writing a test

```js
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { startTestApp } from "./helpers/testApp.js";

describe("products", () => {
  let ctx;
  let admin; // a staff user with write access to everything — the acting user

  before(async () => {
    ctx = await startTestApp();
    admin = await ctx.createStaff("Admin", { access: "write" });
  });

  after(() => ctx?.stop());

  it("treats a deleted product as missing and leaves it alone", async () => {
    const created = await ctx.api("POST", "/admin/products", {
      token: admin.token,
      body: { name: "Widget" },
    });
    const { productId } = created.data;

    const own = await ctx.api("GET", `/admin/products/${productId}`, { token: admin.token });
    assert.equal(own.status, 200);

    await ctx.api("DELETE", `/admin/products/${productId}`, { token: admin.token });
    const response = await ctx.api("PUT", `/admin/products/${productId}`, {
      token: admin.token,
      body: { name: "Changed" },
    });
    assert.equal(response.status, 404);

    const [[row]] = await ctx.sql.query(`SELECT name FROM products WHERE productId = ?`, [
      productId,
    ]);
    assert.equal(row.name, "Widget");
  });
});
```

What `startTestApp()` returns:

| Helper | Use |
| --- | --- |
| `api(method, url, { body, form, token, headers })` | Call the API. `url` is the path below `/api/v1`. Returns `{ status, body, data }` (`data` is the envelope's `data`). `form` sends multipart: `[name, value]` or `[name, Buffer, mimeType, filename]`, in order. |
| `get(path)` | Fetch a non-API path, e.g. a signed upload link. Returns the raw `Response`. |
| `owner()` | The seeded Owner's session `{ accountId, email, token, refreshToken, user }`, signed in once and reused. The Owner holds every permission but is hidden from the Admin portal's lists and by-ID endpoints. |
| `ownerRoleId()` | The Owner role's ID, for asserting it can't be reached or assigned. |
| `createStaff(label, { access })` | A role (`"<label> staff"`) and a staff user with it, created through the API as the Owner. `access: "read"` or `"write"` grants the role every permission at that level; omitted, it gets none. The helper also does the user's forced first password change, so the password is `STAFF_PASSWORD` and the session is ready to use. Returns `{ accountId, email, roleId, token, refreshToken, user }`. |
| `login(email, password)` | Sign in as anyone; throws if it fails. Returns `{ token, refreshToken, user }`. |
| `issueResetToken(accountId)` | Store a password-reset link for the account, as forgot-password would have emailed it, and return the token to send to `/auth/reset-password`. |
| `sql` | A raw `mysql2` connection to the test database — for checking what was (not) written. |
| `importFromBack(path)` | Import an app module in the same process (e.g. to call a helper directly). |
| `stop()` | Tear everything down. Always call it in `after()`. |

`tests/helpers/testApp.js` also exports the constants `OWNER` (`{ email, password }`),
`OWNER_PASSWORD`, `TEMPORARY_PASSWORD` (what the Owner types when creating a user),
`STAFF_PASSWORD`, and the smallest valid `PNG` / `JPEG` buffers for upload tests.

---

## Rules

### 1. Every by-ID endpoint gets a 404 test

For each endpoint that takes an ID: a **Deleted** record's ID gets **404**, and the row is
**unchanged** afterwards (check with `ctx.sql`). Where the endpoint can reach roles or users, the
Owner role's or an Owner account's ID gets the same 404 — even for a staff user holding every
permission. Copy the shape of `tests/owner-protection.test.js`.

### 2. Go through the API, not around it

Build the data a test needs with real requests (`createStaff`, then the module's own POST). Use
`ctx.sql` only to **check** results, or to set up a state the API cannot produce (e.g. an expired
row).

### 3. Assert the negative and the positive

"A deleted record gets 404" proves nothing if the endpoint is simply broken. Pair it with "a live
record returns 200".

### 4. Never point a test at a real database

Don't open `DB_DATABASE`, don't hardcode a database name, and don't change `dropTestDatabase` to
accept names without the `tpl_test_` prefix.

### 5. Settings that are read at startup need their own file

Environment variables such as rate-limit points are read once per process. To test a different
value, put the test in its own file and pass `startTestApp({ env: { … } })` — see
`tests/upload-rate-limit.test.js`.

### 6. A security fix ships with a test that fails without it

Before reporting a fix done, confirm the new test fails on the old code and passes on the new.

---

## What the test environment changes

`loadTestEnv()` sets `NODE_ENV=test` and:

- `DISABLE_CSRF=true` — CSRF uses its own cookie flow; these tests exercise the API rules.
- Rate limits raised to 1000, so repeated logins in a test are not throttled.
- A random `UPLOAD_URL_SECRET`, and `SMTP_HOST=""` so no email is ever sent.
- The first Owner is `owner@template.com` with a fixed test password (`OWNER_EMAIL` /
  `OWNER_PASSWORD`), and its `mustChangePassword` flag is cleared (pass
  `keepFirstPasswordFlag: true` to keep it).
- Log output is silenced, and nothing is written to `back/logs`.
