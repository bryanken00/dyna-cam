# Authenticated User Context

All protected endpoints receive the authenticated user's data via `req.user`, set by the Passport JWT middleware.

---

## Available on `req.user`

> **Note:** The fields below are a sample based on the current schema. This shape can change anytime depending on what the Passport JWT strategy returns. Always check `server/src/middlewares/passport.jwt.config.js` for the actual `req.user` structure.

| Field                | Type      | Description                                   |
| -------------------- | --------- | --------------------------------------------- |
| `accountId`          | `string`  | User's unique UUID                            |
| `firstName`          | `string`  | First name                                    |
| `lastName`           | `string`  | Last name                                     |
| `email`              | `string`  | Email address (from credentials)              |
| `type`               | `string`  | `'ADMIN'` or `'USER'` (`credentials.type`)    |
| `roleId`             | `string`  | Assigned role ID                              |
| `companyId`          | `string`  | PLAN-008: the company the user works for — scope every Admin query to it |
| `status`             | `string`  | Account status (always `'Active'` here)       |
| `mustChangePassword` | `boolean` | A forced password change is pending           |

The role **name** is not on `req.user` — join `roles` when you need it.

The strategy only resolves an account whose `users` row is `Active` and whose credential is not
`Deleted`; login and refresh also require an `Active` credential. A deactivated user's token stops
working on its next request, so controllers don't re-check the caller's status.

---

## Rules

### 1. Never trust a client-sent `accountId` for "who is calling"

The caller is `req.user`. Use `req.user.accountId` for ownership, "my" queries and audit rows;
never read the current user's ID from `req.body` or `req.query`. An `accountId` in the URL
(`/users/:userId`) names the **target** record, never the actor.

```js
// ✅ CORRECT — the caller's own profile
const [me] = await req.db.query(
  `SELECT accountId, firstName, lastName FROM users WHERE accountId = ? LIMIT 1`,
  [req.user.accountId],
);

// ❌ WRONG — trusting the client to say who it is
const { accountId } = req.body; // anyone can send anyone's ID
```

### 2. Every Admin query is scoped to the caller's company (PLAN-008)

The platform is multi-company: DGSports onboards **companies** in the back office, and a staff
account belongs to one (`req.user.companyId`). An Admin query **never** sees another company's
rows. Use `utils/companyScope.js`:

- Tables with their own `companyId` (`venues`, `users`, `roles`, `settings`, `audit_trail`):
  `AND x.companyId = ?` with `callerCompany(req)`.
- Everything under a venue (courts, devices, games, bookings, payments, clips, rates, hours,
  closures, …): `AND ${inCompanyVenues("x")}` (one `?` = the companyId), or a join on
  `venues.companyId`.
- A by-ID request for another company's record returns **404**, exactly like a missing or Deleted
  one, and the row stays unchanged — put the company condition in the `UPDATE … WHERE` too.
- An ID the client sends (`venueId`, `courtId`, `roleId`, …) is checked with `venueInCompany` /
  `courtInCompany` / `roleInCompany` before it's used.
- New rows in the company tables get `companyId: req.user.companyId`.
- Background jobs and the device / app / public / player routes work across companies (their own
  credential scopes them). A job that notifies staff picks only the venue's company's staff.
- A suspended company's staff can't sign in and their tokens stop working (`passport.jwt.config.js`).

```js
// ✅ CORRECT — another company's court is "not found"
const rows = await req.db.query(
  `SELECT c.courtId, c.name FROM courts c
   WHERE c.courtId = ? AND c.status != 'Deleted' AND ${inCompanyVenues("c")}`,
  [courtId, callerCompany(req)],
);

// ❌ WRONG — any company's court by ID
await req.db.query(`SELECT * FROM courts WHERE courtId = ?`, [courtId]);
```

Every Admin module has a cross-company test (`tests/company-scope-*.test.js`).

### 2b. The Owner is never reachable from the Admin portal

Within the company, the one exception is the **Owner** — each company has its own Owner role
(created when the company is onboarded in the back office, `utils/companies.js`; setup creates
none)
and every account that holds it. From the Admin portal they are never listed, returned, edited,
deleted, or assignable:

- Queries on `roles` add `roleName != 'Owner'`; queries on `users` join `roles` and add the same.
- A by-ID request for an Owner (or Deleted) record returns **404**, exactly like a missing one —
  never a 403 that confirms it exists.
- A role chosen for a user must be a live, non-Owner role; otherwise 400.
- Role names are unique among non-deleted roles (checked on create and on rename), so a second
  "Owner" is refused with 409.

```js
// ✅ CORRECT — the join hides Owner accounts on read and on write
const result = await req.db.query(
  `UPDATE users u
   INNER JOIN roles r ON r.roleId = u.roleId
   SET u.firstName = ?, u.dateUpdated = ?
   WHERE u.accountId = ? AND u.status != 'Deleted' AND r.roleName != 'Owner'`,
  [firstName, now, userId],
);
if (result.affectedRows === 0) {
  return res.sendError("User not found", 404);
}
```

