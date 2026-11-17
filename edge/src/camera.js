import fsp from "node:fs/promises";
import path from "node:path";
import { runFfmpeg as defaultRunFfmpeg } from "./ffmpeg.js";
import { readSegmentEntries, segmentStartMs } from "./segments.js";

/**
 * Guided camera setup (PLAN-002): what the camera really sends, and a preview
 * picture — both read from the recorder's own buffer. The box NEVER opens the
 * camera for this: a Tapo C200 serves one RTSP client, and the recorder holds it.
 */

/** Probe a court's media again at most this often (a new segment arrives every ~2 s). */
export const PROBE_INTERVAL_MS = 30_000;
/** Media details / previews older than this describe a camera that has stopped. */
export const FRESH_MS = 60_000;
export const SNAPSHOT_INTERVAL_MS = 30_000;
export const SNAPSHOT_MAX_BYTES = 3 * 1024 * 1024;

/** The newest segment that is finished: the newest file is still being written. */
export function latestClosedSegment(entries) {
  const sorted = entries
    .filter((e) => segmentStartMs(e.name) !== null)
    .sort((a, b) => segmentStartMs(a.name) - segmentStartMs(b.name));
  return sorted.length >= 2 ? sorted[sorted.length - 2] : null;
}

/** ffprobe on one segment FILE: streams plus a packet count, to measure the real frame rate. */
export const buildProbeArgs = (file) => [
  "-v",
  "error",
  "-count_packets",
  "-show_entries",
  "stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,sample_rate,nb_read_packets:format=duration",
  "-of",
  "json",
  file,
];

