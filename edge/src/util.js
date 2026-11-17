import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Hide the password in every URL inside `text`:
 * `rtsp://admin:secret@10.0.0.5/stream1` → `rtsp://admin:***@10.0.0.5/stream1`,
 * and the stream key of every RTMP URL: `rtmp://host/live2/abcdwxyz` → `rtmp://host/live2/****wxyz`.
 * The userinfo runs up to the LAST "@" before the first "/", so a raw "@" in a
 * password is still covered.
 */
/** Secrets from .env with no recognisable shape (ENROLL_KEY): masked wherever they appear. */
const secrets = new Set();
export function registerSecret(value) {
  const secret = String(value ?? "");
  if (secret.length >= 8) secrets.add(secret);
}

export function maskCredentials(text) {
  if (text === null || text === undefined) return text;
  let out = String(text);
  for (const secret of secrets) out = out.split(secret).join("****");
  return (
    out
      .replace(/([a-z][a-z0-9+.-]{0,20}:\/\/)([^\s/]*)@/gi, (_m, scheme, info) => {
        const colon = info.indexOf(":");
        return colon === -1 ? `${scheme}***@` : `${scheme}${info.slice(0, colon)}:***@`;
      })
      // Device tokens: "dcb_…" from enrolment, and anything after "Device " in a header
      .replace(/\bdcb_[A-Za-z0-9_-]{4,}/g, "dcb_****")
      .replace(/\b(Device )[A-Za-z0-9_-]{12,}/g, "$1****")
      // RTMP ingest URLs carry the stream key in the path: keep the app, show ≤ 4 chars of the key
      .replace(/(rtmps?:\/\/[^\s/'"|\])]+)(\/[^\s'"|\]),]*)/gi, (_m, base, pathPart) => {
        const parts = pathPart.slice(1).split("/");
        const keep = parts.length >= 2 ? `/${parts[0]}/` : "/";
        const secret = parts.length >= 2 ? parts.slice(1).join("/") : parts[0];
        return secret
          ? `${base}${keep}****${secret.split("?")[0].slice(-4)}`
          : `${base}${pathPart}`;
      })
  );
}

/** A business ID that is safe as a folder name; anything else is hashed. */
export function safeId(id) {
  const value = String(id ?? "");
  if (/^[A-Za-z0-9_-]{1,64}$/.test(value)) return value;
  return `id-${crypto.createHash("sha1").update(value).digest("hex").slice(0, 16)}`;
}

/**
 * A court camera's buffer folder name: `<safeId(courtId)>` for camera 1,
 * `<safeId(courtId)>~cam2` for camera 2 (`~` is never in a safeId, so it
 * can't collide with another court).
 */
export const CAM2_SUFFIX = "~cam2";
export const cameraDirName = (courtId, camera = 1) =>
  `${safeId(courtId)}${camera === 2 ? CAM2_SUFFIX : ""}`;
/** The court folder name a buffer folder belongs to (camera 2's without its suffix). */
export const courtDirName = (dirName) =>
  dirName.endsWith(CAM2_SUFFIX) ? dirName.slice(0, -CAM2_SUFFIX.length) : dirName;

/** Truncate to `max` characters (the API caps reasons/messages at 255). */
export const truncate = (text, max = 255) => {
  const value = String(text ?? "").trim();
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
};

/** Sleep that ends early (without throwing) when `signal` aborts. */
export function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** Exponential backoff: base·2^(attempt-1), capped. attempt starts at 1. */
export const backoffMs = (attempt, baseMs, maxMs) =>
  Math.min(maxMs, baseMs * 2 ** Math.max(0, Math.min(attempt - 1, 20)));

/** Write JSON atomically (tmp file + rename), so a power cut never leaves half a file. */
export async function writeJsonAtomic(file, value, mode = 0o600) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode });
  await fs.rename(tmp, file);
}

/** Read JSON; `fallback` when the file is missing. A corrupt file is moved aside. */
export async function readJson(file, fallback) {
  let text;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch (_err) {
    await fs.rename(file, `${file}.corrupt-${Date.now()}`).catch(() => {});
    return fallback;
  }
}
