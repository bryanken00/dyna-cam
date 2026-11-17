/**
 * Live streaming (RTMP restream) helpers — pure, unit-tested.
 *
 * A Tapo C200 serves ONE RTSP client at a time, so the stream is a second
 * output of the court's recorder ffmpeg, never a second camera connection:
 *
 *   -f tee "[f=segment:…]<dir>/%s.ts|[f=flv:onfail=ignore:use_fifo=1:fifo_options=…]rtmp://…"
 *
 * `onfail=ignore` keeps the recording going when the RTMP side fails, and the
 * fifo wrapper (`drop_pkts_on_overflow`, `attempt_recovery`) runs the RTMP
 * output in its own thread: a slow uplink drops stream packets instead of
 * blocking the recording, and a dropped connection is reconnected inside
 * ffmpeg (every 10 s) without restarting the recorder.
 */

/** Seconds between the fifo's reconnect attempts. */
export const STREAM_RECOVERY_SECONDS = 10;
/** A recorder restart for streaming happens at most this often… */
export const STREAM_RESTART_MIN_INTERVAL_MS = 5 * 60_000;
/** …and never while an uncut clip/part window reaches into the last this-many ms. */
export const STREAM_RESTART_GUARD_MS = 70_000;

/**
 * Tee escaping. The tee list is split on "|" with av_get_token (level 1:
 * backslash-escape `\ ' |`); slave option values are read again up to ":" or
 * "]" (level 2: `\ ' : ]`). A file name after "]" only goes through level 1.
 */
const level1 = (s) => String(s).replace(/[\\'|]/g, "\\$&");
const level2 = (s) => String(s).replace(/[\\':\]]/g, "\\$&");
export const escapeTeeFilename = (s) => level1(s);
export const escapeTeeOption = (s) => level1(level2(s));

/** `[k=v:k=v]file` for one tee slave. */
export const teeSlave = (options, filename) =>
  `[${Object.entries(options)
    .map(([k, v]) => `${k}=${escapeTeeOption(v)}`)
    .join(":")}]${escapeTeeFilename(filename)}`;

/** The RTMP slave: FLV in a fifo that drops packets instead of blocking, and reconnects. */
export const streamSlave = (rtmpUrl) =>
  teeSlave(
    {
      f: "flv",
      onfail: "ignore",
      use_fifo: "1",
      fifo_options: [
        "drop_pkts_on_overflow=1",
        "attempt_recovery=1",
        "recover_any_error=1",
        `recovery_wait_time=${STREAM_RECOVERY_SECONDS}`,
        "restart_with_keyframe=1",
        "queue_size=300",
      ].join(":"),
      flvflags: "no_duration_filesize",
    },
    rtmpUrl
  );

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

/** Replace every occurrence of the stream key (plain or tee-escaped) in a log line. */
export function maskStreamKey(text, rtmpUrl) {
  const secret = streamSecret(rtmpUrl);
  if (!secret || text === null || text === undefined) return text;
  let out = String(text);
  for (const form of new Set([secret, escapeTeeFilename(secret), secret.split("?")[0]])) {
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

/** A readable reason for a failed RTMP connection. */
export function describeStreamFailure(text) {
  const t = String(text || "");
  if (
    /\b40[134]\b|forbidden|unauthori[sz]ed|rejected|badname|bad name|invalid (stream )?key|server error|publish/i.test(
      t
    )
  ) {
    return "Stream rejected — check the stream key";
  }
  if (
    /refused|cannot open connection|timed out|timeout|unreachable|no route|resolve|getaddrinfo|name or service|network is down|broken pipe|reset by peer|end of file|input\/output error|tls|ssl|handshake/i.test(
      t
    )
  ) {
    return "Can't reach the streaming service";
  }
  return `Stream error: ${t}`.slice(0, 255);
}

const STREAM_COMPONENTS = new Set(["fifo", "flv", "rtmp", "rtmps", "tls", "tee"]);

/**
 * What a recorder stderr line means for the stream:
 *   { event: "recovered" }               the fifo reconnected
 *   { event: "error", message }           failed, the fifo keeps retrying
 *   { event: "dead", message }            the RTMP slave is gone for this run
 *   null                                   nothing to do with the stream
 */
export function classifyStreamLine(parsed) {
  const { component, level, text } = parsed;
  if (component === "fifo" && /^Recovery successful/i.test(text)) return { event: "recovered" };
  if (
    /Slave muxer #1 failed/i.test(text) ||
    (component === "tee" && /Slave '.*rtmps?:/i.test(text))
  ) {
    return { event: "dead", message: describeStreamFailure(text) };
  }
  if (!STREAM_COMPONENTS.has(component) || component === "tee") return null;
  if (level !== "error" && level !== "fatal" && !/Recovery failed/i.test(text)) return null;
  return { event: "error", message: describeStreamFailure(text) };
}

/**
 * May the recorder be restarted for the stream now? Not more often than
 * `minIntervalMs` (config changes pass 0), and never while a clip/part window
 * that isn't cut yet reaches into the last `guardMs` — a restart leaves a few
 * seconds' gap in the recording.
 */
export function streamRestartAllowed({
  nowMs,
  lastRestartMs = 0,
  minIntervalMs = STREAM_RESTART_MIN_INTERVAL_MS,
  pendingWindows = [],
  guardMs = STREAM_RESTART_GUARD_MS,
}) {
  if (nowMs - lastRestartMs < minIntervalMs) return false;
  return !pendingWindows.some((w) => w.endMs > nowMs - guardMs);
}
