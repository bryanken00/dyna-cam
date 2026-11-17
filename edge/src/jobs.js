import fsp from "node:fs/promises";
import path from "node:path";
import { clipWindow, isSessionPart } from "./clipper.js";
import { queueKey } from "./queue.js";
import { backoffMs, safeId, sleep, truncate } from "./util.js";

/** The server fails a clip nobody finished within 15 min — don't start one older than that. */
export const STALE_MS = 15 * 60_000;
/** A cut clip is retried until the server answers; an offline box gives up after this. */
export const UPLOAD_GIVE_UP_MS = 60 * 60_000;
/** The API refuses a button press older than 2 min; stop retrying a bit before that. */
export const PRESS_RELAY_MAX_AGE_MS = 100_000;
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
      press: 4,
    };
    this.busy = { cut: 0, upload: 0, report: 0, press: 0 };
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
        await this.queue.update(queueKey(entry), {
          state: "waiting",
          videoPath: null,
          thumbnailPath: null,
        });
      }
    }
    const keep = new Set(
      this.queue
        .list()
        .filter((e) => e.clipId)
        .map((e) => safeId(e.clipId))
    );
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
          `Add it again in Admin → Setup → Recorder Boxes, put its 6-digit key in .env as PAIRING_CODE, remove DEVICE_TOKEN and restart. Retrying in ${Math.round(delay / 1000)}s`
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
      // Session parts: cut exactly this window (null for ordinary clips)
      sessionId: job.sessionId ?? null,
      partIndex: job.partIndex ?? null,
      windowStartMs: Number.isFinite(job.windowStartMs) ? job.windowStartMs : null,
      windowEndMs: Number.isFinite(job.windowEndMs) ? job.windowEndMs : null,
      state: "waiting",
      claimed: false,
      attempts: 0,
      nextAttemptAt: 0,
      receivedAt: now,
    };
    await this.queue.put(entry);
    const what = isSessionPart(entry)
      ? `session ${entry.sessionId} part ${entry.partIndex}, ${new Date(entry.windowStartMs).toISOString()} → ${new Date(entry.windowEndMs).toISOString()}`
      : `${entry.source || "?"}, requested ${new Date(requestedAtMs).toISOString()}`;
    this.log.info(`job ${entry.clipId}: court ${entry.courtId}, ${what}`);
    await this.claim(entry);
    this.wake();
  }

  /** Claim is best-effort: the upload is accepted for a Pending clip too. */
  async claim(entry) {
    try {
      await this.api.claimClip(entry.clipId);
      await this.queue.update(queueKey(entry), { claimed: true });
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
    // Players' clips before session parts: a part's footage is kept until the
    // session ends + 30 min, a clip's only for BUFFER_SECONDS
    const ordered = this.queue
      .list()
      .sort((a, b) => Number(isSessionPart(a)) - Number(isSessionPart(b)));
    for (const entry of ordered) {
      if (this.stopped) return;
      if (this.active.has(queueKey(entry)) || (entry.nextAttemptAt || 0) > now) continue;
      const kind = { ready: "upload", failing: "report", press: "press" }[entry.state] || "cut";
      if (this.busy[kind] >= this.limits[kind]) continue;
      this.busy[kind] += 1;
      const run = this.step(entry)
        .catch((err) => this.log.error(`job ${queueKey(entry)} step failed`, err))
        .finally(() => {
          this.busy[kind] -= 1;
          this.active.delete(queueKey(entry));
          this.wake();
        });
      this.active.set(queueKey(entry), run);
    }
  }

  /** Do the next thing for one entry (always returns a promise). Exposed for tests. */
  step(entry) {
    if (entry.state === "press") return this.relayPress(entry);
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
      await this.queue.update(queueKey(entry), { attempts, nextAttemptAt: this.now() + 5000 });
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
    await this.queue.update(queueKey(entry), {
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
      await this.queue.update(queueKey(entry), { attempts, nextAttemptAt: this.now() + delay });
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
        await this.queue.update(queueKey(entry), {
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
    await this.queue.update(queueKey(entry), {
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
    await this.queue.remove(queueKey(entry));
    if (entry.clipId) await fsp.rm(this.workDir(entry), { recursive: true, force: true });
  }

  /** Clips are being cut/uploaded or waiting — lower-priority work (previews) should wait. */
  isBusy() {
    return (
      this.busy.cut > 0 ||
      this.busy.upload > 0 ||
      this.queue.list().some((e) => e.clipId && e.state === "waiting")
    );
  }

  /** Windows of this court's clips/parts not cut yet (a recorder restart must not gap them). */
  pendingWindows(courtId) {
    return this.queue
      .list()
      .filter((e) => e.clipId && e.courtId === courtId && e.state === "waiting")
      .map((e) => clipWindow(e));
  }

  // ─── Court buttons ─────────────────────────────────────────────────────────

  /**
   * A button press from the LAN listener (buttons.js). Persisted first, so a
   * restart does not lose it, then relayed to the API by the work loop.
   */
  async addPress({ buttonCode, pressedAtMs }) {
    const entry = {
      pressId: `press-${buttonCode}-${pressedAtMs}`,
      buttonCode,
      requestedAtMs: pressedAtMs,
      state: "press",
      attempts: 0,
      nextAttemptAt: 0,
    };
    await this.queue.put(entry);
    this.wake();
    return entry;
  }

  /** POST /buttons/:code/press. 404/409/422/400 are final; anything else is retried while the press is young. */
  async relayPress(entry) {
    const code = entry.buttonCode;
    const age = this.now() - entry.requestedAtMs;
    if (age > PRESS_RELAY_MAX_AGE_MS) {
      this.log.warn(
        `button ${code}: could not reach the API within ${Math.round(age / 1000)}s — press dropped`
      );
      return this.drop(entry);
    }
    try {
      const data = await this.api.pressButton(code, entry.requestedAtMs, this.abort.signal);
      this.log.info(
        `button ${code}: ${data.merged ? "joined the clip already being saved" : "clip saved"} ` +
          `${data.clipId} — ${data.shareUrl}`
      );
      return this.drop(entry);
    } catch (err) {
      if (this.stopped) return undefined;
      const final = {
        404: `Button code ${code} is not set on any court of this venue — set it in Admin → Courts`,
        409: `button ${code}: its court has no camera configured`,
        422: `button ${code}: press is too old for the recorder buffer`,
        400: `button ${code}: the API rejected the code (${err.detail})`,
      }[err.status];
      if (final) {
        this.log.warn(final);
        return this.drop(entry);
      }
      const attempts = (entry.attempts || 0) + 1;
      const delay = Math.min(this.retryDelay(err, attempts, 1000, 15_000), 15_000);
      if (err.status !== 401) {
        this.log.warn(
          `button ${code}: relay failed, retrying in ${Math.round(delay / 1000)}s`,
          err
        );
      }
      await this.queue.update(queueKey(entry), { attempts, nextAttemptAt: this.now() + delay });
      return undefined;
    }
  }
}

const exists = (file) =>
  file
    ? fsp.access(file).then(
        () => true,
        () => false
      )
    : Promise.resolve(false);
