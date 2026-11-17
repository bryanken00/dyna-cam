import { spawn } from "node:child_process";
import { encoderSettings } from "./clipper.js";
import { maskStreamKey, maskStreamUrl, parseLogLine } from "./stream.js";
import { backoffMs, maskCredentials, truncate } from "./util.js";

/**
 * Every live stream of the box is a restream (PLAN-002 §6.1, §7.3): its own
 * small ffmpeg that reads the court's LAN live view from this box (live.js,
 * on 127.0.0.1) and sends it to an RTMP/RTMPS address. The recorder is never
 * touched or restarted, and there is no second camera connection.
 *
 * - The venue's court stream: /config `courts[].stream: { rtmpUrl, layout }`,
 *   runs while the court is recorded; status in camera 1's heartbeat entry.
 * - A player's own stream: /config `sessions[].stream: { url, layout }`, runs
 *   inside the session window; status in the heartbeat's `sessionStreams`.
 *
 * Layouts: CAM1 / CAM2 copy that camera's video (audio → AAC 44.1 kHz);
 * STACKED decodes both cameras, scales each to 1280×720, stacks Cam 1 over
 * Cam 2 and encodes 1280×1440 H.264 (the box's encoder, keyframe every 2 s).
 * A failure here only affects that stream. Addresses hold stream keys, which
 * are never logged or reported (masked as `…/****abcd`).
 */

export const MAX_SESSION_STREAMS = 4;
export const DEFAULT_MAX_STACKED = 2;
export const LAYOUTS = ["CAM1", "CAM2", "STACKED"];
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
/** A player's input link stays valid this long after the session ends… */
const LINK_AFTER_END_S = 600;
/** …a court stream's for a day; either is re-signed (with a restart) before it expires. */
const COURT_LINK_S = 24 * 3600;
const RESIGN_BEFORE_MS = 60_000;
/** A stream switches layout (a camera came back or went away) at most this often. */
const LAYOUT_SWITCH_MS = 30_000;
const STACK_WIDTH = 1280;
const STACK_HEIGHT = 720;

export const LIVE_OFF_MESSAGE = "Live view is off on this box (LIVE_PORT=0)";
export const STACKED_CAP_MESSAGE = "Too many stacked streams on this box — choose Cam 1 or Cam 2";
const LIVE_DOWN_MESSAGE = "Live view isn't running on this box — check the box log";
const NO_VIDEO_MESSAGE = "No video from the camera yet";

const isStreamUrl = (url) => typeof url === "string" && /^rtmps?:\/\/[^\s/]+\/\S+$/i.test(url);

/** An unknown or missing layout (an older API) is CAM1. */
export const normalizeLayout = (layout) => (LAYOUTS.includes(layout) ? layout : "CAM1");

/**
 * What to run for a requested layout, given the court's cameras on this box
 * ([{ camera, up }]). CAM2/STACKED need camera 2 (else CAM1). STACKED with one
 * camera down streams the other one alone, with a note. → { layout, note? }
 */
export function planLayout(requested, cameras) {
  const cam = (n) => cameras.find((c) => c.camera === n);
  let layout = normalizeLayout(requested);
  if (layout !== "CAM1" && !cam(2)) layout = "CAM1";
  if (layout === "CAM1" && !cam(1) && cam(2)) layout = "CAM2";
  if (layout !== "STACKED") return { layout };
  const up1 = Boolean(cam(1)?.up);
  const up2 = Boolean(cam(2)?.up);
  if (up1 && !up2) return { layout: "CAM1", note: "Camera 2 has no video — showing Camera 1" };
  if (up2 && !up1) return { layout: "CAM2", note: "Camera 1 has no video — showing Camera 2" };
  return { layout: "STACKED" };
}

/** Frame rate of a stacked stream: the slower camera's, ≤ 30; 25 when neither is known yet. */
export function stackFps(fpsList) {
  const known = (fpsList || []).filter((f) => Number.isFinite(f) && f > 0);
  if (!known.length) return 25;
  return Math.max(1, Math.min(30, Math.round(Math.min(...known))));
}

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

/** The live HLS input of one camera: kept reading and reconnecting, paced in real time. */
const hlsInput = (url) => [
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
  url,
];

// Audio is re-encoded (cheap: one mono track) to 44.1 kHz — cameras send 8 kHz,
// which Facebook and YouTube may warn about or play silent
const AUDIO_OUT = ["-c:a", "aac", "-ar", "44100", "-b:a", "96k"];
const FLV_OUT = ["-f", "flv", "-flvflags", "no_duration_filesize"];