const ratio = (value) => {
  const [num, den] = String(value || "")
    .split("/")
    .map(Number);
  return den > 0 && num > 0 ? num / den : Number(value) > 0 ? Number(value) : 0;
};
const round = (n, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;

/**
 * The frame rate to report. The camera's own claim (avg_frame_rate) is used
 * when it agrees within 15% with frames / duration counted in the segment;
 * otherwise the counted rate — a C200 claims ~30 fps but sends 15.
 */
export function frameRate({ avgFrameRate, packets, durationSec }) {
  const claimed = ratio(avgFrameRate);
  const counted = durationSec >= 1 && packets > 1 ? packets / durationSec : 0;
  if (
    claimed > 0 &&
    claimed <= 240 &&
    (!counted || Math.abs(claimed - counted) / counted <= 0.15)
  ) {
    return round(claimed);
  }
  return counted > 0 && counted <= 240 ? round(counted, 1) : null;
}

/** ffprobe JSON → { video: { codec, width, height, fps }, audio: { codec, sampleRate } | null }. */
export function parseProbe(json) {
  const streams = Array.isArray(json?.streams) ? json.streams : [];
  const durationSec = Number(json?.format?.duration) || 0;
  const v = streams.find((s) => s.codec_type === "video");
  const a = streams.find((s) => s.codec_type === "audio");
  const video = v
    ? {
        codec: v.codec_name || "unknown",
        ...(v.width ? { width: v.width } : {}),
        ...(v.height ? { height: v.height } : {}),
        ...(() => {
          const fps = frameRate({
            avgFrameRate: v.avg_frame_rate,
            packets: Number(v.nb_read_packets) || 0,
            durationSec,
          });
          return fps ? { fps } : {};
        })(),
      }
    : null;
  const audio = a
    ? {
        codec: a.codec_name || "unknown",
        ...(Number(a.sample_rate) ? { sampleRate: Number(a.sample_rate) } : {}),
      }
    : null;
  return { video, audio };
}

/** One JPEG from a segment FILE (its first frame is a keyframe), at most 1280 px wide. */
export const buildSnapshotArgs = ({ file, outPath }) => [
  "-hide_banner",
  "-nostdin",
  "-y",
  "-loglevel",
  "error",
  "-i",
  file,
  "-frames:v",
  "1",
  "-vf",
  "scale=w='min(1280,iw)':h=-2",
  "-q:v",
  "4",
  "-update",
  "1",
  "-f",
  "image2",
  outPath,
];

/**
 * Media details per court folder, cached by segment and refreshed at most
 * every 30 s. → { video, audio, segment, segmentAtMs } or null.
 */
export class MediaProbe {
  constructor({
    ffprobePath = "ffprobe",
    runFfmpeg = defaultRunFfmpeg,
    now = () => Date.now(),
  } = {}) {
    this.ffprobePath = ffprobePath;
    this.runFfmpeg = runFfmpeg;
    this.now = now;
    this.cache = new Map();
  }

  async refresh(dir) {
    const cached = this.cache.get(dir);
    if (cached && this.now() - cached.probedAt < PROBE_INTERVAL_MS) return cached.info;
    const latest = latestClosedSegment(await readSegmentEntries(dir));
    if (!latest) return cached?.info ?? null;
    if (cached?.info?.segment === latest.name) return cached.info;
    const { stdout } = await this.runFfmpeg(this.ffprobePath, buildProbeArgs(latest.path), {
      timeoutMs: 20_000,
    });
    const info = {
      ...parseProbe(JSON.parse(stdout)),
      segment: latest.name,
      segmentAtMs: latest.mtimeMs,
    };
    this.cache.set(dir, { probedAt: this.now(), info });
    return info;
  }

  /** The latest details if they describe the last minute of video, else null. */
  current(dir) {
    const info = this.cache.get(dir)?.info;
    return info && this.now() - info.segmentAtMs < FRESH_MS ? info : null;
  }

  forget(dir) {
    this.cache.delete(dir);
  }
}

/** Courts whose preview is due: wanted, not dropped, last sent ≥ 30 s ago. */
export const duePreviews = (wanted, lastSent, nowMs, intervalMs = SNAPSHOT_INTERVAL_MS) =>
  [...wanted].filter((courtId) => nowMs - (lastSent.get(courtId) ?? 0) >= intervalMs);

/**
 * Preview snapshots for camera setup: while `/config` says `previewWanted`
 * for a court, one JPEG from its latest closed segment every ~30 s, uploaded
 * to POST /courts/:courtId/snapshot. Lowest priority: skipped whenever the
 * clip queue is busy, one at a time.
 */
export class PreviewSender {
  constructor({
    api,
    courtDir,
    settings,
    isBusy = () => false,
    log,
    runFfmpeg = defaultRunFfmpeg,
    now = () => Date.now(),
  }) {
    this.api = api;
    this.courtDir = courtDir;
    this.settings = settings;
    this.isBusy = isBusy;
    this.log = log;
    this.runFfmpeg = runFfmpeg;
    this.now = now;
    this.wanted = new Set();
    this.lastSent = new Map();
    this.dropped = new Set();
    this.running = false;
  }

  /** From /config: the courts with previewWanted. */
  setWanted(courts) {
    const next = new Set((courts || []).filter((c) => c.previewWanted).map((c) => c.courtId));
    for (const id of next)
      if (!this.wanted.has(id)) this.log.info(`camera preview wanted for court ${id}`);
    for (const id of this.wanted) if (!next.has(id)) this.lastSent.delete(id);
    for (const id of this.dropped) if (!next.has(id)) this.dropped.delete(id);
    this.wanted = next;
  }

  get active() {
    return this.wanted.size > 0;
  }

  /** Send whatever is due. Never runs twice at once; returns the courts sent. */
  async tick() {
    if (this.running || !this.wanted.size) return [];
    this.running = true;
    const sent = [];
    try {
      const wanted = [...this.wanted].filter((id) => !this.dropped.has(id));
      for (const courtId of duePreviews(wanted, this.lastSent, this.now())) {
        if (this.isBusy()) break; // clips first; try again next tick
        if (await this.sendOne(courtId)) sent.push(courtId);
      }
    } finally {
      this.running = false;
    }
    return sent;
  }

  async sendOne(courtId) {
    const dir = this.courtDir(courtId);
    const latest = latestClosedSegment(await readSegmentEntries(dir));
    if (!latest || this.now() - latest.mtimeMs > FRESH_MS) {
      this.lastSent.set(courtId, this.now() - SNAPSHOT_INTERVAL_MS + 5000); // look again in 5 s
      return false;
    }
    const outPath = path.join(dir, "preview.jpg");
    try {
      await this.runFfmpeg(
        this.settings.ffmpegPath,
        buildSnapshotArgs({ file: latest.path, outPath }),
        {
          timeoutMs: 20_000,
        }
      );
      const { size } = await fsp.stat(outPath);
      if (size === 0 || size > SNAPSHOT_MAX_BYTES) throw new Error(`snapshot is ${size} bytes`);
      await this.api.uploadSnapshot(courtId, outPath);
      this.lastSent.set(courtId, this.now());
      this.log.debug(`preview sent for court ${courtId}`);
      return true;
    } catch (err) {
      if (err.status === 404) {
        this.log.warn(`court ${courtId} is not this venue's any more — no previews for it`);
        this.dropped.add(courtId);
      } else {
        this.log.warn(`preview for court ${courtId} failed, trying again in 10 s`, err);
        this.lastSent.set(courtId, this.now() - SNAPSHOT_INTERVAL_MS + 10_000);
      }
      return false;
    } finally {
      await fsp.rm(outPath, { force: true });
    }
  }
}
