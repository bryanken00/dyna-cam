import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { ApiError, createApi } from "../src/api.js";
import { DRIVE_CHUNK_UNIT, driveChunkBytes, sendToDrive } from "../src/drive.js";
import { sampleHealth } from "../src/health.js";
import { JobRunner } from "../src/jobs.js";
import { gameKey, JobQueue } from "../src/queue.js";
import { VideoStore } from "../src/videos.js";

/** CR-040: game videos kept on the box and sent straight to the court's Google Drive. */

const T = 1_794_881_000_000;
const DAY = 86_400_000;
const silent = { debug() {}, info() {}, warn() {}, error() {} };
const UNIT = DRIVE_CHUNK_UNIT;

let dir;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-drive-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/**
 * The API's /game-videos Drive routes and Google's upload session, in memory.
 * `script[name](n)` may return an error to throw on the n-th call of `name`.
 */
function fakeDrive({
  drive = true,
  reason = "NO_DRIVE",
  keepUntilMs = T + 7 * DAY,
  script = {},
} = {}) {
  const state = {
    calls: [],
    sessions: 0,
    bytes: Buffer.alloc(0),
    size: null,
    fileId: null,
    done: null,
    progress: [],
    deleted: [],
    keep: 0,
  };
  const counts = {};
  const maybeFail = (name) => {
    counts[name] = (counts[name] || 0) + 1;
    const err = script[name]?.(counts[name]);
    if (err) throw err;
  };
  const sessionUrl = () =>
    `https://www.googleapis.com/upload/drive/v3/files?upload_id=s${state.sessions}`;
  return {
    state,
    openDriveSession: async (id, body) => {
      state.calls.push(["session", id, body.newSession]);
      maybeFail("session");
      state.meta = body;
      if (!drive) return { drive: false, reason, keepUntilMs };
      if (body.newSession || state.sessions === 0 || body.sizeBytes !== state.size) {
        state.sessions += 1;
        state.bytes = Buffer.alloc(0);
        state.size = body.sizeBytes;
        state.fileId = null;
      }
      return { drive: true, uploadUrl: sessionUrl(), chunkBytes: UNIT, keepUntilMs };
    },
    driveUploadStatus: async (url) => {
      state.calls.push(["status", url]);
      maybeFail("status");
      if (state.fileId) return { done: true, fileId: state.fileId };
      return { done: false, receivedBytes: state.bytes.length };
    },
    putDriveChunk: async (url, offset, bytes, total) => {
      state.calls.push(["chunk", offset, bytes.length]);
      maybeFail("chunk");
      assert.equal(total, state.size);
      assert.equal(url, sessionUrl());
      if (offset === state.bytes.length)
        state.bytes = Buffer.concat([state.bytes, Buffer.from(bytes)]);
      if (state.bytes.length === total) {
        state.fileId = `file${state.sessions}`;
        return { done: true, fileId: state.fileId };
      }
      return { done: false, receivedBytes: state.bytes.length };
    },
    reportDriveProgress: async (id, bytes) => {
      state.progress.push(bytes);
      return { receivedBytes: bytes };
    },
    driveDone: async (id, fileId) => {
      state.calls.push(["done", id, fileId]);
      maybeFail("done");
      state.done = fileId;
      return { status: "Ready" };
    },
    boxDeleted: async (id) => {
      maybeFail("boxDeleted");
      state.deleted.push(id);
      return {};
    },
    failGameVideo: async (id, why) => {
      state.calls.push(["fail", id, why]);
      return {};
    },
  };
}

async function writeFile(name, size) {
  const file = path.join(dir, name);
  const bytes = crypto.randomBytes(size);
  await fs.writeFile(file, bytes);
  return { bytes, file: { videoPath: file, sizeBytes: size, durationSeconds: 600, gaps: [] } };
}

// ─── Google's answers (api.js) ────────────────────────────────────────────────

