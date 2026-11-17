import crypto from "node:crypto";

/**
 * Unguessable tokens. These are secrets, not business IDs — a business ID
 * comes from `SELECT UUID()`; a token that grants access (a court's QR code, a
 * clip's share link, a recorder box's credential) comes from the CSPRNG.
 */

/** URL-safe random token. 16 bytes → 22 characters. */
export const randomToken = (bytes = 16) => crypto.randomBytes(bytes).toString("base64url");

// No 0/O, 1/I/L: a pay code is read aloud and typed in at the front desk
const PAY_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** A short code a player shows at the desk to pay for a clip, e.g. "K7QM2P". */
export const randomPayCode = (length = 6) => {
  const bytes = crypto.randomBytes(length);
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += PAY_CODE_ALPHABET[bytes[i] % PAY_CODE_ALPHABET.length];
  }
  return code;
};

/** SHA-256 hex of a token, for storing credentials we only need to check. */
export const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");
