import { maskRtmpUrl, maskStreamUrl } from "./crypto/secretBox.js";

/**
 * Strip secrets from request data before it is stored or logged (BUG-001).
 *
 * Used by the audit trail (audit_trail.metadata) and the global error handler.
 *
 *  • Any string that is an rtsp(s):// or rtmp(s):// address is masked wherever it
 *    appears — a camera address loses its user:password, a stream address keeps
 *    only the last 4 characters of its key.
 *  • Fields whose name says they hold a secret are dropped.
 *
 * Returns a copy; the input is not changed.
 */
const SECRET_NAME_PARTS = ["password", "token", "secret", "salt", "streamkey", "apikey"];
const SECRET_NAMES = new Set(["pin", "code", "key", "otp"]);

const STREAM_URL = /^\s*rtmps?:\/\//i;
const CAMERA_URL = /^\s*rtsps?:\/\//i;

export const isSecretField = (name) => {
  const lower = String(name).toLowerCase();
  return SECRET_NAMES.has(lower) || SECRET_NAME_PARTS.some((part) => lower.includes(part));
};

const maskValue = (value) => {
  if (typeof value !== "string") return value;
  if (STREAM_URL.test(value)) return maskRtmpUrl(value.trim()) || "[address hidden]";
  if (CAMERA_URL.test(value)) return maskStreamUrl(value.trim()) || "[address hidden]";
  return value;
};

export const redactSecrets = (data, depth = 0) => {
  if (data === null || typeof data !== "object") return maskValue(data);
  if (depth > 8) return "[…]";
  if (Array.isArray(data)) return data.map((item) => redactSecrets(item, depth + 1));
  const out = {};
  for (const [name, value] of Object.entries(data)) {
    if (typeof value === "string" && (STREAM_URL.test(value) || CAMERA_URL.test(value))) {
      out[name] = maskValue(value);
    } else if (!isSecretField(name)) {
      out[name] = redactSecrets(value, depth + 1);
    }
  }
  return out;
};