describe("api: Google Drive upload session", () => {
  let server;
  let base;
  const seen = [];
  let reply = () => ({ status: 308 });

  before(async () => {
    server = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        seen.push({ headers: req.headers, url: req.url, body: Buffer.concat(chunks) });
        const { status, headers = {}, body = "" } = reply(req);
        res.writeHead(status, headers);
        res.end(typeof body === "string" ? body : JSON.stringify(body));
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}/upload/drive/v3/files?upload_id=secret123`;
  });
  after(() => server.close());

  const api = () =>
    createApi({
      apiUrl: "http://api.test",
      deviceToken: "dcb_box",
      userAgent: "DynaCamRecorder/9",
    });

  it("PUTs a chunk with Content-Range and no Authorization; 308 Range → bytes Google has", async () => {
    reply = () => ({ status: 308, headers: { Range: "bytes=0-262143" } });
    const answer = await api().putDriveChunk(base, 0, Buffer.alloc(UNIT, 1), 600_000);
    assert.deepEqual(answer, { done: false, receivedBytes: UNIT });
    const req = seen.at(-1);
    assert.equal(req.headers["content-range"], `bytes 0-${UNIT - 1}/600000`);
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers["user-agent"], "DynaCamRecorder/9");
    assert.equal(req.body.length, UNIT);
  });

  it("asks where Google is with an empty PUT; no Range = nothing yet", async () => {
    reply = () => ({ status: 308 });
    assert.deepEqual(await api().driveUploadStatus(base, 600_000), {
      done: false,
      receivedBytes: 0,
    });
    assert.equal(seen.at(-1).headers["content-range"], "bytes */600000");
    assert.equal(seen.at(-1).body.length, 0);
  });

  it("200/201 with the file → its ID", async () => {
    reply = () => ({ status: 201, body: { kind: "drive#file", id: "1AbC_d-9" } });
    assert.deepEqual(await api().driveUploadStatus(base, 10), { done: true, fileId: "1AbC_d-9" });
    reply = () => ({ status: 200, body: { kind: "drive#file" } });
    await assert.rejects(api().driveUploadStatus(base, 10), { code: "DRIVE_BUSY" });
  });

  it("sorts Google's errors: expired session, busy, full, refused — never a 401", async () => {
    const cases = [
      [{ status: 404 }, "DRIVE_SESSION_EXPIRED", 410],
      [{ status: 410 }, "DRIVE_SESSION_EXPIRED", 410],
      [{ status: 401 }, "DRIVE_SESSION_EXPIRED", 410],
      [{ status: 503 }, "DRIVE_BUSY", 503],
      [{ status: 429, headers: { "Retry-After": "9" } }, "DRIVE_BUSY", 429],
      [
        {
          status: 403,
          body: { error: { message: "Rate", errors: [{ reason: "userRateLimitExceeded" }] } },
        },
        "DRIVE_BUSY",
        429,
      ],
      [
        {
          status: 403,
          body: { error: { message: "Full", errors: [{ reason: "storageQuotaExceeded" }] } },
        },
        "DRIVE_REFUSED",
        403,
      ],
      [{ status: 400, body: { error: { message: "Bad range" } } }, "DRIVE_REFUSED", 400],
    ];
    for (const [answer, code, status] of cases) {
      reply = () => answer;
      const err = await api()
        .driveUploadStatus(base, 10)
        .catch((e) => e);
      assert.ok(err instanceof ApiError, JSON.stringify(answer));
      assert.equal(err.code, code, JSON.stringify(answer));
      assert.equal(err.status, status, JSON.stringify(answer));
      // The address is the credential: never in a message
      assert.ok(!err.message.includes("secret123"));
    }
    reply = () => ({ status: 429, headers: { "Retry-After": "9" } });
    const busy = await api()
      .driveUploadStatus(base, 10)
      .catch((e) => e);
    assert.equal(busy.retryAfterMs, 9000);
    reply = () => ({
      status: 403,
      body: { error: { errors: [{ reason: "storageQuotaExceeded" }] } },
    });
    const full = await api()
      .driveUploadStatus(base, 10)
      .catch((e) => e);
    assert.equal(full.detail, "the court's Google Drive is full");
  });

  it("refuses an upload address that isn't https (plain http only on this machine)", async () => {
    for (const bad of ["http://evil.example/upload", "ftp://x/y", "not a url"]) {
      await assert.rejects(api().driveUploadStatus(bad, 10), { code: "DRIVE_BAD_URL" });
    }
  });

  it("device calls: drive-session, progress, drive-done, box-deleted", async () => {
    const sent = [];
    const fetchImpl = async (url, init) => {
      sent.push({ path: new URL(url).pathname, init });
      return new Response(
        JSON.stringify({ success: true, message: "ok", data: { drive: false } }),
        {
          status: 200,
        }
      );
    };
    const client = createApi({
      apiUrl: "http://api.test",
      deviceToken: "dcb_box",
      userAgent: "DynaCamRecorder/9",
      fetchImpl,
    });
    await client.openDriveSession("sv 1", { sizeBytes: 5, durationSeconds: 3, gaps: [] });
    await client.reportDriveProgress("sv-1", 4);
    await client.driveDone("sv-1", "f1");
    await client.boxDeleted("sv-1");
    assert.deepEqual(
      sent.map((s) => s.path),
      [
        "/api/v1/device/game-videos/sv%201/drive-session",
        "/api/v1/device/game-videos/sv-1/progress",
        "/api/v1/device/game-videos/sv-1/drive-done",
        "/api/v1/device/game-videos/sv-1/box-deleted",
      ]
    );
    assert.deepEqual(JSON.parse(sent[0].init.body), {
      sizeBytes: 5,
      durationSeconds: 3,
      gaps: [],
      newSession: false,
    });
    assert.deepEqual(JSON.parse(sent[1].init.body), { uploadedBytes: 4 });
    assert.deepEqual(JSON.parse(sent[2].init.body), { driveFileId: "f1" });
    assert.equal(sent[0].init.headers.Authorization, "Device dcb_box");
  });
});

// ─── sendToDrive ──────────────────────────────────────────────────────────────

describe("sendToDrive", () => {
  it("chunk size: the API's, rounded to 256 KiB, within 256 KiB – 64 MiB", () => {
    assert.equal(driveChunkBytes(8 * 1024 * 1024), 8 * 1024 * 1024);
    assert.equal(driveChunkBytes(UNIT + 5), UNIT);
    assert.equal(driveChunkBytes(10), UNIT);
    assert.equal(driveChunkBytes(1e12), 64 * 1024 * 1024);
    assert.equal(driveChunkBytes(undefined), 8 * 1024 * 1024);
  });

  it("session → chunks → drive-done; Google gets the exact bytes", async () => {
    const api = fakeDrive();
    const { bytes, file } = await writeFile("g.mp4", UNIT * 2 + 1234);
    const uploaded = [];
    const res = await sendToDrive({
      api,
      id: "sv-1",
      file,
      onUploaded: (id) => uploaded.push(id),
    });
    assert.deepEqual(res, { drive: true, keepUntilMs: T + 7 * DAY, driveFileId: "file1" });
    assert.ok(api.state.bytes.equals(bytes));
    assert.equal(api.state.done, "file1");
    assert.deepEqual(uploaded, ["file1"]);
    assert.deepEqual(
      api.state.calls.filter((c) => c[0] === "chunk").map((c) => c.slice(1)),
      [
        [0, UNIT],
        [UNIT, UNIT],
        [UNIT * 2, 1234],
      ]
    );
    assert.equal(api.state.progress.at(-1), bytes.length);
  });

  it("no usable Drive: says so at once and sends nothing", async () => {
    const api = fakeDrive({ drive: false, reason: "DRIVE_RECONNECT" });
    const { file } = await writeFile("g.mp4", 100);
    const res = await sendToDrive({ api, id: "sv-1", file });
    assert.deepEqual(res, { drive: false, reason: "DRIVE_RECONNECT", keepUntilMs: T + 7 * DAY });
    assert.equal(api.state.calls.length, 1);
  });

  it("a dropped connection resumes where Google is, never from zero", async () => {
    const api = fakeDrive({
      script: { chunk: (n) => (n === 2 ? new ApiError("socket hang up") : undefined) },
    });
    const { bytes, file } = await writeFile("g.mp4", UNIT * 3);
    await assert.rejects(sendToDrive({ api, id: "sv-1", file }), { status: 0 });
    // The upload address comes back the same (the API keeps it); Google says it has 1 chunk
    await sendToDrive({ api, id: "sv-1", file });
    const offsets = api.state.calls.filter((c) => c[0] === "chunk").map((c) => c[1]);
    assert.deepEqual(offsets, [0, UNIT, UNIT, UNIT * 2]);
    assert.equal(api.state.sessions, 1);
    assert.ok(api.state.bytes.equals(bytes));
  });

  it("Google already has it all: no chunk, straight to drive-done", async () => {
    const api = fakeDrive();
    const { file } = await writeFile("g.mp4", 1000);
    await sendToDrive({ api, id: "sv-1", file });
    api.state.calls.length = 0;
    api.state.done = null;
    await sendToDrive({ api, id: "sv-1", file });
    assert.deepEqual(
      api.state.calls.map((c) => c[0]),
      ["session", "status", "done"]
    );
    assert.equal(api.state.done, "file1");
  });

  it("a known file ID (Google answered before a restart) skips the upload", async () => {
    const api = fakeDrive();
    const { file } = await writeFile("g.mp4", 1000);
    await sendToDrive({ api, id: "sv-1", file, driveFileId: "abc" });
    assert.deepEqual(
      api.state.calls.map((c) => c[0]),
      ["session", "done"]
    );
    assert.equal(api.state.done, "abc");
  });

  it("asks for a new session when told to", async () => {
    const api = fakeDrive();
    const { file } = await writeFile("g.mp4", 1000);
    await sendToDrive({ api, id: "sv-1", file, newSession: true });
    assert.deepEqual(api.state.calls[0], ["session", "sv-1", true]);
  });

  it("a failed progress report never stops the upload", async () => {
    const api = fakeDrive();
    api.reportDriveProgress = async () => {
      throw new ApiError("busy", { status: 503 });
    };
    const { file } = await writeFile("g.mp4", UNIT + 1);
    const res = await sendToDrive({ api, id: "sv-1", file });
    assert.equal(res.drive, true);
  });
});

// ─── The local store (videos.js) ──────────────────────────────────────────────

async function makeStore({ api = fakeDrive(), now = T, busy = [], freeBytes = 1e12 } = {}) {
  const clock = { now };
  const store = new VideoStore({
    dir: path.join(dir, "videos"),
    api,
    log: silent,
    isBusy: (id) => busy.includes(id),
    diskCriticalMb: 500,
    now: () => clock.now,
    statfs: async () => ({ bavail: Math.floor(clock.freeBytes / 4096), bsize: 4096 }),
  });
  clock.freeBytes = freeBytes;
  await store.load();
  return { store, api, clock };
}

async function keep(store, id, size = 1000) {
  const { file } = await writeFile(`${id}-made.mp4`, size);
  return store.adopt(id, file);
}

describe("VideoStore", () => {
  it("adopts a made file (moved, not copied) and survives a restart", async () => {
    const { store } = await makeStore();
    const { file } = await writeFile("made.mp4", 1500);
    const kept = await store.adopt("sv-1", { ...file, gaps: [{ startMs: 1, endMs: 2 }] });
    assert.equal(kept.videoPath, path.join(dir, "videos", "sv-1", "game.mp4"));
    await assert.rejects(fs.access(file.videoPath));
    assert.equal((await fs.stat(kept.videoPath)).size, 1500);
    assert.deepEqual(store.stats(), { localVideos: 1, localVideoMb: 0 });

    const again = await new VideoStore({
      dir: path.join(dir, "videos"),
      api: {},
      log: silent,
    }).load();
    assert.deepEqual(again.get("sv-1").gaps, [{ startMs: 1, endMs: 2 }]);
    assert.equal(again.get("sv-1").sizeBytes, 1500);
  });

  it("on load: forgets a video whose file is gone (and reports it) and removes stray folders", async () => {
    const { store, api } = await makeStore();
    const kept = await keep(store, "sv-1");
    await fs.rm(kept.videoPath);
    await fs.mkdir(path.join(dir, "videos", "stray"), { recursive: true });
    const again = await new VideoStore({ dir: path.join(dir, "videos"), api, log: silent }).load();
    assert.equal(again.get("sv-1"), null);
    await assert.rejects(fs.access(path.join(dir, "videos", "stray")));
    await again.report();
    assert.deepEqual(api.state.deleted, ["sv-1"]);
  });

  it("a fresh /config: keep times and Drive state from keepVideos; the unlisted go", async () => {
    const { store, api, clock } = await makeStore();
    await keep(store, "listed");
    await keep(store, "gone");
    clock.now = T + 1000;
    await store.reconcile(
      [{ sessionVideoId: "listed", keepUntilMs: T + DAY, onDrive: true }],
      T + 500
    );
    assert.equal(store.get("listed").keepUntilMs, T + DAY);
    assert.equal(store.get("listed").onDrive, true);
    assert.equal(store.get("gone"), null);
    await assert.rejects(fs.access(path.join(dir, "videos", "gone")));
    assert.deepEqual(api.state.deleted, ["gone"]);
  });

  it("never removes a video with a job, or one touched after the /config was asked for", async () => {
    const { store } = await makeStore({ busy: ["queued"] });
    await keep(store, "queued");
    await keep(store, "fresh");
    await store.reconcile([], T - 1);
    assert.ok(store.get("queued"));
    assert.ok(store.get("fresh"));
  });

  it("an API without keepVideos (older) removes nothing", async () => {
    const { store } = await makeStore();
    await keep(store, "sv-1");
    await store.reconcile(undefined, T + DAY);
    assert.ok(store.get("sv-1"));
  });

  it("removes a video once its keep time is over", async () => {
    const { store, api, clock } = await makeStore();
    await keep(store, "sv-1");
    await store.update("sv-1", { keepUntilMs: T + DAY, onDrive: true });
    await store.prune();
    assert.ok(store.get("sv-1"));
    clock.now = T + DAY;
    await store.prune();
    assert.equal(store.get("sv-1"), null);
    assert.deepEqual(api.state.deleted, ["sv-1"]);
  });

  it("disk critically full: oldest on Drive first, then the oldest of the rest", async () => {
    const { store, clock } = await makeStore();
    const MB = 1024 ** 2;
    for (const [id, onDrive] of [
      ["old-local", false],
      ["old-drive", true],
      ["new-drive", true],
      ["new-local", false],
    ]) {
      clock.now += 1000;
      await keep(store, id, 1000);
      await store.update(id, { onDrive });
      store.videos.get(id).sizeBytes = 100 * MB;
    }
    // 350 MB free, 500 MB needed: two videos must go — both on Drive
    clock.freeBytes = 350 * MB;
    await store.prune();
    assert.equal(store.get("old-drive"), null);
    assert.equal(store.get("new-drive"), null);
    assert.ok(store.get("old-local"));
    // Still short: then the oldest not on Drive
    clock.freeBytes = 450 * MB;
    await store.prune();
    assert.equal(store.get("old-local"), null);
    assert.ok(store.get("new-local"));
  });

  it("a removal the API didn't hear about is reported again later; a 404 counts as heard", async () => {
    let down = true;
    const api = fakeDrive({
      script: {
        boxDeleted: () => (down ? new ApiError("offline") : undefined),
      },
    });
    const { store } = await makeStore({ api });
    await keep(store, "sv-1");
    await store.remove("sv-1", "test");
    await store.report();
    assert.deepEqual(api.state.deleted, []);
    assert.ok(store.videos.has("sv-1"));
    down = false;
    await store.report();
    assert.deepEqual(api.state.deleted, ["sv-1"]);
    assert.equal(store.videos.has("sv-1"), false);

    api.boxDeleted = async () => {
      throw new ApiError("not found", { status: 404 });
    };
    await keep(store, "sv-2");
    await store.remove("sv-2", "test");
    await store.report();
    assert.equal(store.videos.has("sv-2"), false);
  });

  it("the heartbeat's system field counts the kept videos", async () => {
    const { store } = await makeStore();
    await keep(store, "sv-1", 3 * 1024 ** 2);
    const health = await sampleHealth({
      dataDir: dir,
      videoStats: () => store.stats(),
      statfs: async () => ({ bavail: 1, blocks: 2, bsize: 1024 ** 2 }),
    });
    assert.equal(health.localVideos, 1);
    assert.equal(health.localVideoMb, 3);
  });
});

// ─── The game lane with delivery: "drive" (jobs.js) ───────────────────────────

const KEY = gameKey("sv-1");
const driveJob = (extra = {}) => ({
  type: "game",
  sessionVideoId: "sv-1",
  sessionId: "sess-1",
  courtId: "court-1",
  camera: 1,
  windowStartMs: T,
  windowEndMs: T + 600_000,
  delivery: "drive",
  ...extra,
});

/** A `game` stand-in that writes `bytes` as the game file (and a thumbnail). */
const copies = (bytes) =>
  async function game(entry, { workDir, onCopy }) {
    await onCopy?.();
    await fs.mkdir(workDir, { recursive: true });
    const videoPath = path.join(workDir, "game.mp4");
    const thumbnailPath = path.join(workDir, "thumb.jpg");
    await fs.writeFile(videoPath, bytes);
    await fs.writeFile(thumbnailPath, "jpg");
    return {
      status: "done",
      videoPath,
      thumbnailPath,
      sizeBytes: bytes.length,
      durationSeconds: 540,
      gaps: [],
    };
  };

async function makeRunner({ api = fakeDrive(), bytes = crypto.randomBytes(UNIT + 99) } = {}) {
  const queue = await new JobQueue(path.join(dir, "queue.json")).load();
  const videos = await new VideoStore({
    dir: path.join(dir, "videos"),
    api,
    log: silent,
    isBusy: (id) => queue.has(gameKey(id)),
    now: () => T,
  }).load();
  let made = 0;
  const make = copies(bytes);
  const runner = new JobRunner({
    api,
    queue,
    videos,
    clip: async () => ({ status: "wait" }),
    game: async (...args) => {
      made += 1;
      return make(...args);
    },
    jobsDir: path.join(dir, "jobs"),
    settings: {},
    log: silent,
    now: () => T + 700_000,
  });
  return { runner, queue, videos, api, bytes, made: () => made };
}

describe("JobRunner: delivery drive", () => {
  it("makes the file, keeps it on the box, sends it to Drive, then forgets the job", async () => {
    const { runner, queue, videos, api, bytes } = await makeRunner();
    await runner.enqueue(driveJob());
    assert.equal(queue.get(KEY).delivery, "drive");
    await runner.step(queue.get(KEY));
    const entry = queue.get(KEY);
    assert.equal(entry.phase, "uploading");
    assert.equal(entry.videoPath, path.join(dir, "videos", "sv-1", "game.mp4"));
    assert.equal(entry.thumbnailPath, null);

    await runner.step(queue.get(KEY));
    assert.equal(queue.has(KEY), false);
    assert.ok(api.state.bytes.equals(bytes));
    assert.equal(api.state.done, "file1");
    // The work folder is gone; the kept copy stays, marked as on Drive
    await assert.rejects(fs.access(path.join(dir, "jobs", "sv-1")));
    const kept = videos.get("sv-1");
    assert.equal(kept.onDrive, true);
    assert.equal(kept.keepUntilMs, T + 7 * DAY);
    assert.ok((await fs.readFile(kept.videoPath)).equals(bytes));
  });

  it("an older API (delivery server or none) keeps the old upload to the API", async () => {
    const { runner, queue } = await makeRunner();
    await runner.enqueue(driveJob({ delivery: undefined }));
    assert.equal(queue.get(KEY).delivery, "server");
  });

  it("no usable Drive: the job ends and the box keeps the only copy", async () => {
    const api = fakeDrive({ drive: false, reason: "NO_DRIVE" });
    const { runner, queue, videos } = await makeRunner({ api });
    await runner.enqueue(driveJob());
    await runner.step(queue.get(KEY));
    await runner.step(queue.get(KEY));
    assert.equal(queue.has(KEY), false);
    assert.equal(videos.get("sv-1").onDrive, false);
    assert.equal(videos.get("sv-1").keepUntilMs, T + 7 * DAY);
  });

  it("sent again later (Drive connected / Retry): the kept copy goes, nothing is made again", async () => {
    const api = fakeDrive({ drive: false });
    const { runner, queue, videos, made, bytes } = await makeRunner({ api });
    await runner.enqueue(driveJob());
    await runner.step(queue.get(KEY));
    await runner.step(queue.get(KEY));
    assert.equal(made(), 1);

    const drive = fakeDrive();
    Object.assign(api, drive, { state: drive.state });
    await runner.enqueue(driveJob());
    assert.equal(queue.get(KEY).phase, "uploading");
    await runner.step(queue.get(KEY));
    assert.equal(made(), 1);
    assert.equal(queue.has(KEY), false);
    assert.ok(drive.state.bytes.equals(bytes));
    assert.equal(videos.get("sv-1").onDrive, true);
  });

  it("an expired session or a file Drive didn't keep: a new session next time", async () => {
    for (const err of [
      new ApiError("gone", { status: 410, code: "DRIVE_SESSION_EXPIRED" }),
      new ApiError("mismatch", { status: 409, code: "DRIVE_FILE_MISMATCH" }),
    ]) {
      const api = fakeDrive({ script: { done: (n) => (n === 1 ? err : undefined) } });
      const { runner, queue } = await makeRunner({ api });
      await runner.enqueue(driveJob());
      await runner.step(queue.get(KEY));
      await runner.step(queue.get(KEY));
      assert.equal(queue.get(KEY).newSession, true, err.code);
      assert.equal(queue.get(KEY).driveFileId, null);
      await runner.step(queue.get(KEY));
      assert.equal(queue.has(KEY), false, err.code);
      assert.deepEqual(
        api.state.calls.filter((c) => c[0] === "session").map((c) => c[2]),
        [false, true]
      );
      await fs.rm(dir, { recursive: true, force: true });
      await fs.mkdir(dir, { recursive: true });
    }
  });

  it("Google answered but drive-done didn't get through: the file ID is kept, no second upload", async () => {
    const api = fakeDrive({
      script: { done: (n) => (n === 1 ? new ApiError("offline") : undefined) },
    });
    const { runner, queue } = await makeRunner({ api });
    await runner.enqueue(driveJob());
    await runner.step(queue.get(KEY));
    await runner.step(queue.get(KEY));
    assert.equal(queue.get(KEY).driveFileId, "file1");
    assert.equal(queue.get(KEY).nextAttemptAt, T + 700_000 + 5000);
    const chunks = api.state.calls.filter((c) => c[0] === "chunk").length;
    await runner.step(queue.get(KEY));
    assert.equal(queue.has(KEY), false);
    assert.equal(api.state.calls.filter((c) => c[0] === "chunk").length, chunks);
  });

  it("Drive needs reconnecting at drive-done: asks again slowly, keeping the file ID", async () => {
    const api = fakeDrive({
      script: {
        done: () => new ApiError("reconnect", { status: 409, code: "DRIVE_RECONNECT" }),
      },
    });
    const { runner, queue } = await makeRunner({ api });
    await runner.enqueue(driveJob());
    await runner.step(queue.get(KEY));
    await runner.step(queue.get(KEY));
    const entry = queue.get(KEY);
    assert.equal(entry.driveFileId, "file1");
    assert.ok(entry.nextAttemptAt >= T + 700_000 + 60_000);
    assert.equal(entry.phase, "uploading");
  });

  it("Google refuses it (full): reported as failed, the box keeps its copy for a Retry", async () => {
    const api = fakeDrive({
      script: {
        chunk: () =>
          new ApiError("full", {
            status: 403,
            code: "DRIVE_REFUSED",
            detail: "the court's Google Drive is full",
          }),
      },
    });
    const { runner, queue, videos } = await makeRunner({ api });
    await runner.enqueue(driveJob());
    await runner.step(queue.get(KEY));
    await runner.step(queue.get(KEY));
    assert.equal(queue.get(KEY).phase, "failing");
    await runner.step(queue.get(KEY));
    assert.equal(queue.has(KEY), false);
    assert.deepEqual(api.state.calls.at(-1), [
      "fail",
      "sv-1",
      "Google Drive refused the video: the court's Google Drive is full",
    ]);
    assert.ok(videos.get("sv-1"));
  });

  it("offline or Drive busy: backs off, the kept file stays", async () => {
    const api = fakeDrive({
      script: { session: (n) => (n === 1 ? new ApiError("offline") : undefined) },
    });
    const { runner, queue, videos } = await makeRunner({ api });
    await runner.enqueue(driveJob());
    await runner.step(queue.get(KEY));
    await runner.step(queue.get(KEY));
    assert.equal(queue.get(KEY).attempts, 1);
    assert.ok(videos.get("sv-1"));
  });

  it("the API no longer wants it (404): the job goes, the copy is /config's to decide", async () => {
    const api = fakeDrive({
      script: { session: () => new ApiError("gone", { status: 404 }) },
    });
    const { runner, queue, videos } = await makeRunner({ api });
    await runner.enqueue(driveJob());
    await runner.step(queue.get(KEY));
    await runner.step(queue.get(KEY));
    assert.equal(queue.has(KEY), false);
    assert.ok(videos.get("sv-1"));
  });

  it("after a restart: a kept file resumes; a missing one is made again", async () => {
    const { runner, queue, videos } = await makeRunner();
    await runner.enqueue(driveJob());
    await runner.step(queue.get(KEY));
    await runner.recover();
    assert.equal(queue.get(KEY).phase, "uploading");
    await fs.rm(videos.get("sv-1").videoPath);
    await runner.recover();
    assert.equal(queue.get(KEY).phase, "waiting");
    assert.equal(videos.get("sv-1"), null);
  });
});
