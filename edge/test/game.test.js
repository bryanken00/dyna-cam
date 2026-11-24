import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ApiError, createApi } from "../src/api.js";
import { CAPABILITY_GAME_FILE, DEVICE_CAPABILITIES } from "../src/config.js";
import {
  buildGameConcatList,
  buildGameCopyArgs,
  fileOffsetMs,
  gameFailureReason,
  isGameGone,
  planGame,
  selectGameSegments,
  uploadGameFile,
} from "../src/game.js";
import { JobRunner } from "../src/jobs.js";
import { gameKey, JobQueue } from "../src/queue.js";
import { DeviceSync } from "../src/sync.js";

/** CR-006: one file per camera per game, copied, uploaded in resumable chunks. */

const T = 1_794_881_000_000;
const silent = { debug() {}, info() {}, warn() {}, error() {} };
const settings = { segmentSeconds: 2, bufferSeconds: 180 };

/** Back-to-back 2 s segments of one camera from `fromSec` to `toSec` (seconds after T). */
const footage = (cam, fromSec, toSec) =>
  Array.from({ length: Math.floor((toSec - fromSec) / 2) }, (_v, i) => ({
    name: `${T / 1000 + fromSec + 2 * i}.ts`,
    path: `/buf/cam${cam}/${fromSec + 2 * i}.ts`,
    startMs: T + (fromSec + 2 * i) * 1000,
    endMs: T + (fromSec + 2 * i + 2) * 1000,
  }));

/** A 10-min game [T, T + 600 s] for one camera. */
const gameJob = (camera, extra = {}) => ({
  type: "game",
  sessionVideoId: `sv-${camera}`,
  sessionId: "sess-1",
  courtId: "court-1",
  camera,
  windowStartMs: T,
  windowEndMs: T + 600_000,
  ...extra,
});

const AFTER = T + 700_000; // past every wait limit
const twoCams = { courtCameras: [1, 2], now: AFTER, settings };
const oneCam = { courtCameras: [1], now: AFTER, settings };

describe("selectGameSegments: footage, gaps and duration", () => {
  it("takes every segment overlapping the game, with no gaps when it was all recorded", () => {
    const sel = selectGameSegments(footage(1, -3, 604), T, T + 600_000);
    assert.equal(sel.ok, true);
    assert.equal(sel.segments[0].startMs, T - 1000);
    assert.ok(sel.segments.at(-1).endMs >= T + 600_000);
    assert.deepEqual(sel.gaps, []);
    assert.equal(sel.coveredMs, 600_000);
  });

  it("counts a hole of up to 7 s as recorded (held frame), reports longer ones as gaps", () => {
    const short = [...footage(1, 0, 100), ...footage(1, 106, 600)];
    assert.deepEqual(selectGameSegments(short, T, T + 600_000).gaps, []);
    const long = [...footage(1, 0, 100), ...footage(1, 160, 600)];
    const sel = selectGameSegments(long, T, T + 600_000);
    assert.deepEqual(sel.gaps, [{ startMs: T + 100_000, endMs: T + 160_000 }]);
    assert.equal(sel.coveredMs, 540_000);
  });

  it("reports footage that starts late or stops early as gaps at the edges", () => {
    const sel = selectGameSegments(footage(1, 30, 500), T, T + 600_000);
    assert.deepEqual(sel.gaps, [
      { startMs: T, endMs: T + 30_000 },
      { startMs: T + 500_000, endMs: T + 600_000 },
    ]);
    assert.equal(sel.coveredMs, 470_000);
  });

  it("says NO_FOOTAGE when the camera recorded nothing in the window", () => {
    assert.deepEqual(selectGameSegments(footage(1, 700, 800), T, T + 600_000), {
      ok: false,
      reason: "NO_FOOTAGE",
    });
  });

  it("maps a wall-clock time into the file, leaving out skipped gaps", () => {
    const segs = [...footage(1, -2, 100), ...footage(1, 160, 610)];
    assert.equal(fileOffsetMs(segs, T + 600_000), 602_000 - 60_000);
    assert.equal(fileOffsetMs(segs, T + 50_000), 52_000);
    // Footage ends before the time: nothing to trim
    assert.equal(fileOffsetMs(footage(1, 0, 500), T + 600_000), null);
  });
});

