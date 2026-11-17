import { spawn } from "node:child_process";
import { maskStreamKey, maskStreamUrl, parseLogLine } from "./stream.js";
import { backoffMs, maskCredentials, truncate } from "./util.js";

/**
 * A player's own live stream (PLAN-002 §6.1): one small ffmpeg per session
 * that reads the court's LAN live view from this box (live.js, on 127.0.0.1)
 * and copies it to the player's RTMP/RTMPS address — no re-encode, no second
 * camera connection, and the court's recorder is never touched or restarted.
 * A failure here only affects that player's stream.
 *
 * /config sessions carry `stream: { url } | null`; the url holds the player's
 * stream key, which is never logged or reported (masked as `…/****abcd`).
 */

export const MAX_SESSION_STREAMS = 4;
const RESTART_BASE_MS = 5000;
const RESTART_MAX_MS = 60_000;
/** Output moving for this long without a pause → "live". */
export const STEADY_MS = 5000;
/** Progress reports further apart than this break a steady run. */
const PAUSE_MS = 3000;
/** No output for this long → kill and retry. */
export const STALL_MS = 30_000;
/** A run this long resets the backoff. */
const STABLE_RUN_MS = 60_000;
/** The input link stays valid this long after the session ends… */
const LINK_AFTER_END_S = 600;
/** …and is re-signed (with a restart) this long before it expires. */
const RESIGN_BEFORE_MS = 60_000;

export const LIVE_OFF_MESSAGE = "Live view is off on this box (LIVE_PORT=0)";
const LIVE_DOWN_MESSAGE = "Live view isn't running on this box — check the box log";
const NO_VIDEO_MESSAGE = "No video from the camera yet";

const isStreamUrl = (url) => typeof url === "string" && /^rtmps?:\/\/[^\s/]+\/\S+$/i.test(url);

/** "Facebook" / "facebook.com" for a player's ingest address. */
export function platformOf(url) {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch (_err) {
    host = "";
  }
  if (/(^|\.)facebook\.com$|fbcdn/.test(host)) return { name: "Facebook", site: "facebook.com" };
  if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(host)) {
    return { name: "YouTube", site: "youtube.com" };
  }
  return { name: host || "the streaming service", site: host || "the streaming service" };
}

/** Hide the stream key (plain or in a URL), any password, and the live-view signature. */
export const maskRestreamLine = (line, url) =>
  maskCredentials(maskStreamKey(String(line ?? ""), url)).replace(/\bsig=[0-9a-f]+/gi, "sig=***");

/**
 * A short message staff and the player can act on, from ffmpeg's error lines
 * of one run (masked, `[component] text`, oldest first). ffmpeg's last line
 * is often generic ("Input/output error"), so the whole run is read.
 */
