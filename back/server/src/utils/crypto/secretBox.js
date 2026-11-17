import crypto from "node:crypto";
import { logger } from "../../../config/logger.js";

/**
 * Encryption at rest for secrets the API must be able to read back — today the
 * courts' camera RTSP URLs, which usually embed the camera's username and
 * password. (Passwords and tokens the API only needs to *check* are hashed, not
 * encrypted.)
 *
 * AES-256-GCM, stored as `v1:<iv>:<tag>:<ciphertext>` (base64url parts). The
 * key comes from DEVICE_SECRET_KEY:
 *
 *   DEVICE_SECRET_KEY   required in production (32+ random characters)
 *
 * Changing the key makes every stored secret unreadable; the cameras then have
 * to be re-entered in the Admin portal.
 */

const PREFIX = "v1";

const configured = process.env.DEVICE_SECRET_KEY || "";
const usable = configured.length >= 32 && !configured.startsWith("CHANGE_THIS");

if (!usable && process.env.NODE_ENV === "production") {
  throw new Error("DEVICE_SECRET_KEY must be set to 32+ random characters in production");
}

// Outside production a missing key falls back to a key derived from the
// database name, so stored camera URLs survive a restart during development.
// It is not a secret — never rely on it for real cameras.
if (!usable && process.env.NODE_ENV !== "test") {
  logger.warn(
    "DEVICE_SECRET_KEY is not set — camera URLs are encrypted with a development-only key"
  );
}

const key = crypto
  .createHash("sha256")
  .update(usable ? configured : `dyna-cam-dev-only:${process.env.DB_DATABASE || ""}`)
  .digest();

/** Encrypt a string. `null`/`undefined`/"" pass through as `null`. */
export const encryptSecret = (plaintext) => {
  if (plaintext === null || plaintext === undefined || plaintext === "") return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv, tag, ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(":");
};

/**
 * Decrypt a value from `encryptSecret`.
 * @returns {string|null} the plaintext, or null when empty or unreadable
 *   (wrong key, tampered value).
 */
export const decryptSecret = (stored) => {
  if (!stored) return null;
  const [prefix, iv, tag, ciphertext] = String(stored).split(":");
  if (prefix !== PREFIX || !iv || !tag || !ciphertext) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
};

/**
 * A short fingerprint of a stored (encrypted) camera address. Every save
 * re-encrypts with a fresh IV, so it changes whenever the address is saved —
 * the recorder box echoes it so the setup page can tell a report about the new
 * address from one about the old (PLAN-002).
 */
export const cameraVersion = (stored) =>
  stored ? crypto.createHash("sha256").update(String(stored)).digest("hex").slice(0, 12) : null;

/**
 * An RTMP ingest URL safe to show: the stream key (last path segment) hidden
 * except its last 4 characters, e.g.
 * `rtmp://a.rtmp.youtube.com/live2/abcd-efgh-ijkl` → `rtmp://a.rtmp.youtube.com/live2/••••ijkl`.
 */
export const maskRtmpUrl = (url) => {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    const parts = parsed.pathname.split("/");
    const key = parts.pop() || "";
    const shown = key.length > 4 ? `••••${key.slice(-4)}` : "••••";
    return `${parsed.protocol}//${parsed.host}${parts.join("/")}/${shown}`;
  } catch {
    return null;
  }
};

/**
 * A camera URL safe to show in the Admin portal: credentials removed, e.g.
 * `rtsp://admin:pw@192.168.1.50:554/stream1` → `rtsp://192.168.1.50:554/stream1`.
 */
export const maskStreamUrl = (url) => {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return null;
  }
};
