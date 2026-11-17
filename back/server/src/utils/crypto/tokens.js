import crypto from "node:crypto";

/**
 * Unguessable tokens. These are secrets, not business IDs — a business ID
 * comes from `SELECT UUID()`; a token that grants access (a court's QR code, a
 * clip's share link, a recorder box's credential) comes from the CSPRNG.
 */

/** URL-safe random token. 16 bytes → 22 characters. */
export const randomToken = (bytes = 16) => crypto.randomBytes(bytes).toString("base64url");

/** SHA-256 hex of a token, for storing credentials we only need to check. */
export const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");
