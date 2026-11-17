import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  loadTimeline,
  readSegmentEntries,
  retentionWindows,
  RUN_FILE,
  SEGMENT_LIST,
  segmentsToPrune,
} from "./segments.js";
import {
  classifyStreamLine,
  maskStreamKey,
  maskStreamUrl,
  parseLogLine,
  streamRestartAllowed,
  streamSlave,
  teeSlave,
} from "./stream.js";
import { backoffMs, maskCredentials, safeId, truncate } from "./util.js";

/**
 * The rolling buffer: one ffmpeg per court stream-copies the camera's video
 * into short MPEG-TS segments named by the epoch second they started
 * (`<dir>/1763350000.ts`). Video is NEVER re-encoded here — that is what keeps
 * six courts on one small box. Audio is transcoded to AAC because cameras such
 * as the Tapo C200 send G.711 (pcm_alaw), which MPEG-TS stores as unplayable
 * `bin_data` when stream-copied.
 */

const RESTART_BASE_MS = 2_000;
const RESTART_MAX_MS = 30_000; // Wi-Fi cameras drop out; never wait longer than this
const STABLE_RUN_MS = 60_000; // a run this long resets the backoff
const STALL_MS = 20_000; // no new video for this long → kill and reconnect
const CONNECT_GRACE_MS = 30_000;
const RTSP_TIMEOUT_US = "10000000"; // 10 s socket timeout: a stalled stream exits instead of hanging

/**
 * ffmpeg arguments for one court's recorder. segments.csv lists each closed
 * segment's content start/end; segments.js turns those into wall-clock times.
 *
 * With `streamUrl` the same process also restreams to RTMP through the tee
 * muxer (stream.js) — a Tapo C200 accepts only one RTSP client, so the stream
 * can never open its own camera connection. The RTMP slave can fail without
 * touching the recording. Logs are `level+info` so stream events can be read.
 */
export function buildRecordArgs({
  rtspUrl,
  outDir,
  segmentSeconds,
  recordAudio = true,
  ffmpegMajor = 99,
  streamUrl = null,
}) {
  const segmentOptions = {
    segment_time: String(segmentSeconds),
    segment_format: "mpegts",
    segment_list: path.join(outDir, SEGMENT_LIST),
    segment_list_type: "csv",
    segment_list_size: "100",
    reset_timestamps: "1",
    strftime: "1",
  };
  const segmentsOut = path.join(outDir, "%s.ts");
  const output = streamUrl
    ? [
        // FLV needs the codec headers up front; YouTube wants 44.1/48 kHz audio
        "-flags",
        "+global_header",
        "-f",
        "tee",
        `${teeSlave({ f: "segment", ...segmentOptions }, segmentsOut)}|${streamSlave(streamUrl)}`,
      ]
    : [
        "-f",
        "segment",
        ...Object.entries(segmentOptions).flatMap(([k, v]) => [`-${k}`, v]),
        segmentsOut,
      ];
  return [
    "-hide_banner",
    "-nostdin",
    "-nostats",
    "-loglevel",
    "level+info",
    "-y",
    "-rtsp_transport",
    "tcp",
    // ffmpeg ≥ 5: -timeout is the socket I/O timeout (µs). In 4.x it meant
    // "listen for incoming connections", so 4.x gets -stimeout instead.
    ffmpegMajor >= 5 ? "-timeout" : "-stimeout",
    RTSP_TIMEOUT_US,
    "-i",
    rtspUrl,
    "-map",
    "0:v:0",
    ...(recordAudio
      ? ["-map", "0:a?", "-c:a", "aac", "-b:a", "64k", ...(streamUrl ? ["-ar", "44100"] : [])]
      : ["-an"]),
    "-c:v",
    "copy",
    ...output,
  ];
}

/** Turn ffmpeg's last stderr line into something staff can act on (heartbeat message). */
export function describeFailure(line) {
  const text = maskCredentials(String(line || "")).trim();
  if (/\b401\b|unauthori[sz]ed/i.test(text)) {
    return "Camera rejected the username/password — check the camera account in the RTSP URL";
  }
  if (
    /\b404\b|not found|method describe failed/i.test(text) &&
    /rtsp|describe|stream/i.test(text)
  ) {
    return "Camera stream not found — check the RTSP path (Tapo: /stream1)";
  }
  if (
    /timed out|timeout|connection refused|no route to host|network is unreachable|host is down|connection reset|end of file|i\/o error|broken pipe/i.test(
      text
    )
  ) {
    return truncate(`Camera not reachable — check Wi-Fi/power (${text})`);
  }
  return truncate(text ? `Recorder stopped: ${text}` : "Recorder stopped unexpectedly");
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname || null;
  } catch (_err) {
    return null;
  }
};

