import fsp from "node:fs/promises";
import path from "node:path";
import { backoffMs, safeId, sleep, truncate } from "./util.js";

/** The server fails a clip nobody finished within 15 min — don't start one older than that. */
export const STALE_MS = 15 * 60_000;
/** A cut clip is retried until the server answers; an offline box gives up after this. */
export const UPLOAD_GIVE_UP_MS = 60 * 60_000;
const LONG_POLL_SECONDS = 25;
const MAX_CUT_ATTEMPTS = 2;

/**
 * Job loop: long-poll GET /jobs → persist → claim → cut (when the window is
 * on disk) → upload, with retry/backoff. A job the buffer cannot serve is
 * reported with POST /fail. 404/409 from the API mean the clip is gone or
 * already finished: the job is dropped.
 *
 * `clip(entry, { workDir, signal })` is clipper.makeClip with the venue
 * context bound (see index.js) — injected so the loop is testable.
 */
export class JobRunner {
  constructor({ api, queue, clip, jobsDir, settings, log, now = () => Date.now() }) {
    this.api = api;
    this.queue = queue;
    this.clip = clip;
    this.jobsDir = jobsDir;
    this.log = log;
    this.now = now;
    this.limits = {
      cut: settings.clipConcurrency ?? 1,
      upload: settings.uploadConcurrency ?? 1,
      report: 2,
    };
    this.busy = { cut: 0, upload: 0, report: 0 };
    this.active = new Map();
    this.abort = new AbortController();
    this.stopped = false;
    this.wakeUp = null;
  }

  workDir(entry) {
    return path.join(this.jobsDir, safeId(entry.clipId));
  }

  async start() {
    await this.queue.load();
    await this.recover();
    if (this.queue.size) this.log.info(`resuming ${this.queue.size} job(s) from the queue`);
    this.pollDone = this.pollLoop();
    this.workDone = this.workLoop();
  }

  /** After a restart: a "ready" clip whose file is gone is cut again; stray work folders go. */
  async recover() {
    for (const entry of this.queue.list()) {
      entry.nextAttemptAt = 0;
      if (entry.state === "ready" && !(await exists(entry.videoPath))) {
        await this.queue.update(entry.clipId, {
          state: "waiting",
          videoPath: null,
          thumbnailPath: null,
        });
      }
    }
    const keep = new Set(this.queue.list().map((e) => safeId(e.clipId)));
    for (const name of await fsp.readdir(this.jobsDir).catch(() => [])) {
      if (!keep.has(name))
        await fsp.rm(path.join(this.jobsDir, name), { recursive: true, force: true });
    }
  }

  async stop() {
    this.stopped = true;
    this.abort.abort();
    this.wake();
    await Promise.allSettled([this.pollDone, this.workDone, ...this.active.values()]);
    await this.queue.writing.catch(() => {});
  }

  wake() {
    this.wakeUp?.();
  }

  // ─── Polling ───────────────────────────────────────────────────────────────

  async pollLoop() {
    let failures = 0;
    while (!this.stopped) {
      const started = this.now();
      try {
        const data = await this.api.getJobs(LONG_POLL_SECONDS, this.abort.signal);
        failures = 0;
        const jobs = Array.isArray(data.jobs) ? data.jobs : [];
        let fresh = 0;
        for (const job of jobs) {
          if (!this.queue.has(job?.clipId)) fresh += 1;
          await this.enqueue(job);
        }
        // An answer with nothing new must not turn into a tight loop
        const minGap = fresh > 0 ? 0 : jobs.length ? 5000 : 1000;
        const elapsed = this.now() - started;
        if (elapsed < minGap) await sleep(minGap - elapsed, this.abort.signal);
      } catch (err) {
        if (this.stopped) break;
        failures += 1;
        const delay = this.retryDelay(err, failures, 2000, 60_000);
        if (err.status !== 401)
          this.log.warn(`job poll failed, retrying in ${Math.round(delay / 1000)}s`, err);
        await sleep(delay, this.abort.signal);
      }
    }
  }