describe("planGame", () => {
  it("camera 0 and 1 copy camera 1's buffer, camera 2 camera 2's — never stacked", () => {
    const both = [footage(1, -1, 605), footage(2, -1, 605)];
    for (const [camera, folder] of [
      [0, "cam1"],
      [1, "cam1"],
      [2, "cam2"],
    ]) {
      const plan = planGame(gameJob(camera), both, twoCams);
      assert.equal(plan.status, "copy", String(camera));
      assert.ok(plan.segments.every((s) => s.path.includes(`/${folder}/`)));
      assert.equal(plan.durationSeconds, 600);
      assert.deepEqual(plan.gaps, []);
      // The file starts at the first segment's keyframe (1 s early) and is cut at the game's end
      assert.equal(plan.cutMs, 601_000);
    }
    // Footage that ends right at the end of the game: nothing to trim
    assert.equal(planGame(gameJob(1), [footage(1, 0, 600), []], oneCam).cutMs, null);
  });

  it("durationSeconds = the window minus its gaps, whole seconds", () => {
    const holed = [[...footage(1, -1, 99), ...footage(1, 161, 605)], []];
    const plan = planGame(gameJob(1), holed, oneCam);
    assert.equal(plan.durationSeconds, 538);
    assert.deepEqual(plan.gaps, [{ startMs: T + 99_000, endMs: T + 161_000 }]);
    assert.equal(plan.cutMs, 601_000 - 62_000);
  });

  it("waits until the end of the game is in a closed segment (or a minute has passed)", () => {
    const growing = [footage(1, 0, 590), []];
    assert.equal(planGame(gameJob(1), growing, { ...oneCam, now: T + 610_000 }).status, "wait");
    const later = planGame(gameJob(1), growing, { ...oneCam, now: T + 661_000 });
    assert.equal(later.status, "copy");
    assert.deepEqual(later.gaps, [{ startMs: T + 590_000, endMs: T + 600_000 }]);
  });

  it("fails a camera with no footage, naming camera 1 or 2", () => {
    const cam1Only = [footage(1, 0, 604), []];
    assert.equal(planGame(gameJob(2), cam1Only, { ...twoCams, now: T + 610_000 }).status, "wait");
    assert.deepEqual(planGame(gameJob(2), cam1Only, twoCams), {
      status: "fail",
      reason: "Camera 2 was not recording during this game",
    });
    assert.equal(
      planGame(gameJob(1), [[], footage(2, 0, 604)], twoCams).reason,
      "Camera 1 was not recording during this game"
    );
    assert.equal(
      planGame(gameJob(0), [[], []], oneCam).reason,
      "The camera was not recording during this game"
    );
    assert.equal(gameFailureReason(0), "The camera was not recording during this game");
  });

  it("fails a camera-2 job at once on a court without camera 2, unless camera 2 recorded the game", () => {
    const early = { ...oneCam, now: T + 600_500 };
    assert.deepEqual(planGame(gameJob(2), [footage(1, 0, 604), []], early), {
      status: "fail",
      reason: "This court has no camera 2",
    });
    const recorded = planGame(gameJob(2), [footage(1, 0, 604), footage(2, 0, 604)], oneCam);
    assert.equal(recorded.status, "copy");
  });

  it("fails an unknown camera number or a job without its window", () => {
    assert.equal(planGame(gameJob(3), [[], []], twoCams).reason, "This court has no camera 3");
    const noWindow = gameJob(1, { windowEndMs: null });
    assert.equal(planGame(noWindow, [[], []], twoCams).status, "fail");
  });
});

describe("game copy: ffmpeg arguments", () => {
  it("keeps short holes as wall-clock spacing and leaves gaps out", () => {
    const list = buildGameConcatList([
      { path: "/a/1.ts", startMs: T, endMs: T + 2000 },
      { path: "/it's/2.ts", startMs: T + 2030, endMs: T + 4000 },
      { path: "/a/3.ts", startMs: T + 60_000, endMs: T + 62_000 },
      { path: "/a/4.ts", startMs: T + 62_000, endMs: T + 64_000 },
    ]);
    assert.equal(
      list,
      "ffconcat version 1.0\nfile '/a/1.ts'\nduration 2.030\nfile '/it'\\''s/2.ts'\n" +
        "file '/a/3.ts'\nduration 2.000\nfile '/a/4.ts'\n"
    );
  });

  it("stream-copies video and audio into a faststart mp4 — no encoder, no filter, no logo", () => {
    const args = buildGameCopyArgs({
      listPath: "/j/list.ffconcat",
      cutMs: 600_500,
      outPath: "/j/game.mp4",
    });
    const joined = args.join(" ");
    assert.match(joined, /-f concat -safe 0 -i \/j\/list\.ffconcat/);
    assert.match(
      joined,
      /-map 0:v:0 -map 0:a\? -c:v copy -bsf:v filter_units=remove_types=0 -c:a copy -bsf:a aac_adtstoasc/
    );
    assert.match(joined, /-t 600\.500 -movflags \+faststart -f mp4 \/j\/game\.mp4$/);
    for (const banned of [
      "-filter_complex",
      "-vf",
      "libx264",
      "-crf",
      "-maxrate",
      "overlay",
      "scale",
    ]) {
      assert.ok(!joined.includes(banned), banned);
    }
    assert.equal(args.filter((a) => a === "-i").length, 1);
    assert.ok(!buildGameCopyArgs({ listPath: "l", cutMs: null, outPath: "o" }).includes("-t"));
  });
});