`users.controller.js`, `roles.controller.js` and `user-permissions.controller.js` are the
reference. A new module that only stores its own records needs nothing extra; one that touches
roles or users (e.g. "assign to user") must apply the same filter.

### 3. Use `req.user.accountId` for audit trails

When logging who performed an action, always reference `req.user.accountId` — see rule 7 for
the helper that writes the row.

### 4. Mount every protected route group with the index file's `requireAuth`

In `routes/v1/admin/index.js` and `routes/route.js` (the shared `/upload` group), `requireAuth`
is `[passport JWT check, requirePasswordChanged]`. The second part returns 403
`PASSWORD_CHANGE_REQUIRED` while `credentials.mustChangePassword` is set (a password the account
holder did not choose, e.g. a newly onboarded company's Owner). Changing or resetting the password clears the flag.

```js
// ✅ CORRECT — JWT + forced-password-change guard
router.use("/products", requireAuth, auditTrail("products"), productsController);

// ❌ WRONG — a bare JWT check lets a flagged account use the module
router.use("/products", passport.authenticate("jwt", { session: false }), productsController);
```

Only the auth routes (`/auth/*`) and the read-only `/admin/permissions` group use the bare JWT
check, so a flagged account can still load its sidebar and change its password.

### 5. Creating an account for someone else

Any endpoint that inserts a `credentials` row with a password typed by another person (an admin
creating a user) must:

- insert it with **`mustChangePassword = 1`** — the password is temporary, and the new user is
  sent to the change-password form at first login;
- validate the password with `newPassword()` in the schema **and** call
  `passwordProblem(password, { email })` (`utils/passwordPolicy.js`) in the handler, returning its
  message with a 400. It refuses well-known weak passwords and ones built from the email.

```js
const problem = passwordProblem(password, { email });
if (problem) {
  return res.sendError(problem, 400);
}
```

Passwords are never sanitized (`utils/security.js` skips them), so they are hashed exactly as
typed. Never log one or copy one into audit metadata.

### 6. Sign-in protections you get for free — don't rebuild them

Login already has a per-IP rate limit and a **per-account lockout** (`utils/loginLockout.js`:
5 wrong passwords lock sign-in for 15 minutes, both configurable). Access tokens last 15 minutes
and refresh tokens 7 days; the client renews silently. A password change ends every session and
returns a new one for the caller.

### 7. Audit what the middleware cannot see

`auditTrail("module")` on the route group records every successful write automatically, with
`req.user.accountId` as the actor. For an event that is not a plain write by `req.user` (a
sign-in, a failed attempt, anything before authentication), call
`recordAudit(req, { action, module, description, metadata, actor })` from
`middlewares/auditTrail.middleware.js`; `actor` is `{ accountId }` and defaults to `req.user`.
Both write the row before the response is sent. Never insert into `audit_trail` by hand.

---

## Pattern for Admin Endpoints

```js
router.get(
  "/",
  checkPermission("products", null, "read"),
  catchAsync(async (req, res) => {
    // Soft delete is the only default filter
    const items = await req.db.query(
      `SELECT productId, name, status FROM products WHERE status != 'Deleted'`,
    );

    return res.sendSuccess("Items retrieved", { items });
  }),
);
```

---

## Pattern for Create Endpoints (record who created it)

When a resource tracks its creator, take it from `req.user` — never from the request body:

```js
router.post(
  "/",
  checkPermission("products", null, "write"),
  validateBody(createSchema),
  catchAsync(async (req, res) => {
    const { name, description } = req.body;
    const now = getCurrentTimestampLocal();

    // createdBy comes from the authenticated user, NOT from req.body
    await req.db.query(
      `INSERT INTO products (productId, name, description, createdBy, status, dateCreated, dateUpdated)
       VALUES (?, ?, ?, ?, 'Active', ?, ?)`,
      [productId, name, description || null, req.user.accountId, now, now],
    );
  }),
);
```

---

## Do / Don't

**Do:**

- Use `req.user.accountId` for audit/ownership
- Scope every Admin query to `req.user.companyId` (`utils/companyScope.js`); another company's record is a 404
- Hide the Owner role and Owner accounts (`roleName != 'Owner'`) in every roles/users query
- Return 404 for an Owner or Deleted record, the same as a missing one
- Treat `req.user` as the single source of truth for the authenticated context

**Don't:**

- Accept `accountId` from the client to determine "who is making this request"
- Let an Admin endpoint list, return, edit, delete, or assign the Owner role or an Owner account
- Mount a protected group with a bare `passport.authenticate` instead of `requireAuth`
- Write `audit_trail` rows by hand instead of `auditTrail()` / `recordAudit()`
