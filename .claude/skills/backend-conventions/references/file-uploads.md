# File Upload Path Convention

All uploaded files are stored under `public/uploads/admin/`, in one folder per kind of file. Files
that belong to one user go in a per-user subfolder named after their `accountId`.

---

## Folder Structure

```
public/uploads/
└── admin/
    ├── avatars/{accountId}/      ← User avatars (per-user)
    ├── signatures/{accountId}/   ← User signatures (per-user)
    └── images/                   ← General images
```

---

## Rules

### 1. Always prefix with `admin/`

Every upload path starts with `uploads/admin/`. `canAccessUpload()` refuses any path outside
`public/uploads/admin/`, so a file stored anywhere else can never be saved on a record or deleted
through the API.

```js
// ✅ CORRECT
filePath: () => "uploads/admin/images";

// ❌ WRONG — no admin/ prefix
filePath: () => "uploads/images";
```

### 2. User-scoped files go in a per-user folder

Files that belong to a specific user (avatar, signature) add the user's `accountId`, taken from
`req.user`:

```js
filePath: (req) => `uploads/admin/avatars/${req.user.accountId}`;
```

A new per-user folder must also be added to `USER_SCOPED_FOLDERS` in `utils/file/uploads.js`, or
any user could save or delete another user's file in it.

### 3. A client-sent ID in a path goes through `uploadFolderId()`

When a folder is named after an ID the client sends (e.g. the record the file belongs to), that
ID **must** go through `uploadFolderId()` (from `utils/file/uploads.js`). It throws a 400 unless
the value looks like a business ID, which stops `../` from moving the upload somewhere else.

```js
filePath: (req) =>
  `uploads/admin/products/${uploadFolderId(req.body?.productId || req.params.productId)}`;
```

multer only exposes body fields sent **before** the file part, so the client must append the ID to
the `FormData` first.

### 4. Every upload route gets `uploadLimiter`

Put `uploadLimiter` (from `middlewares/rateLimiter.js`) before the multer middleware so a rejected
request never writes a file.

---

## Path Pattern by Upload Type

| Upload Type    | Folder Pattern                          | Source of IDs                 |
| -------------- | --------------------------------------- | ----------------------------- |
| User avatar    | `uploads/admin/avatars/{accountId}/`    | `req.user.accountId`          |
| User signature | `uploads/admin/signatures/{accountId}/` | `req.user.accountId`          |
| General image  | `uploads/admin/images/`                 | —                             |

---

## Implementation in Upload Config

```js
// User avatar — the caller's own folder
const adminAvatarUpload = upload({
  filePath: (req) => `uploads/admin/avatars/${req.user.accountId}`,
  fileTypes: ["images"],
  maxFileSize: 1024 * 1024 * 2,
});

// General image
const adminImageUpload = upload({
  filePath: () => "uploads/admin/images",
  fileTypes: ["images"],
  maxFileSize: 1024 * 1024 * 5,
});

router.post("/avatar", uploadLimiter, adminAvatarUpload.single("avatar"), compressImage, catchAsync(...));
```

The upload routes live in `controllers/v1/upload/upload.controller.js`, mounted at
`/api/v1/upload` behind `requireAuth` in `routes/route.js`.

---

## What `upload()` enforces for you

These are built into `utils/file/uploads.js`, so every upload config gets them:

- **The folder cannot leave `public/uploads/`.** A `filePath` that resolves outside it is rejected with a 400.
- **File names are random** (64 hex characters + the extension). Uploads are served without login, so a name must not be guessable. Never build a name from the time or the original file name.
- **The content must match the declared type.** The MIME type and extension both come from the client. After the file is written, its first bytes are checked against the signature for that type; a mismatch deletes the file and returns a 400. A new type needs an entry in **both** `FILE_TYPE_CONFIGS` and `CONTENT_CHECKS`, or it is rejected.
- **No SVG.** It can carry script and would be served from the API's origin. Do not add it back.