// ─── Upload state machine ─────────────────────────────────────────────────────

let dir;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-game-"));
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

const CHUNK = 1000;

/**
 * An in-memory stand-in for the API's game-video endpoints. `script` can make
 * a call fail: { start, chunk, finish } → (n, args) → Error | undefined.
 */
function fakeServer({ chunkBytes = CHUNK, script = {} } = {}) {
  const state = { size: null, bytes: Buffer.alloc(0), status: "Uploading", calls: [], thumb: null };
  const n = { start: 0, chunk: 0, finish: 0 };
  const maybeFail = (name, args) => {
    n[name] += 1;
    const err = script[name]?.(n[name], args);
    if (err) throw err;
  };
  return {
    state,
    startGameUpload: async (id, body) => {
      state.calls.push(["start", id, body.sizeBytes, state.bytes.length]);
      maybeFail("start", body);
      if (state.size !== body.sizeBytes) {
        state.size = body.sizeBytes;
        state.bytes = Buffer.alloc(0);
      }
      state.meta = body;
      return { receivedBytes: state.bytes.length, chunkBytes };
    },
    putGameChunk: async (id, offset, bytes) => {
      state.calls.push(["chunk", id, offset, bytes.length]);
      maybeFail("chunk", { offset, bytes });
      if (offset !== state.bytes.length) {
        throw new ApiError("409", {
          status: 409,
          code: "OFFSET_MISMATCH",
          data: { receivedBytes: state.bytes.length },
        });
      }
      state.bytes = Buffer.concat([state.bytes, Buffer.from(bytes)]);
      return { receivedBytes: state.bytes.length };
    },
    finishGameUpload: async (id, thumbnailPath) => {
      state.calls.push(["finish", id]);
      maybeFail("finish", {});
      if (state.bytes.length < state.size) {
        throw new ApiError("409", { status: 409, data: { receivedBytes: state.bytes.length } });
      }
      state.status = "Ready";
      state.thumb = thumbnailPath;
      return { status: "Ready" };
    },
    failGameVideo: async (id, reason) => {
      state.calls.push(["fail", id, reason]);
      return {};
    },
  };
}

async function gameFile(size = 4500) {
  const file = path.join(dir, `game-${size}.mp4`);
  const bytes = crypto.randomBytes(size);
  await fs.writeFile(file, bytes);
  return {
    bytes,
    file: { videoPath: file, thumbnailPath: null, sizeBytes: size, durationSeconds: 600, gaps: [] },
  };
}

