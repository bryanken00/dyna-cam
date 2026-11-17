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

/** Upload timeout: the time the file takes at ~256 KB/s, between 2 and 15 min (the API's limit). */
export const uploadTimeoutMs = (bytes) =>
  Math.min(15 * 60_000, Math.max(120_000, Math.ceil(bytes / 256_000) * 1000));

/**
 * Client for /api/v1/device. Every response is `{ success, message, data }`;
 * each method returns `data` and throws ApiError otherwise.
 */
export function createApi({ apiUrl, deviceToken, userAgent, fetchImpl = globalThis.fetch }) {
  const base = `${apiUrl}/api/v1/device`;
  const apiOrigin = new URL(apiUrl).origin;
  const baseHeaders = {
    Authorization: `Device ${deviceToken}`,
    "User-Agent": userAgent,
    Accept: "application/json",
  };

  async function call(url, init, timeoutMs, signal) {
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

  async function request(method, pathname, { query, json, form, timeoutMs = 15_000, signal } = {}) {
    const url = new URL(base + pathname);
    for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, value);
    const headers = { ...baseHeaders };
    let body;
    if (json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(json);
    } else if (form) {
      body = form; // fetch sets the multipart boundary
    }

    const { res, body: text } = await call(url, { method, headers, body }, timeoutMs, signal);
    let envelope = null;
    try {
      envelope = JSON.parse(text);
    } catch (_err) {
      envelope = null;
    }
    if (!res.ok || !envelope || envelope.success === false) {
      const message = envelope?.message || `HTTP ${res.status}`;
      throw new ApiError(`${method} ${pathname}: ${message}`, {
        status: res.ok ? 502 : res.status,
        code: envelope?.code ?? null,
        detail: message,
        retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
      });
    }
    return envelope.data ?? {};
  }

  const clipPath = (clipId, action) => `/clips/${encodeURIComponent(clipId)}/${action}`;

  return {
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

    /** multipart: `video` (video/mp4, *.mp4, required), `thumbnail` (image/jpeg, *.jpg). */
    async uploadClip(clipId, { videoPath, thumbnailPath }, signal) {
      const form = new FormData();
      const video = await fs.openAsBlob(videoPath, { type: "video/mp4" });
      form.append("video", video, "clip.mp4");
      let size = video.size;
      if (thumbnailPath) {
        const thumbnail = await fs.openAsBlob(thumbnailPath, { type: "image/jpeg" });
        form.append("thumbnail", thumbnail, "thumbnail.jpg");
        size += thumbnail.size;
      }
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
        url.origin === apiOrigin ? { ...baseHeaders, Accept: "*/*" } : { "User-Agent": userAgent };
      const { res, body } = await call(url, { method: "GET", headers, raw: true }, 30_000);
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
