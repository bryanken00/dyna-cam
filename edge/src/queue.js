import { readJson, writeJsonAtomic } from "./util.js";

/**
 * The box's clip jobs, persisted to DATA_DIR/queue.json after every change so
 * a reboot neither loses a cut-but-not-uploaded clip nor a job still waiting
 * to be cut (the buffer segments survive a reboot too).
 *
 * Entry: { clipId, courtId, source, requestedAtMs, preSeconds, postSeconds,
 *          state: "waiting" | "ready" | "failing", claimed, attempts,
 *          nextAttemptAt, videoPath?, thumbnailPath?, failReason?, receivedAt }
 */
export class JobQueue {
  constructor(file) {
    this.file = file;
    this.entries = new Map();
    this.writing = Promise.resolve();
  }

  async load() {
    const data = await readJson(this.file, { version: 1, jobs: [] });
    this.entries.clear();
    for (const entry of Array.isArray(data?.jobs) ? data.jobs : []) {
      if (entry?.clipId && Number.isFinite(entry.requestedAtMs))
        this.entries.set(entry.clipId, entry);
    }
    return this;
  }

  has(clipId) {
    return this.entries.has(clipId);
  }

  get(clipId) {
    return this.entries.get(clipId) ?? null;
  }

  /** Oldest request first — its footage is the closest to being overwritten. */
  list() {
    return [...this.entries.values()].sort((a, b) => a.requestedAtMs - b.requestedAtMs);
  }

  get size() {
    return this.entries.size;
  }

  async put(entry) {
    this.entries.set(entry.clipId, entry);
    await this.save();
    return entry;
  }

  async update(clipId, patch) {
    const entry = this.entries.get(clipId);
    if (!entry) return null;
    Object.assign(entry, patch);
    await this.save();
    return entry;
  }

  async remove(clipId) {
    if (this.entries.delete(clipId)) await this.save();
  }

  /** Writes are chained, so they land in order and never interleave. */
  save() {
    this.writing = this.writing
      .catch(() => {})
      .then(() => writeJsonAtomic(this.file, { version: 1, jobs: this.list() }));
    return this.writing;
  }
}
