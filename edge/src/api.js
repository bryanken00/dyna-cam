import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { truncate } from "./util.js";

/**
 * Error from the device API. `status` is the HTTP status, or 0 when the
 * request never got an answer (offline, DNS, timeout).
 */
export class ApiError extends Error {
  constructor(
    message,
    { status = 0, code = null, retryAfterMs = null, detail = null, cause } = {}
  ) {
    super(message, { cause });
    /** The API's own message, without the method/path prefix. */
    this.detail = detail ?? message;
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }

  get isNetwork() {
    return this.status === 0;
  }

  /** 404/409: the clip is gone or already finished — drop the job. */
  get isGone() {
    return this.status === 404 || this.status === 409;
  }

  /** Worth trying again later (network, timeout, rate limit, server error). */
  get isRetryable() {
    return this.status === 0 || this.status === 401 || this.status === 429 || this.status >= 500;
  }
}

const parseRetryAfter = (value) => {
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : null;
};

/** Files → FormData, streamed from disk. Parts with no path are left out. */
async function multipart(parts) {
  const form = new FormData();
  let size = 0;
  for (const [field, file, type, name] of parts) {
    if (!file) continue;
    const blob = await fs.openAsBlob(file, { type });
    form.append(field, blob, name);
    size += blob.size;
  }
  return { form, size };
}

/** Upload timeout: the time the file takes at ~256 KB/s, between 2 and 15 min (the API's limit). */
export const uploadTimeoutMs = (bytes) =>
  Math.min(15 * 60_000, Math.max(120_000, Math.ceil(bytes / 256_000) * 1000));