  /** Backoff for a failed API call; a revoked token is logged loudly and retried slowly. */
  retryDelay(err, attempt, baseMs, maxMs) {
    if (err.status === 401) {
      const delay = backoffMs(attempt, 30_000, 300_000);
      this.log.error(
        `DEVICE TOKEN REJECTED (401): this recorder box was revoked or DEVICE_TOKEN is wrong. ` +
          `Add the box again in Admin → Recorder boxes and put the new token in .env. Retrying in ${Math.round(delay / 1000)}s`
      );
      return delay;
    }
    if (err.retryAfterMs) return Math.min(err.retryAfterMs, 600_000);
    return backoffMs(attempt, baseMs, maxMs);
  }

  async enqueue(job) {
    if (!job?.clipId || (job.type && job.type !== "clip")) return;
    const known = this.queue.get(job.clipId);
    if (known) {
      if (!known.claimed) await this.claim(known);
      return;
    }
    const now = this.now();
    const requestedAtMs = Number(job.requestedAtMs);
    if (!Number.isFinite(requestedAtMs)) {
      this.log.warn(`job ${job.clipId} has no requestedAtMs — ignored`);
      return;
    }
    if (now - requestedAtMs > STALE_MS) {
      this.log.info(`job ${job.clipId} is older than 15 min — the server fails it; dropped`);
      return;
    }
    const entry = {
      clipId: job.clipId,
      courtId: job.courtId,
      source: job.source ?? null,
      requestedAtMs,
      preSeconds: Number(job.preSeconds) || 60,
      postSeconds: Number(job.postSeconds) || 5,
      state: "waiting",
      claimed: false,
      attempts: 0,
      nextAttemptAt: 0,
      receivedAt: now,
    };
    await this.queue.put(entry);
    this.log.info(
      `job ${entry.clipId}: court ${entry.courtId}, ${entry.source || "?"}, requested ${new Date(requestedAtMs).toISOString()}`
    );
    await this.claim(entry);
    this.wake();
  }

  /** Claim is best-effort: the upload is accepted for a Pending clip too. */
  async claim(entry) {
    try {
      await this.api.claimClip(entry.clipId);
      await this.queue.update(entry.clipId, { claimed: true });
    } catch (err) {
      if (err.isGone) {
        this.log.info(`clip ${entry.clipId} is no longer waiting (${err.status}) — dropped`);
        await this.drop(entry);
      } else {
        this.log.warn(`could not claim clip ${entry.clipId} — cutting it anyway`, err);
      }
    }
  }

  // ─── Working ───────────────────────────────────────────────────────────────

  async workLoop() {
    while (!this.stopped) {
      this.dispatch();
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 1000);
        this.wakeUp = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
  }

  dispatch() {
    const now = this.now();
    for (const entry of this.queue.list()) {
      if (this.stopped) return;
      if (this.active.has(entry.clipId) || (entry.nextAttemptAt || 0) > now) continue;
      const kind = { ready: "upload", failing: "report" }[entry.state] || "cut";
      if (this.busy[kind] >= this.limits[kind]) continue;
      this.busy[kind] += 1;
      const run = this.step(entry)
        .catch((err) => this.log.error(`job ${entry.clipId} step failed`, err))
        .finally(() => {
          this.busy[kind] -= 1;
          this.active.delete(entry.clipId);
          this.wake();
        });
      this.active.set(entry.clipId, run);
    }
  }

  /** Do the next thing for one entry (always returns a promise). Exposed for tests. */
  step(entry) {
    const age = this.now() - entry.requestedAtMs;
    const limit = entry.state === "waiting" ? STALE_MS : UPLOAD_GIVE_UP_MS;
    if (age > limit) {
      this.log.warn(`clip ${entry.clipId} is ${Math.round(age / 60_000)} min old — giving up`);
      return this.drop(entry);
    }
    if (entry.state === "ready") return this.upload(entry);
    if (entry.state === "failing") return this.report(entry);
    return this.cut(entry);
  }