/**
 * ffmpeg arguments for one restream. `inputs` = the live playlist link of each
 * camera used (one, or two for STACKED). Progress goes to stdout as key=value
 * blocks.
 *   CAM1 / CAM2: video copied, audio → AAC 44.1 kHz → FLV.
 *   STACKED: each camera scaled into 1280×720 (aspect kept, padded) at the
 *   slower camera's rate, Cam 1 over Cam 2 → 1280×1440 H.264 with `encoder`,
 *   ~3 Mbit/s, keyframe every 2 s; audio from input `audioInput`.
 */
export function buildRestreamArgs({
  inputs,
  outputUrl,
  layout = "CAM1",
  encoder = "libx264",
  vaapiDevice,
  fps = 25,
  audioInput = 0,
}) {
  const head = [
    "-hide_banner",
    "-nostdin",
    "-nostats",
    "-loglevel",
    "level+warning",
    "-progress",
    "pipe:1",
  ];
  if (layout !== "STACKED") {
    return [
      ...head,
      ...hlsInput(inputs[0]),
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-c:v",
      "copy",
      ...AUDIO_OUT,
      ...FLV_OUT,
      outputUrl,
    ];
  }
  const enc = encoderSettings(encoder, { vaapiDevice, quality: "stream" });
  const tile = (i, label) =>
    `[${i}:v:0]scale=${STACK_WIDTH}:${STACK_HEIGHT}:force_original_aspect_ratio=decrease,` +
    `pad=${STACK_WIDTH}:${STACK_HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}[${label}]`;
  const filter = `${tile(0, "top")};${tile(1, "bottom")};[top][bottom]vstack=inputs=2,${enc.tail}[v]`;
  return [
    ...head,
    ...enc.input,
    ...hlsInput(inputs[0]),
    ...hlsInput(inputs[1]),
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-map",
    `${audioInput}:a?`,
    ...enc.codec,
    "-g",
    String(fps * 2),
    "-force_key_frames",
    "expr:gte(t,n_forced*2)",
    ...AUDIO_OUT,
    ...FLV_OUT,
    outputUrl,
  ];
}

const PROGRESS_KEYS = ["out_time_us", "frame", "total_size"];

/** Is a session in its window? */
const inWindow = (s, nowMs) => nowMs >= s.startMs && nowMs < s.endMs;

/**
 * One stream (a court's or a player's): its ffmpeg, retry state and status.
 * `job` = { id, kind: "court" | "session", courtId, sessionId?, name?, url, layout, endMs? }.
 */
class Restream {
  constructor(job, manager, plannedLayout) {
    this.id = job.id;
    this.kind = job.kind;
    this.courtId = job.courtId;
    this.sessionId = job.sessionId ?? null;
    this.name = job.name ?? null;
    this.url = job.url;
    this.layout = job.layout; // as requested
    this.plannedLayout = plannedLayout; // what to run (manager.plan)
    this.runningLayout = null;
    this.note = null;
    this.endMs = job.endMs ?? null;
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
    const what =
      this.kind === "session"
        ? `player stream for session ${this.sessionId}`
        : `court stream for ${this.name || this.courtId}`;
    return `${what} (${maskStreamUrl(this.url)})`;
  }

  /** The layout counted against the stacked cap. */
  get layoutNow() {
    return this.runningLayout ?? this.plannedLayout;
  }

  setError(message) {
    if (this.status !== "error" || this.message !== message) {
      this.log.warn(`${this.label}: ${message}`);
    }
    this.status = "error";
    this.message = truncate(message, 255);
  }

  /** The input link(s) for the planned layout, or null when the live view isn't running. */
  inputs(exp) {
    const link = (camera) => this.manager.live.localPlaylistUrl(this.courtId, exp, camera);
    const cams = { CAM1: [1], CAM2: [2], STACKED: [1, 2] }[this.plannedLayout] || [1];
    const urls = cams.map(link);
    return urls.every(Boolean) ? urls : null;
  }