/** fetch with a timeout covering the body too; network failures become ApiError (status 0). */
async function call(fetchImpl, url, init, timeoutMs, signal) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    // The body is read inside the timeout too
    const body = init.raw ? Buffer.from(await res.arrayBuffer()) : await res.text();
    return { res, body };
  } catch (err) {
    let reason = err.cause?.code || err.cause?.message || err.message;
    if (timedOut) reason = `timed out after ${Math.round(timeoutMs / 1000)}s`;
    else if (signal?.aborted) reason = "aborted";
    throw new ApiError(`${init.method} ${new URL(url).pathname}: ${reason}`, { cause: err });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

const parseEnvelope = (text) => {
  try {
    return JSON.parse(text);
  } catch (_err) {
    return null;
  }
};

/** A non-2xx (or `success: false`) answer as an ApiError carrying the server's message. */
function envelopeError(method, pathname, res, envelope) {
  const message = envelope?.message || `HTTP ${res.status}`;
  return new ApiError(`${method} ${pathname}: ${message}`, {
    status: res.ok ? 502 : res.status,
    code: envelope?.code ?? null,
    detail: message,
    retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
  });
}

/**
 * Client for /api/v1/device. Every response is `{ success, message, data }`;
 * each method returns `data` and throws ApiError otherwise.
 *
 * The token can be set later (`setToken`, after enrolling). `onUnauthorized` is
 * called on every 401 from a device route — a revoked box (index.js).
 */
export function createApi({
  apiUrl,
  deviceToken = null,
  userAgent,
  fetchImpl = globalThis.fetch,
  onUnauthorized = null,
}) {
  const base = `${apiUrl}/api/v1/device`;
  const apiOrigin = new URL(apiUrl).origin;
  let token = deviceToken;
  const hooks = { onUnauthorized };
  const headersFor = (auth = true) => ({
    ...(auth && token ? { Authorization: `Device ${token}` } : {}),
    "User-Agent": userAgent,
    Accept: "application/json",
  });

  async function request(
    method,
    pathname,
    { query, json, form, timeoutMs = 15_000, signal, root = base, auth = true } = {}
  ) {
    const url = new URL(root + pathname);
    for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, value);
    const headers = headersFor(auth);
    let body;
    if (json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(json);
    } else if (form) {
      body = form; // fetch sets the multipart boundary
    }

    const { res, body: text } = await call(
      fetchImpl,
      url,
      { method, headers, body },
      timeoutMs,
      signal
    );
    const envelope = parseEnvelope(text);
    if (!res.ok || !envelope || envelope.success === false) {
      if (res.status === 401 && auth) hooks.onUnauthorized?.();
      throw envelopeError(method, pathname, res, envelope);
    }
    return envelope.data ?? {};
  }

  const clipPath = (clipId, action) => `/clips/${encodeURIComponent(clipId)}/${action}`;

  return {
    setToken(next) {
      token = next;
    },

    set onUnauthorized(fn) {
      hooks.onUnauthorized = fn;
    },

    /**
     * Enrol with the shared ENROLL_KEY (no Authorization header).
     * → { token, device: { deviceId, name }, venue: { venueId, name } }
     */
    enroll: ({ enrollKey, venueId, name, agentVersion }) =>
      request("POST", "/enroll", {
        root: `${apiUrl}/api/v1/pair`,
        auth: false,
        json: { enrollKey, venueId, ...(name ? { name } : {}), agentVersion },
      }),

    getConfig: (signal) => request("GET", "/config", { signal }),

    heartbeat: (payload) => request("POST", "/heartbeat", { json: payload }),

    /** Long-poll: the server holds the request up to `wait` seconds. */
    getJobs: (wait, signal) =>
      request("GET", "/jobs", { query: { wait }, timeoutMs: (wait + 15) * 1000, signal }),

    claimClip: (clipId) => request("POST", clipPath(clipId, "processing")),

    /** A court button press, with the box's receipt time. → { clipId, shareUrl, merged } */
    pressButton: (buttonCode, pressedAtMs, signal) =>
      request("POST", `/buttons/${encodeURIComponent(buttonCode)}/press`, {
        json: { pressedAtMs },
        timeoutMs: 10_000,
        signal,
      }),

    failClip: (clipId, reason) =>
      request("POST", clipPath(clipId, "fail"), { json: { reason: truncate(reason, 255) } }),

    /** Camera-setup preview: multipart `snapshot` (image/jpeg, ≤ 3 MB); `?camera=2` for camera 2. */
    async uploadSnapshot(courtId, jpegPath, camera = 1) {
      const { form } = await multipart([["snapshot", jpegPath, "image/jpeg", "snapshot.jpg"]]);
      const pathname = `/courts/${encodeURIComponent(courtId)}/snapshot`;
      const query = camera === 2 ? { camera: "2" } : undefined;
      return request("POST", pathname, { form, query, timeoutMs: 60_000 });
    },

    /** multipart: `video` (video/mp4, *.mp4, required), `thumbnail` (image/jpeg, *.jpg). */
    async uploadClip(clipId, files, signal) {
      const { form, size } = await multipart([
        ["video", files.videoPath, "video/mp4", "clip.mp4"],
        ["thumbnail", files.thumbnailPath, "image/jpeg", "thumbnail.jpg"],
      ]);
      return request("POST", clipPath(clipId, "upload"), {
        form,
        timeoutMs: uploadTimeoutMs(size),
        signal,
      });
    },

    /**
     * Download a file the API linked to (the signed logo path is RELATIVE to
     * API_URL). The device token is only sent to the API's own origin.
     */
    async downloadFile(link, destPath, { maxBytes = 10 * 1024 * 1024 } = {}) {
      const url = new URL(link, `${apiUrl}/`);
      const headers =
        url.origin === apiOrigin ? { ...headersFor(), Accept: "*/*" } : { "User-Agent": userAgent };
      const { res, body } = await call(
        fetchImpl,
        url,
        { method: "GET", headers, raw: true },
        30_000
      );
      if (!res.ok) {
        throw new ApiError(`GET ${url.pathname}: HTTP ${res.status}`, { status: res.status });
      }
      if (body.length === 0 || body.length > maxBytes) {
        throw new ApiError(`GET ${url.pathname}: unexpected size ${body.length} bytes`, {
          status: 502,
        });
      }
      await fsp.mkdir(path.dirname(destPath), { recursive: true });
      await fsp.writeFile(destPath, body);
      return destPath;
    },
  };
}
