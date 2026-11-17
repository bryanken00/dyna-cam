import crypto from "node:crypto";
import path from "node:path";

/**
 * Signed links for uploaded files
 *
 * Uploads are not public. The database stores the plain path
 * (`/public/uploads/...`); every API response hands out a signed link instead:
 *
 *   /public/uploads/.../file.png?expires=<unix seconds>&signature=<hmac>
 *
 * `requireSignedUpload` (middlewares/signedUpload.middleware.js) serves a file
 * only when the signature matches the path and the link has not expired.
 *
 * Env:
 *   UPLOAD_URL_SECRET        required in production (32+ random characters)
 *   UPLOAD_URL_TTL_SECONDS   how long a link stays valid, at least (default 3600)
 */

export const UPLOAD_URL_PREFIX = "/public/uploads/";

const configuredSecret = process.env.UPLOAD_URL_SECRET || "";
const hasUsableSecret =
  configuredSecret.length >= 32 && !configuredSecret.startsWith("CHANGE_THIS");

if (!hasUsableSecret && process.env.NODE_ENV === "production") {
  throw new Error("UPLOAD_URL_SECRET must be set to 32+ random characters in production");
}

// Outside production an unset secret becomes a random one for this process, so
// nothing is ever signed with a known default. Links stop working on restart.
const secret = hasUsableSecret ? configuredSecret : crypto.randomBytes(32).toString("hex");

const ttlSeconds = Math.max(60, parseInt(process.env.UPLOAD_URL_TTL_SECONDS || "3600", 10) || 3600);

const sign = (storedPath, expires) =>
  crypto.createHmac("sha256", secret).update(`${storedPath}:${expires}`).digest("hex");

/**
 * Reduce whatever a client sends back — a signed link, a full URL, or the plain
 * path — to the stored `/public/uploads/...` path. Other values pass through.
 */
export const toStoredPath = (value) => {
  if (typeof value !== "string") return value;

  const start = value.indexOf(UPLOAD_URL_PREFIX);
  if (start === -1) return value;

  return value.slice(start).split(/[?#]/)[0];
};

const isUploadPath = (value) =>
  typeof value === "string" &&
  value.startsWith(UPLOAD_URL_PREFIX) &&
  path.posix.normalize(value) === value;

/**
 * Turn a stored upload path into a signed link. `null`, external URLs, and
 * anything else that is not an upload path are returned unchanged.
 *
 * Only sign a path the caller is allowed to see — never a raw client value.
 *
 * The expiry is rounded to a window, so the same file gets the same link for up
 * to `ttlSeconds` and the browser can cache it. A link lives between one and
 * two windows.
 */
export const signUploadUrl = (value) => {
  const storedPath = toStoredPath(value);
  if (!isUploadPath(storedPath)) return value ?? null;

  const expires = (Math.floor(Date.now() / 1000 / ttlSeconds) + 2) * ttlSeconds;
  return `${storedPath}?expires=${expires}&signature=${sign(storedPath, expires)}`;
};

/**
 * A signed link that makes the browser save the file (Content-Disposition:
 * attachment) instead of opening it. `null` when there is no file.
 */
export const signedDownloadUrl = (value) => {
  const storedPath = toStoredPath(value);
  if (!isUploadPath(storedPath)) return null;
  return `${signUploadUrl(storedPath)}&download=1`;
};

/**
 * Check a signed link.
 * @returns {number} seconds until the link expires, or 0 when it is not valid
 */
export const verifyUploadSignature = (storedPath, expires, signature) => {
  const now = Math.floor(Date.now() / 1000);
  if (!isUploadPath(storedPath) || !Number.isInteger(expires) || expires <= now) return 0;
  if (typeof signature !== "string") return 0;

  const expected = Buffer.from(sign(storedPath, expires));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return 0;

  return expires - now;
};