  spawn(nowMs) {
    const nowS = Math.ceil(nowMs / 1000);
    const exp =
      this.kind === "session"
        ? Math.max(Math.ceil(this.endMs / 1000), nowS) + LINK_AFTER_END_S
        : nowS + COURT_LINK_S;
    const inputs = this.inputs(exp);
    if (!inputs) {
      this.setError(LIVE_DOWN_MESSAGE);
      this.restartAt = nowMs + RESTART_MAX_MS;
      return;
    }
    const cams = this.manager.cameras(this.courtId);
    const info = (n) => cams.find((c) => c.camera === n) || {};
    const stacked = this.plannedLayout === "STACKED";
    const args = buildRestreamArgs({
      inputs,
      outputUrl: this.url,
      layout: this.plannedLayout,
      encoder: this.manager.encoder,
      vaapiDevice: this.manager.vaapiDevice,
      fps: stackFps([info(1).fps, info(2).fps]),
      // Sound from Cam 1, Cam 2's when Cam 1 has none
      audioInput: stacked && info(1).hasAudio === false && info(2).hasAudio ? 1 : 0,
    });
    this.runningLayout = this.plannedLayout;
    this.note = this.manager.plan(this).note ?? null;
    this.expMs = exp * 1000;
    this.startedAt = nowMs;
    this.steadySince = 0;
    this.lastProgressAt = 0;
    this.progress = {};
    this.block = {};
    this.errors = [];
    this.killReason = null;
    if (this.status !== "error") this.message = `Connecting to ${this.platform.name}`;
    this.log.info(`starting ${this.label} — ${this.runningLayout.toLowerCase()}`);
    let child;
    try {
      child = this.manager.spawnImpl(this.manager.ffmpegPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
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
      this.message = `Live on ${this.platform.name}${this.note ? ` (${this.note})` : ""}`;
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
 * All streams of this box. `setCourts` / `setSessions` take /config;
 * `tick` (every second) starts, stops, restarts and watches them.
 * `live` = the LiveView (`settings.livePort`, `localPlaylistUrl()`),
 * `cameras(courtId)` = the court's cameras on this box ([{ camera, up, fps, hasAudio }],
 * [] when this box doesn't record it), `encoder` = the clip encoder (detectEncoder).
 */
export class Restreams {
  constructor({
    live,
    cameras,
    log,
    ffmpegPath = "ffmpeg",
    encoder = "libx264",
    vaapiDevice,
    spawnImpl = spawn,
    now = () => Date.now(),
    max = MAX_SESSION_STREAMS,
    maxStacked = DEFAULT_MAX_STACKED,
  }) {
    this.live = live;
    this.cameras = cameras;
    this.log = log;
    this.ffmpegPath = ffmpegPath;
    this.encoder = encoder;
    this.vaapiDevice = vaapiDevice;
    this.spawnImpl = spawnImpl;
    this.now = now;
    this.max = max;
    this.maxStacked = maxStacked;
    this.courts = [];
    this.sessions = [];
    this.streams = new Map(); // job id → Restream (running, or waiting to retry)
    this.blocked = new Map(); // job id → why it can't run
    this.warned = new Set();
    this.timer = null;
  }

  get liveOff() {
    return !this.live?.settings?.livePort;
  }

  /** /config courts; only those with `stream.rtmpUrl` matter here. */
  setCourts(courts) {
    this.courts = (Array.isArray(courts) ? courts : [])
      .filter((c) => c?.courtId && c.stream?.rtmpUrl)
      .map((c) => ({
        id: `court:${c.courtId}`,
        kind: "court",
        courtId: c.courtId,
        name: c.name,
        url: c.stream.rtmpUrl,
        layout: normalizeLayout(c.stream.layout),
      }));
  }

  /** /config sessions; only those with `stream.url` matter here. */
  setSessions(sessions) {
    this.sessions = (Array.isArray(sessions) ? sessions : []).filter(
      (s) => s?.sessionId && s.stream?.url
    );
  }

  /** Sessions with a stream, in their window, on a court this box records. */
  current(nowMs) {
    return this.sessions.filter((s) => inWindow(s, nowMs) && this.cameras(s.courtId).length > 0);
  }

  /** Any player stream due now? (config is then re-read every 15 s) */
  recordingNow(nowMs = this.now()) {
    return this.current(nowMs).length > 0;
  }

  /** Every stream that should run now: court streams first, then players' by start time. */
  jobs(nowMs) {
    const courts = this.courts.filter((c) => this.cameras(c.courtId).length > 0);
    const sessions = this.current(nowMs)
      .sort((a, b) => a.startMs - b.startMs || String(a.sessionId).localeCompare(b.sessionId))
      .map((s) => ({
        id: `session:${s.sessionId}`,
        kind: "session",
        courtId: s.courtId,
        sessionId: s.sessionId,
        url: s.stream.url,
        layout: normalizeLayout(s.stream.layout),
        endMs: s.endMs,
      }));
    return [...courts, ...sessions];
  }

  /** What a job or stream should run now (see planLayout). */
  plan(job) {
    return planLayout(job.layout, this.cameras(job.courtId));
  }

  stackedCount(exceptId) {
    return [...this.streams.values()].filter((s) => s.id !== exceptId && s.layoutNow === "STACKED")
      .length;
  }

  /** Stop streams whose job is gone or changed, or whose layout should switch. */
  async stopChanged(jobs, nowMs) {
    for (const [id, stream] of this.streams) {
      const next = jobs.find((j) => j.id === id);
      let why = null;
      if (!next) why = "stopping";
      else if (next.url !== stream.url) why = "stream address changed — restarting";
      else if (next.layout !== stream.layout) why = "layout changed — restarting";
      else {
        stream.endMs = next.endMs ?? null;
        const planned = this.plan(next).layout;
        const switchable =
          planned !== stream.layoutNow &&
          nowMs - stream.startedAt >= LAYOUT_SWITCH_MS &&
          (planned !== "STACKED" || this.stackedCount(id) < this.maxStacked);
        if (switchable) why = `cameras changed — switching to ${planned.toLowerCase()}`;
      }
      if (!why) continue;
      this.log.info(`${stream.label}: ${why}`);
      this.streams.delete(id);
      await stream.stop();
    }
  }

  /** Why a job can't start now, or null. */
  cannotRun(job, planned) {
    if (this.liveOff) return LIVE_OFF_MESSAGE;
    if (!isStreamUrl(job.url)) return "The stream address must start with rtmp:// or rtmps://";
    const players = [...this.streams.values()].filter((s) => s.kind === "session").length;
    if (job.kind === "session" && players >= this.max) {
      return `Too many player streams on this box (at most ${this.max})`;
    }
    if (planned === "STACKED" && this.stackedCount() >= this.maxStacked) {
      return STACKED_CAP_MESSAGE;
    }
    return null;
  }

  /** Make the running processes match config, then watch each one. */
  async tick(nowMs = this.now()) {
    if (this.stopped) return;
    const jobs = this.jobs(nowMs);
    await this.stopChanged(jobs, nowMs);
    this.blocked.clear();
    for (const job of jobs) {
      if (this.streams.has(job.id)) continue;
      const planned = this.plan(job).layout;
      const reason = this.cannotRun(job, planned);
      if (!reason) {
        this.streams.set(job.id, new Restream(job, this, planned));
        continue;
      }
      this.blocked.set(job.id, reason);
      const cap = reason.startsWith("Too many");
      if (cap && !this.warned.has(job.id)) {
        this.log.warn(
          `${job.kind === "session" ? "player" : "court"} stream not started: ${reason}`
        );
      }
      if (cap) this.warned.add(job.id);
    }
    for (const id of this.warned) if (!this.blocked.has(id)) this.warned.delete(id);
    for (const stream of this.streams.values()) stream.tick(nowMs);
  }

  /** A job's status: its stream's, why it is blocked, or starting. */
  statusOf(id) {
    const stream = this.streams.get(id);
    if (stream) return { status: stream.status, message: stream.message };
    if (this.blocked.has(id)) return { status: "error", message: this.blocked.get(id) };
    return { status: "starting", message: "Starting" };
  }

  /** Heartbeat `sessionStreams`: one entry per player stream due now (running, retrying or blocked). */
  statuses(nowMs = this.now()) {
    return this.current(nowMs).map((s) => {
      const { status, message } = this.statusOf(`session:${s.sessionId}`);
      return { sessionId: s.sessionId, status, message: truncate(message, 255) };
    });
  }

  /** The venue stream of a court, for camera 1's heartbeat entry: { streamStatus, streamMessage? }. */
  courtStatus(courtId) {
    if (!this.courts.some((c) => c.courtId === courtId)) return { streamStatus: "off" };
    const { status, message } = this.statusOf(`court:${courtId}`);
    return { streamStatus: status, streamMessage: truncate(message, 255) };
  }

  startTicker(intervalMs = 1000) {
    const run = async () => {
      try {
        await this.tick();
      } catch (err) {
        this.log.warn("streams: tick failed", err);
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
