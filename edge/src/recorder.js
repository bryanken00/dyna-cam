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
import { MediaProbe } from "./camera.js";
import { parseLogLine } from "./stream.js";
import {
  backoffMs,
  CAM2_SUFFIX,
  cameraDirName,
  courtDirName,
  maskCredentials,
  safeId,
  truncate,
} from "./util.js";

/**
 * The rolling buffer: one ffmpeg per court stream-copies the camera's video
 * into short MPEG-TS segments named by the epoch second they started
 * (`<dir>/1763350000.ts`). Video is NEVER re-encoded here — that is what keeps
 * six courts on one small box. Audio is transcoded to AAC because cameras such
 * as the Tapo C200 send G.711 (pcm_alaw), which MPEG-TS stores as unplayable
 * `bin_data` when stream-copied.
 *
 * A court can have two cameras (PLAN-002 §7): each gets its own recorder and
 * folder — `buffer/<safeId(courtId)>` for camera 1, `buffer/<safeId(courtId)>~cam2`
 * for camera 2 (`~` never appears in a safeId, so no court can collide with it).
 * Streams are never an output of the recorder (restream.js reads the live view).
 */

const RESTART_BASE_MS = 2_000;
const RESTART_MAX_MS = 30_000; // Wi-Fi cameras drop out; never wait longer than this
const STABLE_RUN_MS = 60_000; // a run this long resets the backoff
const STALL_MS = 20_000; // no new video for this long → kill and reconnect
const CONNECT_GRACE_MS = 30_000;
const RTSP_TIMEOUT_US = "10000000"; // 10 s socket timeout: a stalled stream exits instead of hanging

/**
 * ffmpeg arguments for one camera's recorder. segments.csv lists each closed
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
    "-nostats",
    "-loglevel",
    "level+warning",
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

/**
 * One camera → one ffmpeg, restarted with backoff whenever it exits or stalls.
 * `court` = { courtId, name, camera (1|2), cameraRtspUrl, cameraVersion }.
 */