describe("uploadGameFile", () => {
  it("start → chunks from the start → finish; the server gets the exact bytes", async () => {
    const api = fakeServer();
    const { bytes, file } = await gameFile();
    const phases = [];
    const res = await uploadGameFile({ api, id: "sv-1", file, onPhase: (p) => phases.push(p) });
    assert.deepEqual(res, { status: "Ready" });
    assert.ok(api.state.bytes.equals(bytes));
    assert.deepEqual(
      api.state.calls.map((c) => c.slice(0, 3)),
      [
        ["start", "sv-1", 4500],
        ["chunk", "sv-1", 0],
        ["chunk", "sv-1", 1000],
        ["chunk", "sv-1", 2000],
        ["chunk", "sv-1", 3000],
        ["chunk", "sv-1", 4000],
        ["finish", "sv-1"],
      ]
    );
    assert.equal(api.state.calls[5][3], 500, "last chunk is the rest");
    assert.deepEqual(phases, ["finishing"]);
    assert.deepEqual(api.state.meta, { sizeBytes: 4500, durationSeconds: 600, gaps: [] });
  });

  it("resumes from what the server already has", async () => {
    const api = fakeServer();
    const { bytes, file } = await gameFile();
    api.state.size = 4500;
    api.state.bytes = bytes.subarray(0, 3000);
    await uploadGameFile({ api, id: "sv-1", file });
    assert.deepEqual(
      api.state.calls.filter((c) => c[0] === "chunk").map((c) => c[2]),
      [3000, 4000]
    );
    assert.ok(api.state.bytes.equals(bytes));
  });

  it("continues from the server's offset after a 409 OFFSET_MISMATCH", async () => {
    const api = fakeServer();
    const { bytes, file } = await gameFile();
    // The server lost the last chunk it acknowledged
    const realPut = api.putGameChunk;
    let dropped = false;
    api.putGameChunk = async (id, offset, chunk) => {
      const res = await realPut(id, offset, chunk);
      if (offset === 2000 && !dropped) {
        dropped = true;
        api.state.bytes = api.state.bytes.subarray(0, 2000);
      }
      return res;
    };
    await uploadGameFile({ api, id: "sv-1", file });
    assert.deepEqual(
      api.state.calls.filter((c) => c[0] === "chunk").map((c) => c[2]),
      [0, 1000, 2000, 3000, 2000, 3000, 4000]
    );
    assert.ok(api.state.bytes.equals(bytes));
  });

  it("goes back to sending chunks when finish answers 409 with missing bytes", async () => {
    const api = fakeServer();
    const { bytes, file } = await gameFile();
    const realFinish = api.finishGameUpload;
    let once = false;
    api.finishGameUpload = async (...args) => {
      if (!once) {
        once = true;
        api.state.bytes = api.state.bytes.subarray(0, 4000);
      }
      return realFinish(...args);
    };
    const phases = [];
    await uploadGameFile({ api, id: "sv-1", file, onPhase: (p) => phases.push(p) });
    assert.deepEqual(phases, ["finishing", "uploading", "finishing"]);
    assert.ok(api.state.bytes.equals(bytes));
  });

  it("throws a network error as it is (the caller retries) and waits for clips before each chunk", async () => {
    const api = fakeServer({
      script: { chunk: (k) => (k === 3 ? new ApiError("ECONNRESET") : undefined) },
    });
    const { file } = await gameFile();
    let asked = 0;
    await assert.rejects(
      uploadGameFile({ api, id: "sv-1", file, beforeChunk: async () => (asked += 1) }),
      (err) => err.status === 0
    );
    assert.equal(asked, 3);
    assert.equal(api.state.bytes.length, 2000);
  });

  it("tells a game that is gone (404 / other 409) from a resume", () => {
    assert.equal(isGameGone(new ApiError("x", { status: 404 }), 10), true);
    assert.equal(isGameGone(new ApiError("x", { status: 409, code: "INVALID_STATUS" }), 10), true);
    const mismatch = new ApiError("x", {
      status: 409,
      code: "OFFSET_MISMATCH",
      data: { receivedBytes: 4 },
    });
    assert.equal(isGameGone(mismatch, 10), false);
    assert.equal(
      isGameGone(new ApiError("x", { status: 409, data: { receivedBytes: 4 } }), 10),
      false
    );
    assert.equal(
      isGameGone(new ApiError("x", { status: 409, data: { receivedBytes: 10 } }), 10),
      true
    );
    assert.equal(isGameGone(new ApiError("x", { status: 503 }), 10), false);
  });
});

// ─── The game lane of the job loop ────────────────────────────────────────────

async function makeRunner({ api = fakeServer(), game, now = AFTER } = {}) {
  const queue = await new JobQueue(path.join(dir, "queue.json")).load();
  const clock = typeof now === "function" ? now : () => now;
  const runner = new JobRunner({
    api: {
      claimClip: async () => ({}),
      uploadClip: async () => ({}),
      failClip: async () => ({}),
      ...api,
    },
    queue,
    clip: async () => ({ status: "wait" }),
    game: game ?? (async () => ({ status: "wait" })),
    jobsDir: path.join(dir, "jobs"),
    settings: {},
    log: silent,
    now: clock,
  });
  return { runner, queue, api };
}

