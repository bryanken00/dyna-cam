import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { jobCamera, partFailureReason, planClip } from "../src/clipper.js";
import { CAPABILITY_SESSION_PART_CAMERA, DEVICE_CAPABILITIES } from "../src/config.js";
import { JobRunner } from "../src/jobs.js";
import { JobQueue } from "../src/queue.js";
import { DeviceSync } from "../src/sync.js";

/** CR-003: whole-game session parts cut per camera (`camera: 1 | 2`), clips stay stacked. */

const T = 1_794_881_000_000;
const silent = { debug() {}, info() {}, warn() {}, error() {} };
const settings = { segmentSeconds: 2, bufferSeconds: 180 };

/** Back-to-back 2 s segments of one camera from `fromSec` to `toSec` (seconds after T). */
const footage = (cam, fromSec, toSec) =>
  Array.from({ length: Math.floor((toSec - fromSec) / 2) }, (_v, i) => ({
    name: `${i}.ts`,
    path: `/buf/cam${cam}/${i}.ts`,
    startMs: T + (fromSec + 2 * i) * 1000,
    endMs: T + (fromSec + 2 * i + 2) * 1000,
  }));

/** A 5-min session part [T, T + 300 s], `camera` left out when undefined (older API / box). */
const part = (camera) => ({
  clipId: `part-${camera ?? "x"}`,
  courtId: "court-1",
  source: "SESSION",
  requestedAtMs: T + 300_000,
  sessionId: "sess-1",
  partIndex: 0,
  windowStartMs: T,
  windowEndMs: T + 300_000,
  ...(camera === undefined ? {} : { camera }),
});
const clip = (camera) => ({
  clipId: "clip-1",
  courtId: "court-1",
  source: "QR",
  requestedAtMs: T + 95_000,
  preSeconds: 60,
  postSeconds: 5,
  sessionId: null,
  partIndex: null,
  windowStartMs: null,
  windowEndMs: null,
  ...(camera === undefined ? {} : { camera }),
});

const AFTER = T + 400_000; // well after every wait limit
const twoCams = { courtKnown: true, courtCameras: [1, 2], now: AFTER, settings };
const oneCam = { courtKnown: true, courtCameras: [1], now: AFTER, settings };
const both = [footage(1, 0, 320), footage(2, 0, 320)];
const source = (plan) => plan.sources[0].segments[0].path;

describe("jobCamera", () => {
  it("is 0 when absent or null, the camera for 0/1/2, else -1", () => {
    assert.equal(jobCamera({}), 0);
    assert.equal(jobCamera({ camera: null }), 0);
    assert.equal(jobCamera({ camera: 0 }), 0);
    assert.equal(jobCamera({ camera: 1 }), 1);
    assert.equal(jobCamera({ camera: 2 }), 2);
    assert.equal(jobCamera({ camera: 3 }), -1);
    assert.equal(jobCamera({ camera: "2" }), -1);
  });
});

