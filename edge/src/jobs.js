import fsp from "node:fs/promises";
import path from "node:path";
import { ApiError } from "./api.js";
import { sendToDrive } from "./drive.js";
import { isGameGone, isGameJob, uploadGameFile } from "./game.js";
import { gameKey, queueKey } from "./queue.js";
import { backoffMs, safeId, sleep, truncate } from "./util.js";

/** The server fails a clip nobody finished within 15 min — don't start one older than that. */
export const STALE_MS = 15 * 60_000;
/** A cut clip is retried until the server answers; an offline box gives up after this. */
export const UPLOAD_GIVE_UP_MS = 60 * 60_000;
/** The API refuses a button press older than 2 min; stop retrying a bit before that. */
export const PRESS_RELAY_MAX_AGE_MS = 100_000;
const LONG_POLL_SECONDS = 25;
const MAX_CUT_ATTEMPTS = 2;
/** Copying a game is retried this often before the game video is reported as failed. */
const MAX_GAME_ATTEMPTS = 3;
/** CR-040: new Drive sessions for one video before it is reported as failed. */
const MAX_DRIVE_RESTARTS = 4;
/** What a drive-session `reason` means, for the log. */
const KEPT_REASON = {
  NO_DRIVE: "the court has no Google Drive",
  DRIVE_RECONNECT: "Google Drive needs reconnecting on this court",
};

/** A clip job persisted by a box from before CR-006: a 5-minute session part. */
export const isOldSessionPart = (entry) =>
  Boolean(entry?.clipId) &&
  (Boolean(entry.sessionId) ||
    (entry.partIndex !== null && entry.partIndex !== undefined) ||
    Number.isFinite(entry.windowStartMs));

/** The queue key a job from GET /jobs would get. */
const jobKey = (job) => (job?.type === "game" ? gameKey(job.sessionVideoId) : job?.clipId);

/**
 * Job loop: long-poll GET /jobs → persist → claim → cut (when the window is
 * on disk) → upload, with retry/backoff. A job the buffer cannot serve is
 * reported with POST /fail. 404/409 from the API mean the clip is gone or
 * already finished: the job is dropped.
 *
 * Game jobs (CR-006, one camera's whole game after End game) run in their own
 * lane, one at a time: copy the game into one mp4 (`game`), then a resumable
 * chunked upload that pauses between chunks while a clip is waiting to upload.
 *
 * CR-040: a game job with `delivery: "drive"` keeps its file on the box
 * (`videos`, videos.js) and sends it straight to the court's Google Drive
 * (drive.js); `delivery: "server"` (an API from before) uploads it to the API.
 *
 * `clip(entry, { workDir, signal })` is clipper.makeClip and
 * `game(entry, { workDir, signal, onCopy })` game.makeGameFile, with the venue
 * context bound (see index.js) — injected so the loop is testable.
 */
export class JobRunner {
  constructor({
    api,
    queue,
    clip,
    game,
    videos = null,
    jobsDir,
    settings,
    log,
    now = () => Date.now(),
  }) {
    this.api = api;
    this.queue = queue;
    this.clip = clip;
    this.game = game;
    this.videos = videos;
    this.jobsDir = jobsDir;
    this.log = log;
    this.now = now;
    this.limits = {
      cut: settings.clipConcurrency ?? 1,
      upload: settings.uploadConcurrency ?? 1,
      report: 2,
      press: 4,
      // Whole-game videos: one at a time, beside the clips (never instead of them)
      game: 1,
    };
    this.busy = { cut: 0, upload: 0, report: 0, press: 0, game: 0 };
    this.active = new Map();
    this.abort = new AbortController();
    this.stopped = false;
    this.wakeUp = null;
  }

  workDir(entry) {
    return path.join(this.jobsDir, safeId(entry.clipId ?? entry.sessionVideoId));
  }

  async start() {
    await this.queue.load();
    await this.recover();
    if (this.queue.size) this.log.info(`resuming ${this.queue.size} job(s) from the queue`);
    this.pollDone = this.pollLoop();
    this.workDone = this.workLoop();
  }