  async cut(entry) {
    let result;
    try {
      result = await this.clip(entry, { workDir: this.workDir(entry), signal: this.abort.signal });
    } catch (err) {
      if (this.stopped) return undefined;
      const attempts = (entry.attempts || 0) + 1;
      if (attempts >= MAX_CUT_ATTEMPTS) {
        this.log.error(`could not cut clip ${entry.clipId}`, err);
        return this.toFailing(entry, "Could not process the video on the recorder box");
      }
      this.log.warn(`cutting clip ${entry.clipId} failed, trying again`, err);
      await this.queue.update(entry.clipId, { attempts, nextAttemptAt: this.now() + 5000 });
      return undefined;
    }
    if (!this.queue.has(entry.clipId)) {
      await fsp.rm(this.workDir(entry), { recursive: true, force: true });
      return undefined;
    }
    if (result.status === "wait") {
      entry.nextAttemptAt = this.now() + 1000;
      return undefined;
    }
    if (result.status === "fail") {
      this.log.warn(`clip ${entry.clipId}: ${result.reason}`, result.detail);
      return this.toFailing(entry, result.reason);
    }
    this.log.info(
      `cut clip ${entry.clipId}: ${result.durationSeconds.toFixed(1)}s with ${result.encoder}`
    );
    await this.queue.update(entry.clipId, {
      state: "ready",
      videoPath: result.videoPath,
      thumbnailPath: result.thumbnailPath,
      attempts: 0,
      nextAttemptAt: 0,
    });
    this.wake();
    return undefined;
  }

  async upload(entry) {
    try {
      await this.api.uploadClip(
        entry.clipId,
        { videoPath: entry.videoPath, thumbnailPath: entry.thumbnailPath },
        this.abort.signal
      );
      this.log.info(`uploaded clip ${entry.clipId}`);
      return this.drop(entry);
    } catch (err) {
      if (this.stopped) return undefined;
      if (err.isGone) {
        this.log.info(`clip ${entry.clipId} is no longer waiting (${err.status}) — dropped`);
        return this.drop(entry);
      }
      if (!err.isRetryable) {
        this.log.error(`upload of clip ${entry.clipId} was rejected`, err);
        return this.toFailing(entry, `Upload rejected: ${err.detail}`);
      }
      const attempts = (entry.attempts || 0) + 1;
      const delay = this.retryDelay(err, attempts, 5000, 300_000);
      if (err.status !== 401) {
        this.log.warn(
          `upload of clip ${entry.clipId} failed, retrying in ${Math.round(delay / 1000)}s`,
          err
        );
      }
      await this.queue.update(entry.clipId, { attempts, nextAttemptAt: this.now() + delay });
      return undefined;
    }
  }

  async report(entry) {
    try {
      await this.api.failClip(
        entry.clipId,
        entry.failReason || "Recorder box could not make this clip"
      );
      this.log.info(`reported clip ${entry.clipId} as failed: ${entry.failReason}`);
    } catch (err) {
      if (!err.isGone && err.isRetryable && !this.stopped) {
        const attempts = (entry.attempts || 0) + 1;
        await this.queue.update(entry.clipId, {
          attempts,
          nextAttemptAt: this.now() + this.retryDelay(err, attempts, 5000, 300_000),
        });
        return undefined;
      }
      if (this.stopped) return undefined;
    }
    return this.drop(entry);
  }

  async toFailing(entry, reason) {
    await fsp.rm(this.workDir(entry), { recursive: true, force: true });
    await this.queue.update(entry.clipId, {
      state: "failing",
      failReason: truncate(reason, 255),
      videoPath: null,
      thumbnailPath: null,
      attempts: 0,
      nextAttemptAt: 0,
    });
    this.wake();
  }

  async drop(entry) {
    await this.queue.remove(entry.clipId);
    await fsp.rm(this.workDir(entry), { recursive: true, force: true });
  }
}

const exists = (file) =>
  file
    ? fsp.access(file).then(
        () => true,
        () => false
      )
    : Promise.resolve(false);