export class CourtRecorder {
  constructor({ court, dir, settings, ffmpegMajor, log, spawnImpl = spawn }) {
    this.court = court;
    this.courtId = court.courtId;
    this.camera = court.camera === 2 ? 2 : 1;
    this.name = court.name;
    this.rtspUrl = court.cameraRtspUrl;
    // The court config this recorder runs with: echoed in the heartbeat so the
    // setup page can tell a report about a new camera address from an old one
    this.cameraVersion = court.cameraVersion ?? null;
    this.createdAt = Date.now();
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

  /** "Court 1" or "Court 1 camera 2", for logs. */
  get who() {
    const name = this.name || this.courtId;
    return this.camera === 2 ? `${name} camera 2` : name;
  }

  get label() {
    return `${this.who} (${maskCredentials(this.rtspUrl)})`;
  }

  /** Every stderr line: masked first, then kept as the last error. */
  onStderrLine(raw) {
    const parsed = parseLogLine(maskCredentials(raw));
    if (parsed.level === null || ["error", "fatal", "panic"].includes(parsed.level)) {
      this.lastStderr = parsed.text;
    }
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
      this.log.warn(`could not update the segment index for ${this.who}`, err)
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
    this.spawnCount = (this.spawnCount ?? 0) + 1;
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
      `recorder for ${this.who} exited (${signal || `code ${code}`}): ${this.message}; restarting in ${Math.round(delay / 1000)}s`
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
    if (fresh) {
      if (this.state !== "ok") this.log.info(`recording ${this.who}`);
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
      this.log.warn(`no video from ${this.who} for ${seconds}s — reconnecting`);
      this.child.kill("SIGKILL");
    }
  }

  status() {
    return {
      courtId: this.courtId,
      camera: this.camera,
      status: this.state,
      message: truncate(this.message, 255),
      ...(this.cameraVersion ? { cameraVersion: this.cameraVersion } : {}),
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
        this.log.warn(`killed a leftover recorder (pid ${pid}) for ${this.who}`);
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

/** The cameras of a /config court: camera 1, plus camera 2 when it has an address. */
export function courtCameras(court) {
  const cams = [];
  if (court.cameraRtspUrl) {
    cams.push({
      courtId: court.courtId,
      name: court.name,
      camera: 1,
      cameraRtspUrl: court.cameraRtspUrl,
      cameraVersion: court.cameraVersion ?? null,
    });
  }
  if (court.camera2RtspUrl) {
    cams.push({
      courtId: court.courtId,
      name: court.name,
      camera: 2,
      cameraRtspUrl: court.camera2RtspUrl,
      cameraVersion: court.camera2Version ?? null,
    });
  }
  return cams;
}

/** Map key of a court camera's recorder. */
export const cameraKey = (courtId, camera = 1) =>
  camera === 2 ? `${courtId}${CAM2_SUFFIX}` : courtId;

/** All court cameras of the venue: starts/stops/restarts recorders as /config changes. */
export class RecorderManager {
  constructor({ dataDir, settings, ffmpegMajor, log, spawnImpl = spawn }) {
    this.root = path.join(dataDir, "buffer");
    this.settings = settings;
    this.ffmpegMajor = ffmpegMajor;
    this.log = log;
    this.spawnImpl = spawnImpl;
    this.recorders = new Map(); // cameraKey → CourtRecorder
    this.timer = null;
    this.sessions = [];
    this.disk = { lowWarnedAt: 0, critical: false };
    // What each camera really sends, read from its latest closed segment (camera.js)
    this.media = new MediaProbe({ ffprobePath: settings.ffprobePath });
  }

  newRecorder(cam) {
    return new CourtRecorder({
      court: cam,
      dir: this.courtDir(cam.courtId, cam.camera),
      settings: this.settings,
      ffmpegMajor: this.ffmpegMajor,
      log: this.log,
      spawnImpl: this.spawnImpl,
    });
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

  /**
   * Kept windows for a buffer folder (either camera's); none while disk space
   * is critical (live recording first).
   */
  keepFor(dirName, now) {
    if (this.disk.critical) return [];
    const court = courtDirName(dirName);
    const courtIds = [...new Set(this.sessions.map((s) => s.courtId))].filter(
      (id) => safeId(id) === court
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

  /** A camera's buffer folder: `buffer/<safeId>` (camera 1) or `buffer/<safeId>~cam2`. */
  courtDir(courtId, camera = 1) {
    return path.join(this.root, cameraDirName(courtId, camera));
  }

  /** Both possible camera folders of a court (clips use whichever has footage). */
  courtDirs(courtId) {
    return [this.courtDir(courtId, 1), this.courtDir(courtId, 2)];
  }

  /** Is any camera of this court recorded by this box? */
  has(courtId) {
    return this.recorders.has(cameraKey(courtId, 1)) || this.recorders.has(cameraKey(courtId, 2));
  }

  /**
   * The cameras of a court this box records, for streams:
   * [{ camera, up, fps, hasAudio }] — `fps`/`hasAudio` undefined until probed.
   */
  cameraInfo(courtId) {
    const out = [];
    for (const camera of [1, 2]) {
      const recorder = this.recorders.get(cameraKey(courtId, camera));
      if (!recorder) continue;
      const info = this.media.current(recorder.dir);
      const fresh = info?.video && info.segmentAtMs >= recorder.createdAt;
      out.push({
        camera,
        up: recorder.state === "ok",
        fps: fresh ? info.video.fps : undefined,
        hasAudio: fresh ? Boolean(info.audio) : undefined,
      });
    }
    return out;
  }

  /** Make the running recorders match `courts` (from GET /config): one per camera. */
  async sync(courts) {
    const wanted = new Map(
      (courts || []).flatMap(courtCameras).map((cam) => [cameraKey(cam.courtId, cam.camera), cam])
    );
    for (const [key, recorder] of this.recorders) {
      const next = wanted.get(key);
      if (!next || next.cameraRtspUrl !== recorder.rtspUrl) {
        this.log.info(
          `${next ? "camera URL changed, restarting" : "camera removed, stopping"} ${recorder.who}`
        );
        this.recorders.delete(key);
        await recorder.stop();
      } else {
        recorder.name = next.name;
        recorder.court = next;
        // Same address re-saved: this recorder already runs with it
        recorder.cameraVersion = next.cameraVersion ?? null;
      }
    }
    for (const [key, cam] of wanted) {
      if (this.recorders.has(key)) continue;
      const recorder = this.newRecorder(cam);
      this.recorders.set(key, recorder);
      recorder.start();
    }
  }

  /**
   * Heartbeat camera entries, one per camera (`camera: 1 | 2`): recorder
   * status, plus `video` / `audio` (audio null = the stream has none) while
   * they describe the last minute.
   */
  statuses() {
    return [...this.recorders.values()].map((r) => {
      const info = this.media.current(r.dir);
      // Only details read from this recorder's own segments (not the previous address's)
      if (!info?.video || info.segmentAtMs < r.createdAt) return r.status();
      return { ...r.status(), video: info.video, audio: info.audio };
    });
  }

  /** Probe each running camera's latest closed segment (cached; ≤ every 30 s per camera). */
  async refreshMedia() {
    for (const recorder of this.recorders.values()) {
      if (!recorder.child) continue;
      await this.media
        .refresh(recorder.dir)
        .catch((err) => this.log.debug(`could not probe ${recorder.who}`, err));
    }
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
          .catch((err) => this.log.warn(`tick failed for ${recorder.who}`, err));
      }
      await this.pruneOrphans().catch((err) => this.log.warn("prune failed", err));
      await this.refreshMedia();
      this.timer = setTimeout(run, intervalMs);
    };
    this.timer = setTimeout(run, intervalMs);
  }

  /** Folders of cameras that are no longer recorded: let their footage age out, then remove them. */
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
