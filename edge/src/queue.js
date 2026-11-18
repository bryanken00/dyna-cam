import { readJson, writeJsonAtomic } from "./util.js";

/**
 * The box's clip jobs, persisted to DATA_DIR/queue.json after every change so
 * a reboot neither loses a cut-but-not-uploaded clip nor a job still waiting
 * to be cut (the buffer segments survive a reboot too).
 *
 * Clip entry:  { key, courtId, source, requestedAtMs, preSeconds, postSeconds,
 *               sessionId, partIndex, windowStartMs, windowEndMs, camera (0 | 1 | 2;
 *               missing in entries from older boxes = 0),
 *               state: "waiting" | "ready" | "failing", claimed, attempts,
 *               nextAttemptAt, videoPath?, thumbnailPath?, failReason?, receivedAt }
 * Press entry: { pressId, buttonCode, requestedAtMs (= pressedAtMs), state: "press",
 *               attempts, nextAttemptAt } — a court button press not yet relayed.
 */

/** Queue key: a press's own id, else the clip id. */
export const queueKey = (entry) => entry?.pressId ?? entry?.clipId;

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
      if (queueKey(entry) && Number.isFinite(entry.requestedAtMs))
        this.entries.set(queueKey(entry), entry);
    }
    return this;
  }

  has(key) {
    return this.entries.has(key);
  }

  get(key) {
    return this.entries.get(key) ?? null;
  }

  /** Oldest request first — its footage is the closest to being overwritten. */
  list() {
    return [...this.entries.values()].sort((a, b) => a.requestedAtMs - b.requestedAtMs);
  }

  get size() {
    return this.entries.size;
  }

  async put(entry) {
    this.entries.set(queueKey(entry), entry);
    await this.save();
    return entry;
  }

  async update(key, patch) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    Object.assign(entry, patch);
    await this.save();
    return entry;
  }

  async remove(key) {
    if (this.entries.delete(key)) await this.save();
  }

  /** Writes are chained, so they land in order and never interleave. */
  save() {
    this.writing = this.writing
      .catch(() => {})
      .then(() => writeJsonAtomic(this.file, { version: 1, jobs: this.list() }));
    return this.writing;
  }
}
