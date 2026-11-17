import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ApiError } from "../src/api.js";
import { JobRunner, PRESS_RELAY_MAX_AGE_MS, STALE_MS } from "../src/jobs.js";
import { JobQueue } from "../src/queue.js";

const NOW = 1_794_881_000_000;
const silent = { debug() {}, info() {}, warn() {}, error() {} };
let dir;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-jobs-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function fakeApi(overrides = {}) {
  const calls = [];
  const record =
    (name, result) =>
    async (...args) => {
      calls.push([name, ...args]);
      if (result instanceof Error) throw result;
      return typeof result === "function" ? result(...args) : result;
    };
  return {
    calls,
    claimClip: record("claim", overrides.claim ?? {}),
    uploadClip: record("upload", overrides.upload ?? { status: "Ready" }),
    failClip: record("fail", overrides.fail ?? {}),
    getJobs: record("jobs", { jobs: [] }),
    pressButton: record(
      "press",
      overrides.press ?? { clipId: "c-1", shareUrl: "https://x/clip/t", merged: false }
    ),
  };
}

async function makeRunner({ api = fakeApi(), clip, now = NOW } = {}) {
  const clock = typeof now === "function" ? now : () => now;
  const queue = await new JobQueue(path.join(dir, "queue.json")).load();
  const runner = new JobRunner({
    api,
    queue,
    clip: clip ?? (async () => ({ status: "wait" })),
    jobsDir: path.join(dir, "jobs"),
    settings: { clipConcurrency: 1, uploadConcurrency: 1 },
    log: silent,
    now: clock,
  });
  return { runner, queue, api };
}

const job = (clipId, requestedAtMs = NOW - 10_000) => ({
  type: "clip",
  clipId,
  courtId: "court-1",
  source: "QR",
  requestedAtMs,
  preSeconds: 60,
  postSeconds: 5,
});

describe("enqueue", () => {
  it("persists, then claims a new job", async () => {
    const { runner, queue, api } = await makeRunner();
    await runner.enqueue(job("clip-1"));
    assert.deepEqual(
      api.calls.map((c) => c[0]),
      ["claim"]
    );
    assert.equal(queue.get("clip-1").claimed, true);
    assert.equal(queue.get("clip-1").state, "waiting");
    const saved = JSON.parse(await fs.readFile(path.join(dir, "queue.json"), "utf8"));
    assert.equal(saved.jobs[0].clipId, "clip-1");
  });

  it("ignores a job it already has (and re-tries the claim only if it failed)", async () => {
    const { runner, api } = await makeRunner();
    await runner.enqueue(job("clip-1"));
    await runner.enqueue(job("clip-1"));
    assert.equal(api.calls.length, 1);
  });

  it("keeps the job when the claim fails on the network — the upload works without it", async () => {
    const { runner, queue } = await makeRunner({
      api: fakeApi({ claim: new ApiError("offline") }),
    });
    await runner.enqueue(job("clip-1"));
    assert.equal(queue.get("clip-1").claimed, false);
  });

  it("drops a job the server no longer wants (404/409) or that is older than 15 min", async () => {
    const { runner, queue } = await makeRunner({
      api: fakeApi({ claim: new ApiError("done", { status: 409 }) }),
    });
    await runner.enqueue(job("clip-1"));
    assert.equal(queue.has("clip-1"), false);
    await runner.enqueue(job("clip-2", NOW - STALE_MS - 1000));
    assert.equal(queue.has("clip-2"), false);
  });
});