/** One camera → one ffmpeg, restarted with backoff whenever it exits or stalls. */
export class CourtRecorder {
  constructor({ court, dir, settings, ffmpegMajor, log, spawnImpl = spawn, lastStreamRestartAt }) {
    this.court = court;
    this.courtId = court.courtId;
    this.name = court.name;
    this.rtspUrl = court.cameraRtspUrl;
    this.streamUrl = court.stream?.rtmpUrl || null;
    this.streamHost = this.streamUrl ? hostOf(this.streamUrl) : null;
    this.streamStatus = this.streamUrl ? "starting" : "off";
    this.streamMessage = null;
    this.streamDead = false;
    // A stream-only restart (config change, dead RTMP output) — see RecorderManager
    this.lastStreamRestartAt = lastStreamRestartAt ?? Date.now();
    this.wantStream = undefined;
    this.dir = dir;
    this.settings = settings;
    this.ffmpegMajor = ffmpegMajor;
    this.log = log;
    this.spawnImpl = spawnImpl;
    this.child = null;
    this.state = "starting";
    this.message = "Connecting to camera";
    this.failures = 0;
    this.stopping = false;
    this.restartTimer = null;
    this.startedAt = 0;
    this.lastVideoAt = 0;
    this.lastStderr = "";
  }

  get label() {
    const stream = this.streamUrl ? `, streaming to ${maskStreamUrl(this.streamUrl)}` : "";
    return `${this.name || this.courtId} (${maskCredentials(this.rtspUrl)}${stream})`;
  }

  /** Every stderr line: masked first, then read for stream events and recording errors. */
  onStderrLine(raw) {
    const line = maskCredentials(maskStreamKey(raw, this.streamUrl));
    const parsed = parseLogLine(line);
    const event = this.streamUrl ? classifyStreamLine(parsed) : null;
    if (event) return this.onStreamEvent(event);
    // e.g. "[tcp] Connection to tcp://<ingest host>:1935 failed" — the stream's, not the camera's
    if (this.streamHost && parsed.text.includes(this.streamHost)) return undefined;
    if (parsed.level === null || ["error", "fatal", "panic"].includes(parsed.level)) {
      this.lastStderr = parsed.text;
    }
    return undefined;
  }

  onStreamEvent(event) {
    const who = this.name || this.courtId;
    if (event.event === "recovered") {
      if (this.streamStatus !== "live") this.log.info(`stream for ${who} reconnected`);
      this.streamStatus = "live";
      this.streamMessage = "Streaming";
      return;
    }
    if (this.streamStatus !== "error" || this.streamMessage !== event.message) {
      this.log.warn(
        `stream for ${who}: ${event.message}${event.event === "dead" ? " (output closed; the recorder restarts it within 5 min when no clip is being made)" : " — retrying"}`
      );
    }
    this.streamStatus = "error";
    this.streamMessage = event.message;
    if (event.event === "dead") this.streamDead = true;
  }

  start() {
    fs.mkdirSync(this.dir, { recursive: true });
    this.killStale();
    // A list left by the previous run is truncated by the next ffmpeg: merge it first
    this.mergeIndex().finally(() => this.spawn());
  }

  /** Fold segments.csv into index.json (see segments.js). */
  mergeIndex() {
    return loadTimeline(this.dir, { persist: true }).catch((err) =>
      this.log.warn(`could not update the segment index for ${this.name || this.courtId}`, err)
    );
  }

