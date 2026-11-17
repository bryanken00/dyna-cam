/**
 * RTMP ingest addresses: stream-key masking and reading ffmpeg's log lines —
 * pure, unit-tested. The streams themselves are restreams (restream.js).
 */

/** The secret part of an ingest URL: everything after the app (first path segment), or the only segment. */
export function streamSecret(rtmpUrl) {
  const url = String(rtmpUrl || "");
  if (!/^rtmps?:\/\//i.test(url)) return null;
  const slash = url.indexOf("/", url.indexOf("://") + 3);
  if (slash === -1) return null;
  const parts = url.slice(slash + 1).split("/");
  const secret = parts.length >= 2 ? parts.slice(1).join("/") : parts[0];
  return secret || null;
}

/** `****wxyz` — at most the last 4 characters of a key (before any query). */
export const maskKey = (secret) => `****${String(secret).split("?")[0].slice(-4)}`;

/** `rtmp://a.rtmp.youtube.com/live2/abcd-efgh-ijkl-mnop` → `rtmp://a.rtmp.youtube.com/live2/****mnop`. */
export function maskStreamUrl(rtmpUrl) {
  const secret = streamSecret(rtmpUrl);
  if (!secret) return rtmpUrl;
  const url = String(rtmpUrl);
  return url.slice(0, url.length - secret.length) + maskKey(secret);
}

/** Replace every occurrence of the stream key in a log line. */
export function maskStreamKey(text, rtmpUrl) {
  const secret = streamSecret(rtmpUrl);
  if (!secret || text === null || text === undefined) return text;
  let out = String(text);
  for (const form of new Set([secret, secret.split("?")[0]])) {
    if (form.length >= 4) out = out.split(form).join(maskKey(secret));
  }
  return out;
}

/** `[fifo @ 0x1] [error] text` → { component: "fifo", level: "error", text }. */
const LEVELS = new Set(["trace", "debug", "verbose", "info", "warning", "error", "fatal", "panic"]);

export function parseLogLine(line) {
  let rest = String(line).trim();
  let component = null;
  // "[fifo @ 0x7c…] " — a component prefix (not a level)
  const first = /^\[([^\]]*)\] /.exec(rest);
  if (first && !LEVELS.has(first[1])) {
    component = first[1].split(" @ ")[0].trim();
    rest = rest.slice(first[0].length);
  }
  const level = /^\[([a-z]+)\] /.exec(rest);
  if (!level || !LEVELS.has(level[1])) return { component, level: null, text: rest };
  return { component, level: level[1], text: rest.slice(level[0].length).trim() };
}
