import fsp from "node:fs/promises";
import path from "node:path";
import { readJson, safeId, writeJsonAtomic } from "./util.js";

/**
 * CR-040: the game videos this box keeps. A game made for Google Drive stays
 * here (DATA_DIR/videos/<safeId>/game.mp4) after it is sent — and when the
 * court has no usable Drive it is the only copy, sent later when staff connect
 * Drive or press Retry. Each file goes when:
 *
 * - its keep time is over (`keepUntilMs`, the venue's keep time, from the API);
 * - a fresh /config no longer lists it in `keepVideos` (deleted, expired, or the
 *   API forgot it) — never from a cached config, and never a file the box
 *   touched after that config was asked for;
 * - the disk is critically full: the oldest already on Drive first, then the
 *   oldest of the rest (recording must go on).
 *
 * Every removal is reported (POST /game-videos/:id/box-deleted), retried until
 * the API has it. A video with a job in the queue is never removed.
 *
 * `videos.json`: { videos: { [sessionVideoId]: { sessionVideoId, folder,
 * sizeBytes, durationSeconds, gaps, savedAt, touchedAt, keepUntilMs, onDrive,
 * removedAt? } } } — `removedAt` = file gone, report still owed.
 */

const VIDEO_FILE = "game.mp4";
/** How often the keep times and the disk are checked without a config refresh. */
export const PRUNE_EVERY_MS = 5 * 60_000;

export class VideoStore {
  /**
   * @param {object} opts
   * @param {string} opts.dir         DATA_DIR/videos
   * @param {object} opts.api         createApi's client (boxDeleted)
   * @param {object} opts.log
   * @param {(id: string) => boolean} [opts.isBusy] a job in the queue still uses it
   * @param {number} [opts.diskCriticalMb]
   * @param {() => number} [opts.now]
   * @param {Function} [opts.statfs]
   */
  constructor({
    dir,
    api,
    log,
    isBusy = () => false,
    diskCriticalMb = 500,
    now = () => Date.now(),
    statfs = fsp.statfs,
  }) {
    this.dir = dir;
    this.file = path.join(dir, "videos.json");
    this.api = api;
    this.log = log;
    this.isBusy = isBusy;
    this.diskCriticalMb = diskCriticalMb;
    this.now = now;
    this.statfs = statfs;
    this.videos = new Map();
    this.writing = Promise.resolve();
    this.timer = null;
  }

  /** Read videos.json; forget entries whose file is gone and remove stray folders. */
  async load() {
    await fsp.mkdir(this.dir, { recursive: true });
    const saved = await readJson(this.file, { videos: {} });
    this.videos = new Map(Object.entries(saved?.videos || {}));
    for (const [id, video] of this.videos) {
      if (!video.removedAt && !(await exists(this.videoPath(id)))) {
        this.log.warn(`kept game video ${id}: its file is gone`);
        video.removedAt = this.now();
      }
    }
    const folders = new Set([...this.videos.keys()].map((id) => safeId(id)));
    for (const name of await fsp.readdir(this.dir).catch(() => [])) {
      if (name === "videos.json" || name.startsWith("videos.json.")) continue;
      if (!folders.has(name))
        await fsp.rm(path.join(this.dir, name), { recursive: true, force: true });
    }
    await this.save();
    return this;
  }

  save() {
    const snapshot = { videos: Object.fromEntries(this.videos) };
    this.writing = this.writing.then(() => writeJsonAtomic(this.file, snapshot));
    return this.writing;
  }

  videoPath(id) {
    return path.join(this.dir, safeId(id), VIDEO_FILE);
  }

  /** A kept video with its file, or null. → { ...entry, videoPath } */
  get(id) {
    const video = this.videos.get(id);
    return video && !video.removedAt ? { ...video, videoPath: this.videoPath(id) } : null;
  }

  /**
   * Take a freshly made game file into the store (moved, not copied).
   * → the kept entry with its new `videoPath`
   */
  async adopt(id, { videoPath, sizeBytes, durationSeconds, gaps = [] }) {
    const target = this.videoPath(id);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.rename(videoPath, target);
    const at = this.now();
    this.videos.set(id, {
      sessionVideoId: id,
      folder: safeId(id),
      sizeBytes,
      durationSeconds,
      gaps,
      savedAt: at,
      touchedAt: at,
      keepUntilMs: null,
      onDrive: false,
    });
    await this.save();
    return this.get(id);
  }

  /** What the API said about a kept video (keep time, on Drive or not). */
  async update(id, patch) {
    const video = this.videos.get(id);
    if (!video || video.removedAt) return;
    Object.assign(video, patch, { touchedAt: this.now() });
    await this.save();
  }