/** A `game` stand-in that writes `bytes` as the game file. */
const copies = (bytes, extra = {}) =>
  async function game(entry, { workDir, onCopy }) {
    await onCopy?.();
    await fs.mkdir(workDir, { recursive: true });
    const videoPath = path.join(workDir, "game.mp4");
    await fs.writeFile(videoPath, bytes);
    return {
      status: "done",
      videoPath,
      thumbnailPath: null,
      sizeBytes: bytes.length,
      durationSeconds: 540,
      gaps: [{ startMs: T + 100_000, endMs: T + 160_000 }],
      ...extra,
    };
  };

const KEY = gameKey("sv-1");

describe("JobRunner: game jobs", () => {
  it("queues a game job once (it comes back on every poll until finished)", async () => {
    const { runner, queue } = await makeRunner();
    await runner.enqueue(gameJob(1));
    await runner.enqueue(gameJob(1));
    assert.equal(queue.size, 1);
    const entry = queue.get(KEY);
    assert.equal(entry.phase, "waiting");
    assert.equal(entry.camera, 1);
    assert.equal(entry.requestedAtMs, T + 600_000);
    const saved = JSON.parse(await fs.readFile(path.join(dir, "queue.json"), "utf8"));
    assert.equal(saved.jobs[0].sessionVideoId, "sv-1");
  });

  it("copies, persists the file and phase, uploads, then forgets the job and its folder", async () => {
    const bytes = crypto.randomBytes(2500);
    const { runner, queue, api } = await makeRunner({ game: copies(bytes) });
    await runner.enqueue(gameJob(1));
    await runner.step(queue.get(KEY));
    const entry = queue.get(KEY);
    assert.equal(entry.phase, "uploading");
    assert.equal(entry.sizeBytes, 2500);
    assert.equal(entry.durationSeconds, 540);
    const saved = JSON.parse(await fs.readFile(path.join(dir, "queue.json"), "utf8"));
    assert.equal(saved.jobs[0].phase, "uploading");
    assert.equal(saved.jobs[0].gaps.length, 1);

    await runner.step(queue.get(KEY));
    assert.equal(queue.has(KEY), false);
    assert.ok(api.state.bytes.equals(bytes));
    assert.deepEqual(api.state.meta.gaps, [{ startMs: T + 100_000, endMs: T + 160_000 }]);
    await assert.rejects(fs.access(path.join(dir, "jobs", "sv-1")));
  });

  it("a network error mid-upload backs off and resumes from the server's offset, not from 0", async () => {
    const bytes = crypto.randomBytes(3500);
    const api = fakeServer({
      script: { chunk: (k) => (k === 3 ? new ApiError("socket hang up") : undefined) },
    });
    const { runner, queue } = await makeRunner({ api, game: copies(bytes) });
    await runner.enqueue(gameJob(1));
    await runner.step(queue.get(KEY));
    await runner.step(queue.get(KEY));
    assert.equal(queue.get(KEY).phase, "uploading");
    assert.equal(queue.get(KEY).attempts, 1);
    assert.equal(queue.get(KEY).nextAttemptAt, AFTER + 5000);
    await runner.step(queue.get(KEY));
    assert.equal(queue.has(KEY), false);
    const offsets = api.state.calls.filter((c) => c[0] === "chunk").map((c) => c[2]);
    assert.deepEqual(offsets, [0, 1000, 2000, 2000, 3000]);
    assert.equal(api.state.calls.filter((c) => c[0] === "start").length, 2);
    assert.ok(api.state.bytes.equals(bytes));
  });

  it("a 5xx or 429 is retried later (Retry-After honoured)", async () => {
    const api = fakeServer({
      script: { start: () => new ApiError("busy", { status: 429, retryAfterMs: 42_000 }) },
    });
    const { runner, queue } = await makeRunner({ api, game: copies(Buffer.from("x".repeat(10))) });
    await runner.enqueue(gameJob(1));
    await runner.step(queue.get(KEY));
    await runner.step(queue.get(KEY));
    assert.equal(queue.get(KEY).nextAttemptAt, AFTER + 42_000);
  });

  it("drops the job and its files on 404 or a 409 (game gone / already finished)", async () => {
    for (const err of [
      new ApiError("gone", { status: 404 }),
      new ApiError("done", { status: 409, code: "INVALID_STATUS" }),
    ]) {
      const api = fakeServer({ script: { start: () => err } });
      const { runner, queue } = await makeRunner({ api, game: copies(Buffer.from("abc")) });
      await runner.enqueue(gameJob(1));
      await runner.step(queue.get(KEY));
      await runner.step(queue.get(KEY));
      assert.equal(queue.has(KEY), false, String(err.status));
      await assert.rejects(fs.access(path.join(dir, "jobs", "sv-1")));
    }
  });

  it("reports an upload the API rejects (400) with POST /game-videos/:id/fail", async () => {
    const api = fakeServer({
      script: { start: () => new ApiError("x", { status: 400, detail: "sizeBytes is too large" }) },
    });
    const { runner, queue } = await makeRunner({ api, game: copies(Buffer.from("abc")) });
    await runner.enqueue(gameJob(1));
    await runner.step(queue.get(KEY));
    await runner.step(queue.get(KEY));
    assert.equal(queue.get(KEY).phase, "failing");
    await runner.step(queue.get(KEY));
    assert.deepEqual(api.state.calls.at(-1), [
      "fail",
      "sv-1",
      "Upload rejected: sizeBytes is too large",
    ]);
    assert.equal(queue.has(KEY), false);
  });

  it("reports a camera without footage with its reason", async () => {
    const reason = "Camera 2 was not recording during this game";
    const { runner, queue, api } = await makeRunner({
      game: async () => ({ status: "fail", reason }),
    });
    await runner.enqueue(gameJob(2, { sessionVideoId: "sv-1" }));
    await runner.step(queue.get(KEY));
    await runner.step(queue.get(KEY));
    assert.deepEqual(api.state.calls, [["fail", "sv-1", reason]]);
    assert.equal(queue.size, 0);
  });

  it("after a restart: an upload whose file is there resumes via /start where the server stopped", async () => {
    const bytes = crypto.randomBytes(3500);
    const api = fakeServer({
      script: { chunk: (k) => (k === 2 ? new ApiError("box switched off") : undefined) },
    });
    const first = await makeRunner({ api, game: copies(bytes) });
    await first.runner.enqueue(gameJob(1));
    await first.runner.step(first.queue.get(KEY));
    await first.runner.step(first.queue.get(KEY));
    assert.equal(api.state.bytes.length, 1000);

    // A new process: queue.json from disk, the file still in jobs/
    let copied = 0;
    const second = await makeRunner({
      api,
      game: async (...args) => {
        copied += 1;
        return copies(bytes)(...args);
      },
    });
    await second.runner.recover();
    const entry = second.queue.get(KEY);
    assert.equal(entry.phase, "uploading");
    assert.equal(entry.nextAttemptAt, 0);
    await second.runner.step(entry);
    assert.equal(copied, 0, "not copied again");
    assert.equal(second.queue.has(KEY), false);
    assert.deepEqual(
      api.state.calls.filter((c) => c[0] === "chunk").map((c) => c[2]),
      [0, 1000, 1000, 2000, 3000]
    );
    assert.ok(api.state.bytes.equals(bytes));
  });

  it("after a restart: a job whose file is gone (or that was mid-copy) is made again", async () => {
    const { queue } = await makeRunner();
    const base = { ...gameJob(1), requestedAtMs: T + 600_000, attempts: 0, nextAttemptAt: 0 };
    await queue.put({
      ...base,
      phase: "uploading",
      videoPath: path.join(dir, "gone.mp4"),
      sizeBytes: 9,
    });
    await queue.put({ ...base, sessionVideoId: "sv-2", phase: "copying" });
    const { runner, queue: reloaded } = await makeRunner();
    await runner.recover();
    assert.equal(reloaded.get(KEY).phase, "waiting");
    assert.equal(reloaded.get(KEY).videoPath, null);
    assert.equal(reloaded.get(gameKey("sv-2")).phase, "waiting");
  });

  it("clips go first: dispatched before games, and a game upload waits while a clip is ready to upload", async () => {
    const order = [];
    const { runner, queue } = await makeRunner({
      game: async (entry) => {
        order.push(entry.sessionVideoId);
        return { status: "wait" };
      },
    });
    runner.clip = async (entry) => {
      order.push(entry.clipId);
      return { status: "wait" };
    };
    await runner.enqueue(gameJob(1));
    await runner.enqueue({
      type: "clip",
      clipId: "clip-1",
      courtId: "court-1",
      source: "QR",
      requestedAtMs: AFTER - 10_000,
      preSeconds: 60,
      postSeconds: 5,
    });
    runner.dispatch();
    await Promise.all(runner.active.values());
    assert.deepEqual(order, ["clip-1", "sv-1"]);
    assert.equal(runner.limits.game, 1);

    await queue.update("clip-1", { state: "ready", videoPath: "/x/clip.mp4", nextAttemptAt: 0 });
    assert.equal(runner.clipUploadPending(), true);
    let done = false;
    const waiting = runner.clipsFirst().then(() => (done = true));
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(done, false);
    await queue.remove("clip-1");
    await waiting;
    assert.equal(done, true);
  });

  it("a game upload doesn't make the box 'busy' for previews", async () => {
    const { runner } = await makeRunner();
    await runner.enqueue(gameJob(1));
    assert.equal(runner.isBusy(), false);
  });
});