describe("step", () => {
  it("waits, then cuts, then uploads and forgets the job", async () => {
    let ready = false;
    const clip = async (_entry, { workDir }) => {
      if (!ready) return { status: "wait" };
      await fs.mkdir(workDir, { recursive: true });
      await fs.writeFile(path.join(workDir, "clip.mp4"), "mp4");
      return {
        status: "done",
        videoPath: path.join(workDir, "clip.mp4"),
        thumbnailPath: null,
        durationSeconds: 65,
        encoder: "libx264",
      };
    };
    const { runner, queue, api } = await makeRunner({ clip });
    await runner.enqueue(job("clip-1"));

    await runner.step(queue.get("clip-1"));
    assert.equal(queue.get("clip-1").state, "waiting");
    assert.ok(queue.get("clip-1").nextAttemptAt > NOW);

    ready = true;
    await runner.step(queue.get("clip-1"));
    assert.equal(queue.get("clip-1").state, "ready");

    await runner.step(queue.get("clip-1"));
    assert.equal(queue.has("clip-1"), false);
    const upload = api.calls.find((c) => c[0] === "upload");
    assert.equal(upload[1], "clip-1");
    assert.match(upload[2].videoPath, /clip\.mp4$/);
    await assert.rejects(fs.access(path.join(dir, "jobs", "clip-1")));
  });

  it("reports a window the buffer does not cover with POST /fail", async () => {
    const clip = async () => ({ status: "fail", reason: "Camera was not recording at that time" });
    const { runner, queue, api } = await makeRunner({ clip });
    await runner.enqueue(job("clip-1"));
    await runner.step(queue.get("clip-1"));
    assert.equal(queue.get("clip-1").state, "failing");
    await runner.step(queue.get("clip-1"));
    assert.deepEqual(api.calls.at(-1), ["fail", "clip-1", "Camera was not recording at that time"]);
    assert.equal(queue.has("clip-1"), false);
  });

  it("retries ffmpeg once, then reports the failure", async () => {
    const clip = async () => {
      throw new Error("ffmpeg exited with code 1");
    };
    const { runner, queue } = await makeRunner({ clip });
    await runner.enqueue(job("clip-1"));
    await runner.step(queue.get("clip-1"));
    assert.equal(queue.get("clip-1").state, "waiting");
    assert.equal(queue.get("clip-1").attempts, 1);
    await runner.step(queue.get("clip-1"));
    assert.equal(queue.get("clip-1").state, "failing");
    assert.equal(queue.get("clip-1").failReason, "Could not process the video on the recorder box");
  });

  it("keeps a cut clip and backs off when the upload fails on the network", async () => {
    const api = fakeApi({ upload: new ApiError("ECONNRESET") });
    const { runner, queue } = await makeRunner({ api });
    await queue.put({ ...job("clip-1"), state: "ready", videoPath: "/x/clip.mp4", attempts: 0 });
    await runner.step(queue.get("clip-1"));
    assert.equal(queue.get("clip-1").state, "ready");
    assert.equal(queue.get("clip-1").attempts, 1);
    assert.equal(queue.get("clip-1").nextAttemptAt, NOW + 5000);
  });

  it("drops a cut clip on 409 (already finished) and reports a 400 rejection", async () => {
    const gone = await makeRunner({ api: fakeApi({ upload: new ApiError("x", { status: 409 }) }) });
    await gone.queue.put({ ...job("clip-1"), state: "ready", videoPath: "/x/clip.mp4" });
    await gone.runner.step(gone.queue.get("clip-1"));
    assert.equal(gone.queue.has("clip-1"), false);

    const bad = await makeRunner({
      api: fakeApi({
        upload: new ApiError("x", { status: 400, detail: "An mp4 video is required" }),
      }),
    });
    await bad.queue.put({ ...job("clip-2"), state: "ready", videoPath: "/x/clip.mp4" });
    await bad.runner.step(bad.queue.get("clip-2"));
    assert.equal(bad.queue.get("clip-2").state, "failing");
    assert.equal(bad.queue.get("clip-2").failReason, "Upload rejected: An mp4 video is required");
  });

  it("backs off slowly on a revoked token (401)", async () => {
    const { runner, queue } = await makeRunner({
      api: fakeApi({ upload: new ApiError("revoked", { status: 401 }) }),
    });
    await queue.put({ ...job("clip-1"), state: "ready", videoPath: "/x/clip.mp4" });
    await runner.step(queue.get("clip-1"));
    assert.equal(queue.get("clip-1").nextAttemptAt, NOW + 30_000);
  });
});

describe("recover", () => {
  it("re-cuts a ready clip whose file vanished and removes stray work folders", async () => {
    const { runner, queue } = await makeRunner();
    await queue.put({ ...job("clip-1"), state: "ready", videoPath: path.join(dir, "gone.mp4") });
    await fs.mkdir(path.join(dir, "jobs", "orphan"), { recursive: true });
    await runner.recover();
    assert.equal(queue.get("clip-1").state, "waiting");
    await assert.rejects(fs.access(path.join(dir, "jobs", "orphan")));
  });
});

describe("button presses", () => {
  it("persists a press and relays it with the receipt time", async () => {
    const { runner, queue, api } = await makeRunner();
    const entry = await runner.addPress({ buttonCode: "court-1", pressedAtMs: NOW - 500 });
    const saved = JSON.parse(await fs.readFile(path.join(dir, "queue.json"), "utf8"));
    assert.equal(saved.jobs[0].buttonCode, "court-1");
    await runner.step(entry);
    assert.deepEqual(api.calls.at(-1).slice(0, 3), ["press", "court-1", NOW - 500]);
    assert.equal(queue.size, 0);
  });

  it("survives a restart", async () => {
    const first = await makeRunner();
    await first.runner.addPress({ buttonCode: "court-1", pressedAtMs: NOW - 500 });
    const second = await makeRunner();
    assert.equal(second.queue.list()[0].state, "press");
  });

  it("drops 404 / 409 / 422 / 400 as final", async () => {
    for (const status of [404, 409, 422, 400]) {
      const { runner, queue, api } = await makeRunner({
        api: fakeApi({ press: new ApiError("x", { status }) }),
      });
      const entry = await runner.addPress({ buttonCode: `b-${status}`, pressedAtMs: NOW - 500 });
      await runner.step(entry);
      assert.equal(queue.size, 0, String(status));
      assert.equal(api.calls.length, 1);
    }
  });

  it("retries a network failure with backoff, then gives up after ~100 s", async () => {
    let now = NOW;
    const { runner, queue } = await makeRunner({
      api: fakeApi({ press: new ApiError("offline") }),
      now: () => now,
    });
    const entry = await runner.addPress({ buttonCode: "court-1", pressedAtMs: NOW });
    await runner.step(entry);
    assert.equal(queue.get(entry.pressId).attempts, 1);
    assert.equal(queue.get(entry.pressId).nextAttemptAt, NOW + 1000);
    await runner.step(queue.get(entry.pressId));
    assert.equal(queue.get(entry.pressId).nextAttemptAt, NOW + 2000);
    now = NOW + PRESS_RELAY_MAX_AGE_MS + 1;
    await runner.step(queue.get(entry.pressId));
    assert.equal(queue.size, 0);
  });
});