  /** The file is unusable (shorter than recorded…): drop it without telling the API. */
  async forget(id) {
    if (!this.videos.has(id)) return;
    this.videos.delete(id);
    await fsp.rm(path.join(this.dir, safeId(id)), { recursive: true, force: true });
    await this.save();
  }

  /** Remove a kept file; the API is told on the next report run. */
  async remove(id, why) {
    const video = this.videos.get(id);
    if (!video || video.removedAt) return;
    await fsp.rm(path.join(this.dir, safeId(id)), { recursive: true, force: true });
    video.removedAt = this.now();
    this.log.info(`removed kept game video ${id} (${why})`);
    await this.save();
  }

  /** Kept files and their size, for the heartbeat. */
  stats() {
    let count = 0;
    let bytes = 0;
    for (const video of this.videos.values()) {
      if (video.removedAt) continue;
      count += 1;
      bytes += Number(video.sizeBytes) || 0;
    }
    return { localVideos: count, localVideoMb: Math.round(bytes / 1024 ** 2) };
  }

  /**
   * A fresh /config's `keepVideos` ([{ sessionVideoId, keepUntilMs, onDrive }]):
   * update keep times, remove what isn't listed. `askedAt` = when that /config
   * was requested — a video touched since then may not be in it yet.
   * An older API sends no `keepVideos`: nothing is removed.
   */
  async reconcile(keepVideos, askedAt) {
    if (!Array.isArray(keepVideos)) return;
    const listed = new Map(
      keepVideos.filter((v) => v?.sessionVideoId).map((v) => [v.sessionVideoId, v])
    );
    let changed = false;
    for (const [id, video] of this.videos) {
      if (video.removedAt) continue;
      const wanted = listed.get(id);
      if (wanted) {
        const keepUntilMs = Number.isFinite(wanted.keepUntilMs)
          ? wanted.keepUntilMs
          : video.keepUntilMs;
        const onDrive = Boolean(wanted.onDrive);
        if (keepUntilMs !== video.keepUntilMs || onDrive !== video.onDrive) {
          Object.assign(video, { keepUntilMs, onDrive });
          changed = true;
        }
      } else if (!this.isBusy(id) && (video.touchedAt ?? video.savedAt) < askedAt) {
        await this.remove(id, "no longer needed");
      }
    }
    if (changed) await this.save();
    await this.prune();
  }

  /** Keep times and disk space; then report removals. Never throws. */
  async prune() {
    try {
      const now = this.now();
      for (const [id, video] of this.videos) {
        if (video.removedAt || this.isBusy(id)) continue;
        if (Number.isFinite(video.keepUntilMs) && video.keepUntilMs <= now) {
          await this.remove(id, "keep time over");
        }
      }
      await this.freeDisk();
      await this.report();
    } catch (err) {
      this.log.warn("could not tidy the kept game videos", err);
    }
  }

  /** Under DISK_CRITICAL_MB: oldest on Drive first, then the oldest of the rest. */
  async freeDisk() {
    const critical = this.diskCriticalMb * 1024 ** 2;
    let free = await this.freeBytes();
    if (free === null || free >= critical) return;
    const candidates = [...this.videos.entries()]
      .filter(([id, video]) => !video.removedAt && !this.isBusy(id))
      .sort(([, a], [, b]) => Number(b.onDrive) - Number(a.onDrive) || a.savedAt - b.savedAt);
    for (const [id, video] of candidates) {
      if (free >= critical) break;
      if (!video.onDrive) {
        this.log.error(
          `disk critically full — removing kept game video ${id}, which is NOT on Google Drive`
        );
      }
      await this.remove(id, "disk critically full");
      free += Number(video.sizeBytes) || 0;
    }
  }

  async freeBytes() {
    try {
      const stats = await this.statfs(this.dir);
      return Number(stats.bavail) * Number(stats.bsize);
    } catch {
      return null;
    }
  }

  /** Tell the API about removed files; a 404 (unknown to the API) counts as told. */
  async report() {
    let changed = false;
    for (const [id, video] of this.videos) {
      if (!video.removedAt) continue;
      try {
        await this.api.boxDeleted(id);
      } catch (err) {
        if (err?.status !== 404) {
          if (!err?.isNetwork) this.log.warn(`could not report kept game video ${id} removed`, err);
          continue;
        }
      }
      this.videos.delete(id);
      changed = true;
    }
    if (changed) await this.save();
  }

  start() {
    const run = async () => {
      await this.prune();
      this.timer = setTimeout(run, PRUNE_EVERY_MS);
      this.timer.unref?.();
    };
    this.timer = setTimeout(run, 60_000);
    this.timer.unref?.();
  }

  stop() {
    clearTimeout(this.timer);
    return this.writing.catch(() => {});
  }
}

const exists = (file) =>
  fsp.access(file).then(
    () => true,
    () => false
  );