// ─── API client: the game-video endpoints ─────────────────────────────────────

describe("api: game-video endpoints", () => {
  it("sends start JSON, chunks as raw bytes with ?offset, finish multipart; 409 data reaches the caller", async () => {
    const seen = [];
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        seen.push({ method: req.method, url: req.url, headers: req.headers, body });
        res.writeHead(req.url.includes("offset=5") ? 409 : 200, {
          "Content-Type": "application/json",
        });
        if (req.url.includes("offset=5")) {
          res.end(
            JSON.stringify({
              success: false,
              message: "Expected offset 3",
              code: "OFFSET_MISMATCH",
              data: { receivedBytes: 3 },
            })
          );
        } else {
          res.end(
            JSON.stringify({
              success: true,
              message: "ok",
              data: { receivedBytes: 3, chunkBytes: 8 },
            })
          );
        }
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const api = createApi({
        apiUrl: `http://127.0.0.1:${server.address().port}`,
        deviceToken: "dcb_test_token_1234",
        userAgent: "DynaCamRecorder/1.0.0",
      });
      await api.startGameUpload("sv 1", { sizeBytes: 10, durationSeconds: 5, gaps: [] });
      await api.putGameChunk("sv 1", 0, Buffer.from("abc"));
      const err = await api.putGameChunk("sv 1", 5, Buffer.from("xy")).catch((e) => e);
      const thumb = path.join(dir, "thumb.jpg");
      await fs.writeFile(thumb, Buffer.from([0xff, 0xd8, 0xff]));
      await api.finishGameUpload("sv 1", thumb);
      await api.failGameVideo("sv 1", "x".repeat(300));

      assert.deepEqual(
        seen.map((r) => `${r.method} ${r.url}`),
        [
          "POST /api/v1/device/game-videos/sv%201/start",
          "PUT /api/v1/device/game-videos/sv%201/chunk?offset=0",
          "PUT /api/v1/device/game-videos/sv%201/chunk?offset=5",
          "POST /api/v1/device/game-videos/sv%201/finish",
          "POST /api/v1/device/game-videos/sv%201/fail",
        ]
      );
      assert.deepEqual(JSON.parse(seen[0].body), { sizeBytes: 10, durationSeconds: 5, gaps: [] });
      assert.equal(seen[1].headers["content-type"], "application/octet-stream");
      assert.equal(seen[1].body.toString(), "abc");
      assert.equal(seen[1].headers.authorization, "Device dcb_test_token_1234");
      assert.equal(seen[1].headers["user-agent"], "DynaCamRecorder/1.0.0");
      assert.equal(err.status, 409);
      assert.equal(err.code, "OFFSET_MISMATCH");
      assert.deepEqual(err.data, { receivedBytes: 3 });
      assert.match(seen[3].headers["content-type"], /^multipart\/form-data/);
      assert.match(seen[3].body.toString("latin1"), /name="thumbnail"; filename="thumb\.jpg"/);
      assert.equal(JSON.parse(seen[4].body).reason.length, 255);
    } finally {
      server.close();
    }
  });
});

// ─── Heartbeat ────────────────────────────────────────────────────────────────

describe("heartbeat capabilities", () => {
  it('names the capabilities in one constant (no more "session-part-camera")', () => {
    assert.equal(CAPABILITY_GAME_FILE, "game-file");
    assert.deepEqual([...DEVICE_CAPABILITIES], ["game-file", "drive-direct"]);
  });

  it('sends capabilities: ["game-file", "drive-direct"] in every heartbeat', async () => {
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
      [
        ["game-file", "drive-direct"],
        ["game-file", "drive-direct"],
      ]
    );
  });

  it("lists a court's cameras from /config for camera-2 game jobs", () => {
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
