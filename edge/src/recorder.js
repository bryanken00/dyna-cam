import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  loadTimeline,
  readSegmentEntries,
  RUN_FILE,
  SEGMENT_LIST,
  segmentsToPrune,
} from "./segments.js";
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
 */
export function buildRecordArgs({
  rtspUrl,
  outDir,
  segmentSeconds,
  recordAudio = true,
  ffmpegMajor = 99,
}) {
  return [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "error",
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
    ...(recordAudio ? ["-map", "0:a?", "-c:a", "aac", "-b:a", "64k"] : ["-an"]),
    "-c:v",
    "copy",
    "-f",
    "segment",
    "-segment_time",
    String(segmentSeconds),
    "-segment_format",
    "mpegts",
    "-segment_list",
    path.join(outDir, SEGMENT_LIST),
    "-segment_list_type",
    "csv",
    "-segment_list_size",
    "100",
    "-reset_timestamps",
    "1",
    "-strftime",
    "1",
    path.join(outDir, "%s.ts"),
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

/** One camera → one ffmpeg, restarted with backoff whenever it exits or stalls. */
export class CourtRecorder {
  constructor({ court, dir, settings, ffmpegMajor, log, spawnImpl = spawn }) {
    this.courtId = court.courtId;
    this.name = court.name;
    this.rtspUrl = court.cameraRtspUrl;
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
    return `${this.name || this.courtId} (${maskCredentials(this.rtspUrl)})`;
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
    });
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
      const last = lines
        .map((l) => l.trim())
        .filter(Boolean)
        .pop();
      if (last) this.lastStderr = maskCredentials(last);
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
  async tick(now = Date.now()) {
    const entries = await readSegmentEntries(this.dir);
    await pruneEntries(this.dir, entries, now, this.settings.bufferSeconds * 1000);
    if (this.child) await this.mergeIndex();
    const newest = entries.reduce((max, e) => Math.max(max, e.mtimeMs), 0);
    if (newest > this.startedAt) this.lastVideoAt = newest;
    if (!this.child) return;

    const fresh = this.lastVideoAt > this.startedAt && now - this.lastVideoAt < STALL_MS;
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
    return { courtId: this.courtId, status: this.state, message: truncate(this.message, 255) };
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

async function pruneEntries(dir, entries, now, bufferMs) {
  for (const name of segmentsToPrune(entries, now, bufferMs)) {
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
  }

  courtDir(courtId) {
    return path.join(this.root, safeId(courtId));
  }

  has(courtId) {
    return this.recorders.has(courtId);
  }

  /** Make the running recorders match `courts` (from GET /config). */
  async sync(courts) {
    const wanted = new Map(courts.filter((c) => c.cameraRtspUrl).map((c) => [c.courtId, c]));
    for (const [courtId, recorder] of this.recorders) {
      const next = wanted.get(courtId);
      if (!next || next.cameraRtspUrl !== recorder.rtspUrl) {
        this.log.info(
          `${next ? "camera URL changed, restarting" : "court removed, stopping"} ${recorder.name || courtId}`
        );
        this.recorders.delete(courtId);
        await recorder.stop();
      } else {
        recorder.name = next.name;
      }
    }
    for (const [courtId, court] of wanted) {
      if (this.recorders.has(courtId)) continue;
      const recorder = new CourtRecorder({
        court,
        dir: this.courtDir(courtId),
        settings: this.settings,
        ffmpegMajor: this.ffmpegMajor,
        log: this.log,
        spawnImpl: this.spawnImpl,
      });
      this.recorders.set(courtId, recorder);
      recorder.start();
    }
  }

  statuses() {
    return [...this.recorders.values()].map((r) => r.status());
  }

  startTicker(intervalMs = 5000) {
    const run = async () => {
      for (const recorder of this.recorders.values()) {
        await recorder
          .tick()
          .catch((err) => this.log.warn(`tick failed for ${recorder.courtId}`, err));
      }
      await this.pruneOrphans().catch((err) => this.log.warn("prune failed", err));
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
      await pruneEntries(dir, entries, now, this.settings.bufferSeconds * 1000);
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