---

## Stored Path Format

The path saved to the database is always relative from the project root, starting with `/public/`:

```
/public/uploads/admin/images/abc123.jpg
/public/uploads/admin/avatars/{accountId}/def456.png
```

The database only ever holds this plain path — never a signature.

---

## Signed links — uploads are not public

A file under `/public/uploads` is served **only** through a signed, expiring link:

```
/public/uploads/admin/images/abc123.jpg?expires=1790928000&signature=<hmac>
```

A bare path, an altered path, or an expired link gets a 403
(`middlewares/signedUpload.middleware.js`). The helpers are in `utils/file/signedUrl.js`.

### 1. Sign every upload path you return

Wrap each upload column in `signUploadUrl()` on the way out. It passes `null` and external URLs
through unchanged. An unsigned path renders as a broken image.

```js
return res.sendSuccess("Users retrieved successfully", {
  users: users.map((user) => ({ ...user, imageUrl: signUploadUrl(user.imageUrl) })),
});
```

### 2. Accept upload paths with `optionalUploadPath()`

A form sends back the signed link it was given (often with the host in front). In the validator,
use `optionalUploadPath()` from `_helpers.js`: it reduces the value to the stored path before the
controller sees it, so the signature never reaches the database.

```js
imageUrl: optionalUploadPath(255), // "http://host/public/uploads/x.png?expires=…" → "/public/uploads/x.png"
```

### 3. Check ownership before saving a client-sent path

Whatever path you save, the API will later hand back **signed**. So an endpoint that stores a
client-sent path must first call `canAccessUpload(req.user, path)` and reject a `false`. Without
it, a user could save a path outside `uploads/admin/`, or another user's avatar or signature, and
receive a working link to that file.

```js
if (imageUrl && !canAccessUpload(req.user, imageUrl)) {
  throw new APIError("Invalid profile image", 400, ERROR_CODES.VALIDATION_FAILED);
}
```

### 4. Never sign a raw client value

Only sign a path read from the database or one the server just built (`req.file.path`).

### Settings

| Env | Purpose |
| --- | --- |
| `UPLOAD_URL_SECRET` | Signing key. **Required in production** (32+ characters; the server refuses to start without it). Unset in development → a random key per process, so links break on restart. |
| `UPLOAD_URL_TTL_SECONDS` | Link lifetime, default `3600`. A link lives between 1× and 2× this value; the expiry is rounded so the same file keeps the same link within a window and the browser can cache it. |

Changing `UPLOAD_URL_SECRET` invalidates every link already handed out. Pages pick up fresh links
on their next data fetch.

---

## Delete Behavior

When deleting a file:

- Resolve the path and check it is still inside `public/uploads/` (a `startsWith` on the raw string is not enough).
- **Check ownership** with `canAccessUpload(req.user, path)`. A user may delete any file inside `admin/`, except that in per-user folders (`avatars`, `signatures`) only their own `accountId` folder. Report a file they may not touch as 404, the same as a missing one. A new per-user folder must be added to `USER_SCOPED_FOLDERS` in `utils/file/uploads.js`.
- Only delete the file — never delete the parent directory (other files may exist there).

---

## Do / Don't

**Do:**

- Always prefix the path with `uploads/admin/`
- Put a user's own files in a per-user folder named after `req.user.accountId`, listed in `USER_SCOPED_FOLDERS`
- Create directories recursively if they don't exist (`fs.mkdirSync(path, { recursive: true })`)

**Don't:**

- Don't store files outside `uploads/admin/`
- Don't take the per-user folder's `accountId` from the client — use `req.user`
- Don't allow client-provided paths — always construct server-side
- Don't put a client-sent ID in a path without `uploadFolderId()`
- Don't return an upload path without `signUploadUrl()`
- Don't save a client-sent upload path without `optionalUploadPath()` and `canAccessUpload()`
- Don't delete a file without checking `canAccessUpload()` first
- Don't delete parent folders on file delete