  spawn() {
    if (this.stopping) return;
    const args = buildRecordArgs({
      rtspUrl: this.rtspUrl,
      outDir: this.dir,
      segmentSeconds: this.settings.segmentSeconds,
      recordAudio: this.settings.recordAudio,
      ffmpegMajor: this.ffmpegMajor,
      streamUrl: this.streamUrl,
    });
    this.streamStatus = this.streamUrl ? "starting" : "off";
    this.streamMessage = this.streamUrl ? "Connecting to the streaming service" : null;
    this.streamDead = false;
    this.state = "starting";
    this.message = "Connecting to camera";
    this.startedAt = Date.now();
    this.lastStderr = "";
    // Rows of the segment list this ffmpeg writes belong to this run (segments.js)
    try {
      fs.writeFileSync(
        path.join(this.dir, RUN_FILE),
        JSON.stringify({ run: `run-${this.startedAt}` })
      );
    } catch (err) {
      this.log.warn("could not write the run file", err);
    }
    this.log.info(`starting recorder for ${this.label}`);
    const child = this.spawnImpl(this.settings.ffmpegPath, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    this.child = child;
    if (child.pid) fs.writeFile(this.pidFile, String(child.pid), () => {});

    let partial = "";
    child.stderr?.on("data", (chunk) => {
      const lines = (partial + chunk).split(/\r?\n/);
      partial = lines.pop();
      for (const line of lines) if (line.trim()) this.onStderrLine(line);
    });
    child.on("error", (err) => {
      this.lastStderr = `cannot start ffmpeg: ${err.code || err.message}`;
    });
    child.on("close", (code, signal) => this.onExit(child, code, signal));
  }

  onExit(child, code, signal) {
    if (this.child !== child) return;
    this.child = null;
    fs.rm(this.pidFile, { force: true }, () => {});
    if (this.stopping) return;

    const ranMs = Date.now() - this.startedAt;
    this.failures = ranMs >= STABLE_RUN_MS ? 1 : this.failures + 1;
    const delay = backoffMs(this.failures, RESTART_BASE_MS, RESTART_MAX_MS);
    this.state = "error";
    if (!this.stallMessage) this.message = describeFailure(this.lastStderr);
    this.stallMessage = null;
    this.log.warn(
      `recorder for ${this.name || this.courtId} exited (${signal || `code ${code}`}): ${this.message}; restarting in ${Math.round(delay / 1000)}s`
    );
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.mergeIndex().finally(() => this.spawn());
    }, delay);
  }

  /** Called every few seconds: prune old segments, update status, catch a stalled stream. */
  async tick(now = Date.now(), keep = []) {
    const entries = await readSegmentEntries(this.dir);
    await pruneEntries(this.dir, entries, now, this.settings.bufferSeconds * 1000, keep);
    if (this.child) await this.mergeIndex();
    const newest = entries.reduce((max, e) => Math.max(max, e.mtimeMs), 0);
    if (newest > this.startedAt) this.lastVideoAt = newest;
    if (!this.child) return;

    const fresh = this.lastVideoAt > this.startedAt && now - this.lastVideoAt < STALL_MS;
    // The fifo reports failures and reconnects, not a first success: video
    // flowing and no stream error for a few seconds counts as live
    if (fresh && this.streamStatus === "starting" && now - this.startedAt >= 8000) {
      this.streamStatus = "live";
      this.streamMessage = "Streaming";
      this.log.info(`streaming ${this.name || this.courtId} to ${maskStreamUrl(this.streamUrl)}`);
    }
    if (fresh) {
      if (this.state !== "ok") this.log.info(`recording ${this.name || this.courtId}`);
      this.state = "ok";
      this.message = "Recording";
      this.failures = now - this.startedAt >= STABLE_RUN_MS ? 0 : this.failures;
      return;
    }
    const since = Math.max(this.startedAt, this.lastVideoAt);
    const limit = this.lastVideoAt > this.startedAt ? STALL_MS : CONNECT_GRACE_MS;
    if (now - since >= limit) {
      const seconds = Math.round((now - since) / 1000);
      this.stallMessage = true;
      this.message = `Camera not reachable — no video for ${seconds}s, check Wi-Fi/power`;
      this.log.warn(`no video from ${this.name || this.courtId} for ${seconds}s — reconnecting`);
      this.child.kill("SIGKILL");
    }
  }

  status() {
    return {
      courtId: this.courtId,
      status: this.state,
      message: truncate(this.message, 255),
      streamStatus: this.streamStatus,
      ...(this.streamMessage ? { streamMessage: truncate(this.streamMessage, 255) } : {}),
    };
  }

  get pidFile() {
    return path.join(this.dir, "ffmpeg.pid");
  }

  /** After a hard crash (OOM, SIGKILL) the old ffmpeg may still write here — Linux only. */
  killStale() {
    try {
      const pid = Number(fs.readFileSync(this.pidFile, "utf8"));
      const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
      if (pid > 1 && cmdline.includes("ffmpeg") && cmdline.includes(this.dir)) {
        process.kill(pid, "SIGKILL");
        this.log.warn(`killed a leftover recorder (pid ${pid}) for ${this.name || this.courtId}`);
      }
    } catch (_err) {
      // no pid file, process gone, or no /proc (macOS)
    }
  }

  /** SIGTERM (ffmpeg closes the current segment cleanly), SIGKILL after 5 s. */
  stop() {
    this.stopping = true;
    clearTimeout(this.restartTimer);
    const child = this.child;
    if (!child) return Promise.resolve();
    return new Promise((resolve) => {
      const force = setTimeout(() => child.kill("SIGKILL"), 5000);
      child.once("close", () => {
        clearTimeout(force);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }

  killSync() {
    this.stopping = true;
    clearTimeout(this.restartTimer);
    this.child?.kill("SIGKILL");
  }
}

async function pruneEntries(dir, entries, now, bufferMs, keep) {
  for (const name of segmentsToPrune(entries, now, bufferMs, keep)) {
    await fsp.rm(path.join(dir, name), { force: true });
  }
}

/** All courts of the venue: starts/stops/restarts recorders as /config changes. */
export class RecorderManager {
  constructor({ dataDir, settings, ffmpegMajor, log, spawnImpl = spawn }) {
    this.root = path.join(dataDir, "buffer");
    this.settings = settings;
    this.ffmpegMajor = ffmpegMajor;
    this.log = log;
    this.spawnImpl = spawnImpl;
    this.recorders = new Map();
    this.timer = null;
    this.sessions = [];
    this.disk = { lowWarnedAt: 0, critical: false };
    /** Uncut clip/part windows of a court — set by index.js from the job queue. */
    this.pendingWindows = () => [];
  }

  newRecorder(court, extra = {}) {
    return new CourtRecorder({
      court,
      dir: this.courtDir(court.courtId),
      settings: this.settings,
      ffmpegMajor: this.ffmpegMajor,
      log: this.log,
      spawnImpl: this.spawnImpl,
      ...extra,
    });
  }

  /**
   * Stream changes and dead RTMP outputs need a recorder restart, which leaves
   * a few seconds' gap: only when no uncut clip/part window reaches into the
   * last 70 s, and for a dead output at most every 5 min.
   */
  async applyStreamRestarts(now = Date.now()) {
    for (const [courtId, recorder] of this.recorders) {
      const change = recorder.wantStream !== undefined;
      if (!change && !recorder.streamDead) continue;
      const allowed = streamRestartAllowed({
        nowMs: now,
        lastRestartMs: change ? 0 : recorder.lastStreamRestartAt,
        minIntervalMs: change ? 0 : undefined,
        pendingWindows: this.pendingWindows(courtId),
      });
      if (!allowed) continue;
      const court = change ? { ...recorder.court, stream: recorder.wantStream } : recorder.court;
      this.log.info(
        `restarting the recorder for ${recorder.name || courtId} (${change ? "stream settings changed" : "stream output closed"})`
      );
      await recorder.stop();
      const next = this.newRecorder(court, { lastStreamRestartAt: now });
      this.recorders.set(courtId, next);
      next.start();
    }
  }

  /** Sessions from /config: their footage outlives the rolling buffer (segments.js). */
  setSessions(sessions) {
    const list = Array.isArray(sessions) ? sessions : [];
    const ids = (l) => l.map((s) => `${s.sessionId}:${s.startMs}:${s.endMs}`).join(",");
    if (ids(list) !== ids(this.sessions) && list.length) {
      this.log.info(
        `${list.length} session(s) booked — their footage is kept until 30 min after each ends`
      );
    }
    this.sessions = list;
  }

  /** Kept windows for a court folder; none while disk space is critical (live recording first). */
  keepFor(dirName, now) {
    if (this.disk.critical) return [];
    const courtIds = [...new Set(this.sessions.map((s) => s.courtId))].filter(
      (id) => safeId(id) === dirName
    );
    return courtIds.flatMap((id) => retentionWindows(this.sessions, id, now));
  }

  /**
   * Free space in DATA_DIR: warn under DISK_WARN_GB; under DISK_CRITICAL_MB
   * session footage stops being kept, so recording can go on.
   */
  async checkDisk(now = Date.now()) {
    let free;
    try {
      const stats = await fsp.statfs(this.root);
      free = stats.bavail * stats.bsize;
    } catch (_err) {
      return;
    }
    const gb = (free / 1024 ** 3).toFixed(1);
    const critical = free < (this.settings.diskCriticalMb ?? 500) * 1024 ** 2;
    if (critical !== this.disk.critical) {
      if (critical)
        this.log.error(
          `only ${gb} GB free in DATA_DIR — session footage is no longer kept beyond the rolling buffer`
        );
      else this.log.info(`${gb} GB free again — keeping session footage`);
    }
    this.disk.critical = critical;
    if (
      free < (this.settings.diskWarnGb ?? 2) * 1024 ** 3 &&
      now - this.disk.lowWarnedAt > 10 * 60_000
    ) {
      this.disk.lowWarnedAt = now;
      this.log.warn(`low disk: ${gb} GB free in ${this.root}`);
    }
    return free;
  }

  courtDir(courtId) {
    return path.join(this.root, safeId(courtId));
  }

  has(courtId) {
    return this.recorders.has(courtId);
  }

  /** A stream turned on/off/changed: the restart waits for applyStreamRestarts. */
  noteStreamChange(recorder, next) {
    const nextStream = next.stream?.rtmpUrl ? next.stream : null;
    const nextUrl = nextStream?.rtmpUrl || null;
    if (nextUrl === recorder.streamUrl) {
      recorder.wantStream = undefined; // unchanged, or changed back before the restart
      return;
    }
    if (recorder.wantStream === undefined || (recorder.wantStream?.rtmpUrl || null) !== nextUrl) {
      const what = nextUrl ? (recorder.streamUrl ? "changed" : "turned on") : "turned off";
      this.log.info(
        `stream ${what} for ${next.name || recorder.courtId} — restarting the recorder when no clip is being made`
      );
    }
    recorder.wantStream = nextStream;
  }

  /** Make the running recorders match `courts` (from GET /config). */
  async sync(courts) {
    const wanted = new Map(courts.filter((c) => c.cameraRtspUrl).map((c) => [c.courtId, c]));
    for (const [courtId, recorder] of this.recorders) {
      const next = wanted.get(courtId);
      if (next && next.cameraRtspUrl === recorder.rtspUrl) this.noteStreamChange(recorder, next);
      if (!next || next.cameraRtspUrl !== recorder.rtspUrl) {
        this.log.info(
          `${next ? "camera URL changed, restarting" : "court removed, stopping"} ${recorder.name || courtId}`
        );
        this.recorders.delete(courtId);
        await recorder.stop();
      } else {
        recorder.name = next.name;
        recorder.court = { ...next, stream: recorder.court.stream };
      }
    }
    for (const [courtId, court] of wanted) {
      if (this.recorders.has(courtId)) continue;
      const recorder = this.newRecorder(court);
      this.recorders.set(courtId, recorder);
      recorder.start();
    }
  }

  statuses() {
    return [...this.recorders.values()].map((r) => r.status());
  }

  startTicker(intervalMs = 5000) {
    let lastDiskCheck = 0;
    const run = async () => {
      const now = Date.now();
      if (now - lastDiskCheck >= 60_000) {
        lastDiskCheck = now;
        await this.checkDisk(now);
      }
      for (const recorder of this.recorders.values()) {
        await recorder
          .tick(now, this.keepFor(path.basename(recorder.dir), now))
          .catch((err) => this.log.warn(`tick failed for ${recorder.courtId}`, err));
      }
      await this.pruneOrphans().catch((err) => this.log.warn("prune failed", err));
      await this.applyStreamRestarts().catch((err) => this.log.warn("stream restart failed", err));
      this.timer = setTimeout(run, intervalMs);
    };
    this.timer = setTimeout(run, intervalMs);
  }

  /** Folders of courts that are no longer recorded: let their footage age out, then remove them. */
  async pruneOrphans(now = Date.now()) {
    const active = new Set([...this.recorders.values()].map((r) => path.basename(r.dir)));
    const dirs = await fsp.readdir(this.root).catch(() => []);
    for (const name of dirs) {
      if (active.has(name)) continue;
      const dir = path.join(this.root, name);
      const entries = await readSegmentEntries(dir);
      await pruneEntries(
        dir,
        entries,
        now,
        this.settings.bufferSeconds * 1000,
        this.keepFor(name, now)
      );
      const left = await fsp.readdir(dir).catch(() => null);
      if (left && !left.some((f) => f.endsWith(".ts")))
        await fsp.rm(dir, { recursive: true, force: true });
    }
  }

  async stopAll() {
    clearTimeout(this.timer);
    await Promise.all([...this.recorders.values()].map((r) => r.stop()));
  }

  /** Last resort from process.on("exit"): never leave ffmpeg children behind. */
  killAllSync() {
    for (const recorder of this.recorders.values()) recorder.killSync();
  }
}