  /**
   * After a restart: a "ready" clip whose file is gone is cut again; a game
   * video resumes its upload (its file is there) or is made again; session
   * parts from an older box are dropped; stray work folders go.
   */
  async recover() {
    for (const entry of this.queue.list()) {
      entry.nextAttemptAt = 0;
      if (isOldSessionPart(entry)) {
        this.log.info(
          `dropping session part ${entry.clipId} from an older box — games are uploaded as one file per camera now`
        );
        await this.drop(entry);
      } else if (isGameJob(entry)) {
        await this.recoverGame(entry);
      } else if (entry.state === "ready" && !(await exists(entry.videoPath))) {
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
        .filter((e) => e.clipId || isGameJob(e))
        .map((e) => safeId(e.clipId ?? e.sessionVideoId))
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
          if (!this.queue.has(jobKey(job))) fresh += 1;
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
        `DEVICE TOKEN REJECTED (401): this recorder box was revoked. ` +
          `Retrying in ${Math.round(delay / 1000)}s`
      );
      return delay;
    }
    if (err.retryAfterMs) return Math.min(err.retryAfterMs, 600_000);
    return backoffMs(attempt, baseMs, maxMs);
  }

  async enqueue(job) {
    if (job?.type === "game") return this.enqueueGame(job);
    if (!job?.clipId || (job.type && job.type !== "clip")) return undefined;
    // CR-006: games are no longer sent as 5-minute parts
    if (isOldSessionPart(job)) {
      this.log.warn(
        `job ${job.clipId} is a session part — this box makes whole-game files; ignored`
      );
      return undefined;
    }
    const known = this.queue.get(job.clipId);
    if (known) {
      if (!known.claimed) await this.claim(known);
      return undefined;
    }
    const now = this.now();
    const requestedAtMs = Number(job.requestedAtMs);
    if (!Number.isFinite(requestedAtMs)) {
      this.log.warn(`job ${job.clipId} has no requestedAtMs — ignored`);
      return undefined;
    }
    if (now - requestedAtMs > STALE_MS) {
      this.log.info(`job ${job.clipId} is older than 15 min — the server fails it; dropped`);
      return undefined;
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
    return undefined;
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
    // Players' clips before game videos: a game's footage is kept until it is
    // uploaded, a clip's only for BUFFER_SECONDS
    const ordered = this.queue.list().sort((a, b) => Number(isGameJob(a)) - Number(isGameJob(b)));
    for (const entry of ordered) {
      if (this.stopped) return;
      if (this.active.has(queueKey(entry)) || (entry.nextAttemptAt || 0) > now) continue;
      const kind = isGameJob(entry)
        ? "game"
        : { ready: "upload", failing: "report", press: "press" }[entry.state] || "cut";
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
    if (isGameJob(entry)) return this.gameStep(entry);
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
    if (entry.clipId || isGameJob(entry)) {
      await fsp.rm(this.workDir(entry), { recursive: true, force: true });
    }
  }

  /** Clips are being cut/uploaded or waiting — lower-priority work (previews) should wait. */
  isBusy() {
    return (
      this.busy.cut > 0 ||
      this.busy.upload > 0 ||
      this.queue.list().some((e) => e.clipId && e.state === "waiting")
    );
  }

  // ─── Whole-game videos (CR-006) ────────────────────────────────────────────

  /** A game job from GET /jobs: persisted once (the same job comes back until it is finished). */
  async enqueueGame(job) {
    const id = job.sessionVideoId;
    if (!id) {
      this.log.warn("game job without a sessionVideoId — ignored");
      return;
    }
    if (this.queue.has(gameKey(id))) return;
    const windowStartMs = Number(job.windowStartMs);
    const windowEndMs = Number(job.windowEndMs);
    const delivery = job.delivery === "drive" && this.videos ? "drive" : "server";
    const entry = {
      type: "game",
      sessionVideoId: id,
      sessionId: job.sessionId ?? null,
      courtId: job.courtId,
      camera: job.camera ?? 0,
      windowStartMs,
      windowEndMs,
      delivery,
      // Sorts the queue (oldest first) and keeps the entry valid in queue.json
      requestedAtMs: Number.isFinite(windowEndMs) ? windowEndMs : this.now(),
      phase: "waiting",
      attempts: 0,
      nextAttemptAt: 0,
      receivedAt: this.now(),
    };
    // Sent again (Drive connected, or Retry): this box still has the file
    const kept = delivery === "drive" ? this.videos.get(id) : null;
    if (kept) {
      Object.assign(entry, {
        phase: "uploading",
        videoPath: kept.videoPath,
        thumbnailPath: null,
        sizeBytes: kept.sizeBytes,
        durationSeconds: kept.durationSeconds,
        gaps: kept.gaps || [],
      });
      this.log.info(`game video ${id}: sending the copy kept on this box to Google Drive`);
    }
    await this.queue.put(entry);
    const from = Number.isFinite(windowStartMs) ? new Date(windowStartMs).toISOString() : "?";
    const to = Number.isFinite(windowEndMs) ? new Date(windowEndMs).toISOString() : "?";
    this.log.info(
      `game video ${id}: session ${entry.sessionId}, court ${entry.courtId}, camera ${entry.camera}, ${from} → ${to}`
    );
    this.wake();
  }

  /** After a restart: an upload whose file is still there resumes (via /start); else the file is made again. */
  async recoverGame(entry) {
    const key = queueKey(entry);
    if (entry.phase === "copying") {
      await this.queue.update(key, { phase: "waiting" });
    } else if (
      ["uploading", "finishing"].includes(entry.phase) &&
      !(await exists(entry.videoPath))
    ) {
      this.log.info(`game video ${entry.sessionVideoId}: its file is gone — making it again`);
      if (entry.delivery === "drive") await this.videos?.forget(entry.sessionVideoId);
      await this.queue.update(key, {
        phase: "waiting",
        videoPath: null,
        thumbnailPath: null,
        driveFileId: null,
      });
    }
  }

  gameStep(entry) {
    if (entry.phase === "failing") return this.reportGame(entry);
    if (entry.phase === "uploading" || entry.phase === "finishing") {
      return entry.delivery === "drive" ? this.driveGame(entry) : this.uploadGame(entry);
    }
    return this.makeGame(entry);
  }

  async makeGame(entry) {
    const key = queueKey(entry);
    let result;
    try {
      result = await this.game(entry, {
        workDir: this.workDir(entry),
        signal: this.abort.signal,
        onCopy: () => this.queue.update(key, { phase: "copying" }),
      });
    } catch (err) {
      if (this.stopped) return undefined;
      const attempts = (entry.attempts || 0) + 1;
      if (attempts >= MAX_GAME_ATTEMPTS) {
        this.log.error(`could not make game video ${entry.sessionVideoId}`, err);
        return this.toGameFailing(entry, "Could not make the game video on the recorder box");
      }
      this.log.warn(`making game video ${entry.sessionVideoId} failed, trying again`, err);
      await this.queue.update(key, {
        phase: "waiting",
        attempts,
        nextAttemptAt: this.now() + 30_000,
      });
      return undefined;
    }
    if (!this.queue.has(key)) {
      await fsp.rm(this.workDir(entry), { recursive: true, force: true });
      return undefined;
    }
    if (result.status === "wait") {
      entry.nextAttemptAt = this.now() + 5000;
      return undefined;
    }
    if (result.status === "fail") {
      this.log.warn(`game video ${entry.sessionVideoId}: ${result.reason}`);
      return this.toGameFailing(entry, result.reason);
    }
    const mb = (result.sizeBytes / 1024 ** 2).toFixed(1);
    this.log.info(
      `game video ${entry.sessionVideoId}: ${mb} MB, ${result.durationSeconds}s recorded` +
        (result.gaps.length ? `, ${result.gaps.length} gap(s)` : "")
    );
    let { videoPath, thumbnailPath } = result;
    if (entry.delivery === "drive") {
      // Kept on the box from now on; Drive makes its own thumbnail
      ({ videoPath } = await this.videos.adopt(entry.sessionVideoId, result));
      thumbnailPath = null;
    }
    await this.queue.update(key, {
      phase: "uploading",
      videoPath,
      thumbnailPath,
      sizeBytes: result.sizeBytes,
      durationSeconds: result.durationSeconds,
      gaps: result.gaps,
      attempts: 0,
      nextAttemptAt: 0,
    });
    this.wake();
    return undefined;
  }

  async uploadGame(entry) {
    const key = queueKey(entry);
    const id = entry.sessionVideoId;
    let logged = -1;
    try {
      await uploadGameFile({
        api: this.api,
        id,
        file: entry,
        signal: this.abort.signal,
        beforeChunk: () => this.clipsFirst(),
        onPhase: (phase) => this.queue.update(key, { phase }),
        onProgress: (bytes) => {
          const tenth = Math.floor((bytes / Math.max(entry.sizeBytes, 1)) * 10);
          if (tenth !== logged) {
            logged = tenth;
            this.log.info(`game video ${id}: ${tenth * 10}% uploaded`);
          }
        },
      });
      this.log.info(`uploaded game video ${id}`);
      return this.drop(entry);
    } catch (err) {
      if (this.stopped) return undefined;
      if (!(err instanceof ApiError)) {
        // The file itself is the problem (gone, shorter than recorded): make it again
        const attempts = (entry.attempts || 0) + 1;
        if (attempts >= MAX_GAME_ATTEMPTS) {
          this.log.error(`game video ${id}: could not read its file`, err);
          return this.toGameFailing(entry, "Could not read the game video on the recorder box");
        }
        this.log.warn(`game video ${id}: could not read its file — making it again`, err);
        await this.queue.update(key, {
          phase: "waiting",
          attempts,
          nextAttemptAt: this.now() + 5000,
        });
        return undefined;
      }
      if (isGameGone(err, entry.sizeBytes)) {
        this.log.info(`game video ${id} is no longer waiting (${err.status}) — dropped`);
        return this.drop(entry);
      }
      // A 409 that isn't "gone" is a resume answer (offset / missing bytes): try again later
      if (!err.isRetryable && err.status !== 409) {
        this.log.error(`upload of game video ${id} was rejected`, err);
        return this.toGameFailing(entry, `Upload rejected: ${err.detail}`);
      }
      // Network, timeout, 429, 5xx, 401: try again later — the server keeps what it has
      const attempts = (entry.attempts || 0) + 1;
      const delay = this.retryDelay(err, attempts, 5000, 300_000);
      if (err.status !== 401) {
        this.log.warn(
          `upload of game video ${id} stopped, resuming in ${Math.round(delay / 1000)}s`,
          err
        );
      }
      await this.queue.update(key, {
        phase: "uploading",
        attempts,
        nextAttemptAt: this.now() + delay,
      });
      return undefined;
    }
  }

  /**
   * CR-040: send a kept game file to the court's Google Drive (drive.js). The
   * file stays on the box either way; the job ends when Drive has it or the
   * API says to keep it here (no usable Drive).
   */
  async driveGame(entry) {
    const key = queueKey(entry);
    const id = entry.sessionVideoId;
    let logged = -1;
    try {
      const result = await sendToDrive({
        api: this.api,
        id,
        file: entry,
        newSession: Boolean(entry.newSession),
        driveFileId: entry.driveFileId ?? null,
        signal: this.abort.signal,
        beforeChunk: () => this.clipsFirst(),
        onSession: (opened) =>
          this.queue.update(key, {
            newSession: false,
            keepUntilMs: Number.isFinite(opened.keepUntilMs) ? opened.keepUntilMs : null,
          }),
        onUploaded: (driveFileId) => this.queue.update(key, { driveFileId }),
        onProgress: (bytes) => {
          const tenth = Math.floor((bytes / Math.max(entry.sizeBytes, 1)) * 10);
          if (tenth !== logged) {
            logged = tenth;
            this.log.info(`game video ${id}: ${tenth * 10}% on Google Drive`);
          }
        },
      });
      await this.videos.update(id, { onDrive: result.drive, keepUntilMs: result.keepUntilMs });
      const until = Number.isFinite(result.keepUntilMs)
        ? ` until ${new Date(result.keepUntilMs).toISOString()}`
        : "";
      if (result.drive) {
        this.log.info(`game video ${id} is on Google Drive — this box keeps its copy${until}`);
      } else {
        this.log.warn(
          `game video ${id}: ${KEPT_REASON[result.reason] || result.reason} — kept on this box${until}`
        );
      }
      return this.drop(entry);
    } catch (err) {
      if (this.stopped) return undefined;
      return this.driveFailed(entry, err);
    }
  }

  async driveFailed(entry, err) {
    const key = queueKey(entry);
    const id = entry.sessionVideoId;
    const attempts = (entry.attempts || 0) + 1;
    if (!(err instanceof ApiError)) {
      // The file itself is the problem (gone, shorter than recorded): make it again
      await this.videos.forget(id);
      if (attempts >= MAX_GAME_ATTEMPTS) {
        this.log.error(`game video ${id}: could not read its file`, err);
        return this.toGameFailing(entry, "Could not read the game video on the recorder box");
      }
      this.log.warn(`game video ${id}: could not read its file — making it again`, err);
      await this.queue.update(key, {
        phase: "waiting",
        videoPath: null,
        driveFileId: null,
        attempts,
        nextAttemptAt: this.now() + 5000,
      });
      return undefined;
    }
    if (err.code === "DRIVE_SESSION_EXPIRED" || err.code === "DRIVE_FILE_MISMATCH") {
      const restarts = (entry.driveRestarts || 0) + 1;
      if (restarts > MAX_DRIVE_RESTARTS) {
        this.log.error(`game video ${id}: Google Drive kept losing the upload`, err);
        return this.toGameFailing(entry, "Google Drive did not keep the uploaded game video");
      }
      this.log.warn(`game video ${id}: ${err.detail} — starting a new Google Drive upload`);
      await this.queue.update(key, {
        newSession: true,
        driveFileId: null,
        driveRestarts: restarts,
        nextAttemptAt: this.now() + 5000,
      });
      return undefined;
    }
    if (err.code === "DRIVE_REFUSED") {
      this.log.error(`game video ${id}: Google Drive refused it — kept on this box`, err);
      return this.toGameFailing(entry, `Google Drive refused the video: ${err.detail}`);
    }
    if (err.code === "DRIVE_RECONNECT") {
      // Google has the file; the API can't check it until staff reconnect Drive
      if (Number.isFinite(entry.keepUntilMs) && this.now() >= entry.keepUntilMs) {
        return this.toGameFailing(entry, "Google Drive needs reconnecting on this court");
      }
      const delay = Math.max(this.retryDelay(err, attempts, 60_000, 1_800_000), 60_000);
      this.log.warn(
        `game video ${id}: Google Drive needs reconnecting on this court — asking again in ${Math.round(delay / 60_000)} min`
      );
      await this.queue.update(key, { attempts, nextAttemptAt: this.now() + delay });
      return undefined;
    }
    if (isGameGone(err, entry.sizeBytes)) {
      // The API no longer wants it sent; whether the copy stays is /config's keepVideos
      this.log.info(`game video ${id} is no longer waiting (${err.status}) — dropped`);
      return this.drop(entry);
    }
    if (!err.isRetryable && err.code !== "DRIVE_BUSY") {
      this.log.error(`sending game video ${id} was rejected`, err);
      return this.toGameFailing(entry, `Upload rejected: ${err.detail}`);
    }
    // Network, timeout, 429, 5xx, Drive busy, 401: later — Google keeps what it has
    const delay = this.retryDelay(err, attempts, 5000, 300_000);
    if (err.status !== 401) {
      this.log.warn(
        `sending game video ${id} to Google Drive stopped, resuming in ${Math.round(delay / 1000)}s`,
        err
      );
    }
    await this.queue.update(key, { attempts, nextAttemptAt: this.now() + delay });
    return undefined;
  }

  /** Waits while a cut clip is waiting to upload, so a long game upload never holds a replay back. */
  async clipsFirst() {
    while (!this.stopped && this.clipUploadPending()) await sleep(500, this.abort.signal);
  }

  clipUploadPending() {
    const now = this.now();
    return (
      this.busy.upload > 0 ||
      this.queue
        .list()
        .some((e) => e.clipId && e.state === "ready" && (e.nextAttemptAt || 0) <= now)
    );
  }

  async reportGame(entry) {
    const reason = entry.failReason || "Recorder box could not make this game video";
    try {
      await this.api.failGameVideo(entry.sessionVideoId, reason);
      this.log.info(`reported game video ${entry.sessionVideoId} as failed: ${reason}`);
    } catch (err) {
      if (this.stopped) return undefined;
      if (!isGameGone(err) && err.isRetryable) {
        const attempts = (entry.attempts || 0) + 1;
        await this.queue.update(queueKey(entry), {
          attempts,
          nextAttemptAt: this.now() + this.retryDelay(err, attempts, 5000, 300_000),
        });
        return undefined;
      }
    }
    return this.drop(entry);
  }

  async toGameFailing(entry, reason) {
    await fsp.rm(this.workDir(entry), { recursive: true, force: true });
    await this.queue.update(queueKey(entry), {
      phase: "failing",
      failReason: truncate(reason, 255),
      videoPath: null,
      thumbnailPath: null,
      attempts: 0,
      nextAttemptAt: 0,
    });
    this.wake();
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