export function describeRestreamFailure(errorLines, url) {
  const lines = (Array.isArray(errorLines) ? errorLines : [errorLines]).filter(Boolean);
  const t = lines.join("\n");
  const { name, site } = platformOf(url);
  // The input: this box's own live view (hls demuxer, its http reads, "Error opening input")
  if (/^\[(hls|http|in#\d+)\]|index\.m3u8|opening input/im.test(t)) {
    if (/\b403\b|forbidden/i.test(t)) return "The box refused its own live-view link — restarting";
    return NO_VIDEO_MESSAGE;
  }
  if (
    /\b40[134]\b|forbidden|unauthori[sz]ed|authentication|rejected|badname|bad name|invalid (stream )?key|publish\.?(denied|badname)|server error/i.test(
      t
    )
  ) {
    return `${name} refused the stream key`;
  }
  if (/handshake|certificate|\bssl\b|tls (connection|error|alert)|non-properly/i.test(t)) {
    return `Secure connection to ${site} failed`;
  }
  if (
    /refused|cannot open connection|timed out|timeout|unreachable|no route|resolve|getaddrinfo|name or service|network is down/i.test(
      t
    )
  ) {
    return `Can't reach ${site}`;
  }
  if (
    /broken pipe|reset by peer|end of file|input\/output error|i\/o error|error number/i.test(t)
  ) {
    return `Connection to ${site} dropped`;
  }
  const last = lines.at(-1)?.replace(/^\[[^\]]*\] /, "");
  return truncate(last ? `Stream error: ${last}` : `Stream to ${name} stopped`, 255);
}

/**
 * ffmpeg arguments: the live HLS in (kept reading, reconnecting), FLV out,
 * every stream copied. Progress goes to stdout as key=value blocks.
 */
export const buildRestreamArgs = ({ inputUrl, outputUrl }) => [
  "-hide_banner",
  "-nostdin",
  "-nostats",
  "-loglevel",
  "level+warning",
  "-progress",
  "pipe:1",
  // Segment links end in "?exp=…&sig=…", which the HLS reader refuses otherwise
  "-extension_picky",
  "0",
  "-live_start_index",
  "-3",
  "-max_reload",
  "1000",
  "-m3u8_hold_counters",
  "1000",
  "-reconnect",
  "1",
  "-reconnect_streamed",
  "1",
  "-reconnect_on_network_error",
  "1",
  "-reconnect_delay_max",
  "5",
  "-re",
  "-i",
  inputUrl,
  "-map",
  "0:v:0",
  "-map",
  "0:a?",
  // Video is copied as it comes. Audio is re-encoded (cheap: one mono AAC track)
  // to 44.1 kHz — the camera sends 8 kHz, which Facebook and YouTube may warn about
  // or play silent.
  "-c:v",
  "copy",
  "-c:a",
  "aac",
  "-ar",
  "44100",
  "-b:a",
  "96k",
  "-f",
  "flv",
  "-flvflags",
  "no_duration_filesize",
  outputUrl,
];

const PROGRESS_KEYS = ["out_time_us", "frame", "total_size"];

/** Is a session in its window with a usable stream? */
const inWindow = (s, nowMs) => nowMs >= s.startMs && nowMs < s.endMs;

/** One player's stream: its ffmpeg, retry state and status. */
class SessionStream {
  constructor(session, manager) {
    this.sessionId = session.sessionId;
    this.courtId = session.courtId;
    this.url = session.stream.url;
    this.endMs = session.endMs;
    this.manager = manager;
    this.platform = platformOf(this.url);
    this.child = null;
    this.status = "starting";
    this.message = `Connecting to ${this.platform.name}`;
    this.failures = 0;
    this.restartAt = 0;
    this.startedAt = 0;
    this.expMs = 0;
    this.steadySince = 0;
    this.lastProgressAt = 0;
    this.progress = {};
    this.block = {};
    this.errors = [];
    this.killReason = null;
    this.stopping = false;
  }

  get log() {
    return this.manager.log;
  }

  get label() {
    return `player stream for session ${this.sessionId} (${maskStreamUrl(this.url)})`;
  }

  setError(message) {
    if (this.status !== "error" || this.message !== message) {
      this.log.warn(`${this.label}: ${message}`);
    }
    this.status = "error";
    this.message = truncate(message, 255);
  }

  spawn(nowMs) {
    const exp = Math.max(
      Math.ceil(this.endMs / 1000) + LINK_AFTER_END_S,
      Math.ceil(nowMs / 1000) + LINK_AFTER_END_S
    );
    const inputUrl = this.manager.live.localPlaylistUrl(this.courtId, exp);
    if (!inputUrl) {
      this.setError(LIVE_DOWN_MESSAGE);
      this.restartAt = nowMs + RESTART_MAX_MS;
      return;
    }
    this.expMs = exp * 1000;
    this.startedAt = nowMs;
    this.steadySince = 0;
    this.lastProgressAt = 0;
    this.progress = {};
    this.block = {};
    this.errors = [];
    this.killReason = null;
    if (this.status !== "error") this.message = `Connecting to ${this.platform.name}`;
    this.log.info(`starting ${this.label}`);
    let child;
    try {
      child = this.manager.spawnImpl(
        this.manager.ffmpegPath,
        buildRestreamArgs({ inputUrl, outputUrl: this.url }),
        { stdio: ["ignore", "pipe", "pipe"] }
      );
    } catch (err) {
      this.errors.push(`cannot start ffmpeg: ${err.code || err.message}`);
      this.onExit(null, null, null);
      return;
    }
    this.child = child;
    lines(child.stdout, (line) => this.onProgressLine(line));
    lines(child.stderr, (line) => this.onStderrLine(line));
    child.on("error", (err) => {
      this.errors.push(`cannot start ffmpeg: ${err.code || err.message}`);
    });
    child.on("close", (code, signal) => this.onExit(child, code, signal));
  }

  /**
   * `-progress` key=value lines; a block ends with `progress=continue|end`.
   * Output time, frames or bytes going up = the stream is moving.
   */
  onProgressLine(line) {
    const eq = line.indexOf("=");
    const key = line.slice(0, eq);
    const value = Number(line.slice(eq + 1));
    if (PROGRESS_KEYS.includes(key)) {
      if (Number.isFinite(value)) this.block[key] = value;
      return;
    }
    if (key !== "progress") return;
    const moved = PROGRESS_KEYS.some((k) => this.block[k] > (this.progress[k] ?? -1));
    this.progress = { ...this.progress, ...this.block };
    this.block = {};
    if (!moved) return;
    const now = this.manager.now();
    if (!this.steadySince || now - this.lastProgressAt > PAUSE_MS) this.steadySince = now;
    this.lastProgressAt = now;
  }

  /** Error lines (masked first) are kept for the status message; warnings are ignored. */
  onStderrLine(raw) {
    const { component, level, text } = parseLogLine(maskRestreamLine(raw, this.url));
    if (level !== null && !["error", "fatal", "panic"].includes(level)) return;
    this.errors.push(component ? `[${component}] ${text}` : text);
    if (this.errors.length > 12) this.errors.shift();
  }

  onExit(child, code, signal) {
    if (child && this.child !== child) return;
    this.child = null;
    if (this.stopping) return;
    const now = this.manager.now();
    if (this.killReason === "resign") {
      this.restartAt = now; // planned: a fresh link, no backoff
      return;
    }
    const ranMs = now - this.startedAt;
    this.failures = ranMs >= STABLE_RUN_MS ? 1 : this.failures + 1;
    const delay = backoffMs(this.failures, RESTART_BASE_MS, RESTART_MAX_MS);
    this.restartAt = now + delay;
    const message = this.killReason || describeRestreamFailure(this.errors, this.url);
    this.log.debug(
      `${this.label} exited (${signal || `code ${code}`}); retrying in ${Math.round(delay / 1000)}s`
    );
    this.setError(message);
  }

  tick(nowMs) {
    if (!this.child) {
      if (nowMs >= this.restartAt) this.spawn(nowMs);
      return;
    }
    const moving = this.lastProgressAt && nowMs - this.lastProgressAt <= PAUSE_MS;
    if (moving && this.lastProgressAt - this.steadySince >= STEADY_MS) {
      if (this.status !== "live") this.log.info(`${this.label} is live`);
      this.status = "live";
      this.message = `Live on ${this.platform.name}`;
      if (nowMs - this.startedAt >= STABLE_RUN_MS) this.failures = 0;
    }
    if (this.killReason) return; // already being stopped
    if (nowMs >= this.expMs - RESIGN_BEFORE_MS) {
      this.killReason = "resign";
      this.child.kill("SIGTERM");
      return;
    }
    const since = Math.max(this.startedAt, this.lastProgressAt);
    if (nowMs - since >= STALL_MS) {
      this.killReason = this.lastProgressAt
        ? `Stream to ${this.platform.name} stalled — restarting`
        : this.errors.length
          ? describeRestreamFailure(this.errors, this.url)
          : NO_VIDEO_MESSAGE;
      this.child.kill("SIGKILL");
    }
  }

  stop() {
    this.stopping = true;
    const child = this.child;
    if (!child) return Promise.resolve();
    return new Promise((resolve) => {
      const force = setTimeout(() => child.kill("SIGKILL"), 3000);
      child.once("close", () => {
        clearTimeout(force);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }

  report() {
    return { sessionId: this.sessionId, status: this.status, message: this.message };
  }
}

/** Call `fn` for each line of a readable stream. */
function lines(stream, fn) {
  if (!stream) return;
  let partial = "";
  stream.setEncoding?.("utf8");
  stream.on("data", (chunk) => {
    const parts = (partial + chunk).split(/\r?\n/);
    partial = parts.pop();
    for (const line of parts) if (line.trim()) fn(line.trim());
  });
}

/**
 * All player streams of this box. `setSessions` takes /config `sessions`;
 * `tick` (every second) starts, stops, restarts and watches them.
 * `live` = the LiveView (`settings.livePort`, `localPlaylistUrl()`),
 * `records(courtId)` = is the court recorded by this box.
 */
export class SessionStreams {
  constructor({
    live,
    records,
    log,
    ffmpegPath = "ffmpeg",
    spawnImpl = spawn,
    now = () => Date.now(),
    max = MAX_SESSION_STREAMS,
  }) {
    this.live = live;
    this.records = records;
    this.log = log;
    this.ffmpegPath = ffmpegPath;
    this.spawnImpl = spawnImpl;
    this.now = now;
    this.max = max;
    this.sessions = [];
    this.streams = new Map(); // sessionId → SessionStream (running, or waiting to retry)
    this.blocked = new Map(); // sessionId → reason it can't run (not reported as a process)
    this.timer = null;
  }

  get liveOff() {
    return !this.live?.settings?.livePort;
  }

  /** /config sessions; only those with `stream.url` matter here. */
  setSessions(sessions) {
    this.sessions = (Array.isArray(sessions) ? sessions : []).filter(
      (s) => s?.sessionId && s.stream?.url
    );
  }

  /** Sessions with a stream, in their window, on a court this box records. */
  current(nowMs) {
    return this.sessions.filter((s) => inWindow(s, nowMs) && this.records(s.courtId));
  }

  /** Any player stream due now? (config is then re-read every 15 s) */
  recordingNow(nowMs = this.now()) {
    return this.current(nowMs).length > 0;
  }

  /** Make the running processes match the sessions, then watch each one. */
  async tick(nowMs = this.now()) {
    if (this.stopped) return;
    const wanted = this.current(nowMs).sort(
      (a, b) => a.startMs - b.startMs || String(a.sessionId).localeCompare(b.sessionId)
    );
    const wantedIds = new Set(wanted.map((s) => s.sessionId));
    // Stop: session gone, out of its window, stream removed, or a new address
    for (const [id, stream] of this.streams) {
      const next = wanted.find((s) => s.sessionId === id);
      if (next && next.stream.url === stream.url) {
        stream.endMs = next.endMs;
        continue;
      }
      this.log.info(
        `${stream.label}: ${next ? "stream address changed — restarting" : "stopping"}`
      );
      this.streams.delete(id);
      await stream.stop();
    }
    this.blocked.clear();
    let capped = 0;
    for (const session of wanted) {
      if (this.streams.has(session.sessionId)) continue;
      const reason = this.cannotRun(session);
      if (reason) {
        this.blocked.set(session.sessionId, reason);
        if (reason.startsWith("Too many")) capped += 1;
        continue;
      }
      this.streams.set(session.sessionId, new SessionStream(session, this));
    }
    if (capped && !this.cappedWarned) {
      this.log.warn(
        `${capped} player stream(s) not started — this box runs at most ${this.max} at a time`
      );
    }
    this.cappedWarned = capped > 0;
    for (const stream of this.streams.values()) {
      if (wantedIds.has(stream.sessionId)) stream.tick(nowMs);
    }
  }

  cannotRun(session) {
    if (this.liveOff) return LIVE_OFF_MESSAGE;
    if (!isStreamUrl(session.stream.url)) {
      return "The stream address must start with rtmp:// or rtmps://";
    }
    if (this.streams.size >= this.max) {
      return `Too many player streams on this box (at most ${this.max})`;
    }
    return null;
  }

  /** Heartbeat `sessionStreams`: one entry per session with a stream now (running, retrying or blocked). */
  statuses(nowMs = this.now()) {
    const out = [];
    for (const session of this.current(nowMs)) {
      const stream = this.streams.get(session.sessionId);
      if (stream) out.push(stream.report());
      else if (this.blocked.has(session.sessionId)) {
        out.push({
          sessionId: session.sessionId,
          status: "error",
          message: this.blocked.get(session.sessionId),
        });
      } else {
        out.push({ sessionId: session.sessionId, status: "starting", message: "Starting" });
      }
    }
    return out.map((s) => ({ ...s, message: truncate(s.message, 255) }));
  }

  startTicker(intervalMs = 1000) {
    const run = async () => {
      try {
        await this.tick();
      } catch (err) {
        this.log.warn("player streams: tick failed", err);
      }
      if (!this.stopped) this.timer = setTimeout(run, intervalMs);
    };
    this.timer = setTimeout(run, intervalMs);
  }

  async stopAll() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = null;
    const streams = [...this.streams.values()];
    this.streams.clear();
    await Promise.all(streams.map((s) => s.stop()));
  }

  /** Last resort from process.on("exit"). */
  killAllSync() {
    for (const stream of this.streams.values()) {
      stream.stopping = true;
      stream.child?.kill("SIGKILL");
    }
  }
}