describe("planClip: camera per job", () => {
  it("camera 0 on a two-camera court: stacked, exactly as before (parts and clips)", () => {
    const p = planClip(part(0), both, twoCams);
    assert.equal(p.status, "cut");
    assert.deepEqual(p.cameras, [1, 2]);
    assert.equal(p.sources.length, 2);
    assert.equal(p.quality, "session");
    const c = planClip(clip(), both, twoCams);
    assert.deepEqual(c.cameras, [1, 2]);
    assert.equal(c.quality, "clip");
    assert.equal(c.durationMs, 65_000);
  });

  it("camera 0 still falls back to the camera that has footage", () => {
    const p = planClip(part(0), [footage(1, 0, 320), []], twoCams);
    assert.deepEqual(p.cameras, [1]);
    const q = planClip(part(0), [[], footage(2, 0, 320)], twoCams);
    assert.deepEqual(q.cameras, [2]);
  });

  it("camera 1: camera 1's footage alone, single-camera session quality", () => {
    const p = planClip(part(1), both, twoCams);
    assert.equal(p.status, "cut");
    assert.deepEqual(p.cameras, [1]);
    assert.equal(p.sources.length, 1);
    assert.match(source(p), /\/cam1\//);
    assert.equal(p.quality, "session");
    assert.equal(p.durationMs, 300_000);
    assert.equal(p.coverage, 1);
    assert.ok(!p.fallback);
  });

  it("camera 2: camera 2's footage alone (its own start), never stacked", () => {
    const p = planClip(part(2), [footage(1, 0, 320), footage(2, 20, 320)], twoCams);
    assert.deepEqual(p.cameras, [2]);
    assert.equal(p.sources.length, 1);
    assert.match(source(p), /\/cam2\//);
    assert.equal(p.durationMs, 280_000);
    assert.equal(p.sources[0].offsetMs, 0);
  });

  it("camera 2 without footage: waits for the window, then fails naming camera 2 — no fallback", () => {
    const timelines = [footage(1, 0, 320), []];
    assert.equal(planClip(part(2), timelines, { ...twoCams, now: T + 301_000 }).status, "wait");
    const p = planClip(part(2), timelines, twoCams);
    assert.equal(p.status, "fail");
    assert.equal(p.reason, "Camera 2 was not recording during this part of the session");
  });

  it("camera 2 below 80 % coverage fails with its coverage", () => {
    const p = planClip(part(2), [footage(1, 0, 320), footage(2, 0, 150)], twoCams);
    assert.equal(p.status, "fail");
    assert.equal(p.reason, "Camera 2 recorded only 50% of this part of the session");
    const q = planClip(part(1), [[], footage(2, 0, 320)], twoCams);
    assert.equal(q.reason, "Camera 1 was not recording during this part of the session");
  });

  it("camera 2 on a one-camera court fails at once: This court has no camera 2", () => {
    const early = { ...oneCam, now: T + 100_000 };
    const p = planClip(part(2), [footage(1, 0, 320), []], early);
    assert.deepEqual(p, { status: "fail", reason: "This court has no camera 2" });
    // An unknown court lists no cameras either
    const q = planClip(part(2), [[], []], { ...early, courtKnown: false, courtCameras: [] });
    assert.equal(q.reason, "This court has no camera 2");
  });

  it("camera 2 taken off the court after recording the window: its footage is still cut", () => {
    const p = planClip(part(2), both, oneCam);
    assert.equal(p.status, "cut");
    assert.deepEqual(p.cameras, [2]);
  });

  it("an unknown camera number fails", () => {
    const p = planClip(part(3), both, twoCams);
    assert.deepEqual(p, { status: "fail", reason: "This court has no camera 3" });
  });

  it("names the camera only for a per-camera part", () => {
    const sel = { ok: false, reason: "NO_FOOTAGE", coverage: 0 };
    assert.equal(
      partFailureReason(sel),
      "Camera was not recording during this part of the session"
    );
    assert.equal(
      partFailureReason(sel, 2),
      "Camera 2 was not recording during this part of the session"
    );
  });
});

describe("job queue: camera", () => {
  let dir;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-camjob-"));
  });
  afterEach(() => fs.rm(dir, { recursive: true, force: true }));

  const runner = async (clipFn) => {
    const queue = await new JobQueue(path.join(dir, "queue.json")).load();
    const api = {
      claimClip: async () => ({}),
      uploadClip: async () => ({}),
      failClip: async () => ({}),
    };
    return {
      queue,
      jobs: new JobRunner({
        api,
        queue,
        clip: clipFn,
        jobsDir: path.join(dir, "jobs"),
        settings: {},
        log: silent,
        now: () => T + 310_000,
      }),
    };
  };

  it("keeps the job's camera; absent/null means 0", async () => {
    const { queue, jobs } = await runner(async () => ({ status: "wait" }));
    await jobs.enqueue({ type: "clip", ...part(2), clipId: "p2" });
    await jobs.enqueue({ type: "clip", ...part(1), clipId: "p1" });
    await jobs.enqueue({ type: "clip", ...part(), clipId: "p0" });
    await jobs.enqueue({ type: "clip", ...part(null), clipId: "pn" });
    assert.deepEqual(
      ["p2", "p1", "p0", "pn"].map((id) => queue.get(id).camera),
      [2, 1, 0, 0]
    );
    const saved = JSON.parse(await fs.readFile(path.join(dir, "queue.json"), "utf8"));
    assert.equal(saved.jobs.find((j) => j.clipId === "p2").camera, 2);
  });

  it("runs a job persisted by an older box (no camera) as camera 0: stacked", async () => {
    const old = {
      clipId: "old-part",
      courtId: "court-1",
      source: "SESSION",
      requestedAtMs: T + 300_000,
      preSeconds: 60,
      postSeconds: 5,
      sessionId: "sess-1",
      partIndex: 0,
      windowStartMs: T,
      windowEndMs: T + 300_000,
      state: "waiting",
      claimed: true,
      attempts: 0,
      nextAttemptAt: 0,
      receivedAt: T + 300_000,
    };
    await fs.writeFile(path.join(dir, "queue.json"), JSON.stringify({ version: 1, jobs: [old] }));
    const planned = [];
    const { queue, jobs } = await runner(async (entry, { workDir }) => {
      const plan = planClip(entry, both, twoCams);
      planned.push(plan);
      await fs.mkdir(workDir, { recursive: true });
      await fs.writeFile(path.join(workDir, "clip.mp4"), "mp4");
      return {
        status: "done",
        videoPath: path.join(workDir, "clip.mp4"),
        thumbnailPath: null,
        durationSeconds: plan.durationMs / 1000,
        encoder: "libx264",
      };
    });
    assert.equal(queue.get("old-part").camera, undefined);
    await jobs.step(queue.get("old-part"));
    assert.deepEqual(planned[0].cameras, [1, 2]);
    assert.equal(queue.get("old-part").state, "ready");
  });
});

describe("heartbeat capabilities", () => {
  it("names the per-camera session part capability in one constant", () => {
    assert.equal(CAPABILITY_SESSION_PART_CAMERA, "session-part-camera");
    assert.deepEqual([...DEVICE_CAPABILITIES], ["session-part-camera"]);
  });

  it('sends capabilities: ["session-part-camera"] in every heartbeat', async () => {
    const sent = [];
    const sync = new DeviceSync({
      api: { heartbeat: async (p) => sent.push(p) },
      recorders: { statuses: () => [] },
      settings: { dataDir: os.tmpdir() },
      agentVersion: "1.0.0",
      log: silent,
    });
    await sync.heartbeat();
    await sync.heartbeat();
    assert.deepEqual(
      sent.map((p) => p.capabilities),
      [["session-part-camera"], ["session-part-camera"]]
    );
  });

  it("lists a court's cameras from /config for camera-2 jobs", () => {
    const sync = new DeviceSync({
      api: {},
      recorders: {},
      settings: { dataDir: os.tmpdir() },
      agentVersion: "1.0.0",
      log: silent,
    });
    sync.config = {
      courts: [
        { courtId: "a", cameraRtspUrl: "rtsp://x/1", camera2RtspUrl: "rtsp://x/2" },
        { courtId: "b", cameraRtspUrl: "rtsp://y/1", camera2RtspUrl: null },
      ],
    };
    assert.deepEqual(sync.courtCameras("a"), [1, 2]);
    assert.deepEqual(sync.courtCameras("b"), [1]);
    assert.deepEqual(sync.courtCameras("zzz"), []);
  });
});
