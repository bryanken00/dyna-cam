import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  buildStackedClipArgs,
  chooseSources,
  logoLayout,
  QUALITY,
  selectPartSegments,
  selectSegments,
} from "../src/clipper.js";
import { LiveView } from "../src/live.js";
import { buildRecordArgs, cameraKey, courtCameras, RecorderManager } from "../src/recorder.js";
import {
  buildRestreamArgs,
  normalizeLayout,
  planLayout,
  Restreams,
  STACKED_CAP_MESSAGE,
  stackFps,
} from "../src/restream.js";
import { DeviceSync } from "../src/sync.js";
import { cameraDirName, courtDirName, safeId } from "../src/util.js";

/** PLAN-002 Phase H: two cameras on one court. */

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const CAM1 = "rtsp://u:pw@10.0.0.11/stream1";
const CAM2 = "rtsp://u:pw@10.0.0.12/stream1";
const YT = "rtmp://a.rtmp.youtube.com/live2/abcd-efgh-ijkl-mnop";
const FB = "rtmps://live-api-s.facebook.com:443/rtmp/FB-123456789-0-AbCdEfGh";
const T = 1_794_881_000_000;
const tick = () => new Promise((resolve) => setImmediate(resolve));
const waitFor = async (fn) => {
  for (let i = 0; i < 100 && !fn(); i += 1) await new Promise((r) => setTimeout(r, 5));
  assert.ok(fn());
};

/** spawn() stand-in: children that only exit when killed. */
function fakeSpawn() {
  const children = [];
  const spawnImpl = (bin, args) => {
    const child = new EventEmitter();
    Object.assign(child, {
      bin,
      args,
      pid: 1000 + children.length,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      killed: null,
      kill(signal) {
        child.killed = signal;
        setImmediate(() => child.emit("close", null, signal));
      },
    });
    children.push(child);
    return child;
  };
  return { spawnImpl, impl: spawnImpl, children };
}

const court = (over = {}) => ({
  courtId: "court-1",
  name: "Court 1",
  cameraRtspUrl: CAM1,
  cameraVersion: "v1aaaaaaaaaa",
  camera2RtspUrl: CAM2,
  camera2Version: "v2bbbbbbbbbb",
  stream: null,
  ...over,
});

let dir;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-cams-"));
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

const recorders = (spawn) =>
  new RecorderManager({
    dataDir: dir,
    settings: {
      segmentSeconds: 2,
      bufferSeconds: 180,
      recordAudio: true,
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
    },
    ffmpegMajor: 9,
    log: silent,
    spawnImpl: spawn.spawnImpl,
  });

describe("a recorder and a buffer per camera", () => {
  it("names camera 2's folder <court>~cam2, which no court id can produce", () => {
    assert.equal(cameraDirName("court-1"), "court-1");
    assert.equal(cameraDirName("court-1", 2), "court-1~cam2");
    assert.equal(courtDirName("court-1~cam2"), "court-1");
    assert.equal(courtDirName("court-1"), "court-1");
    // An id with "~" is hashed by safeId, so it never ends in ~cam2
    assert.match(safeId("court-1~cam2"), /^id-[0-9a-f]{16}$/);
    assert.equal(cameraKey("court-1", 2), "court-1~cam2");
  });

  it("reads camera 2 from /config, with its own version", () => {
    assert.deepEqual(
      courtCameras(court()).map((c) => [c.camera, c.cameraRtspUrl, c.cameraVersion]),
      [
        [1, CAM1, "v1aaaaaaaaaa"],
        [2, CAM2, "v2bbbbbbbbbb"],
      ]
    );
    assert.equal(courtCameras(court({ camera2RtspUrl: null })).length, 1);
    assert.equal(courtCameras(court({ camera2RtspUrl: undefined })).length, 1, "an older API");
  });

  it("starts one ffmpeg per camera into its own folder and reports each (camera: 1 | 2)", async () => {
    const spawn = fakeSpawn();
    const manager = recorders(spawn);
    await manager.sync([court()]);
    await waitFor(() => spawn.children.length === 2);
    const outputs = spawn.children.map((c) => c.args.at(-1));
    assert.deepEqual(outputs.sort(), [
      path.join(dir, "buffer", "court-1", "%s.ts"),
      path.join(dir, "buffer", "court-1~cam2", "%s.ts"),
    ]);
    assert.deepEqual(spawn.children.map((c) => c.args[c.args.indexOf("-i") + 1]).sort(), [
      CAM1,
      CAM2,
    ]);
    assert.deepEqual(
      manager
        .statuses()
        .map((s) => [s.courtId, s.camera, s.cameraVersion])
        .sort(),
      [
        ["court-1", 1, "v1aaaaaaaaaa"],
        ["court-1", 2, "v2bbbbbbbbbb"],
      ]
    );
    assert.deepEqual(manager.courtDirs("court-1"), [
      path.join(dir, "buffer", "court-1"),
      path.join(dir, "buffer", "court-1~cam2"),
    ]);
    assert.ok(manager.has("court-1"));
    await manager.stopAll();
  });

  it("adds and removes camera 2 without touching camera 1", async () => {
    const spawn = fakeSpawn();
    const manager = recorders(spawn);
    await manager.sync([court({ camera2RtspUrl: null })]);
    await waitFor(() => spawn.children.length === 1);
    const cam1 = spawn.children[0];
    await manager.sync([court()]);
    await waitFor(() => spawn.children.length === 2);
    assert.equal(cam1.killed, null);
    assert.equal(manager.cameraInfo("court-1").length, 2);
    await manager.sync([court({ camera2RtspUrl: null })]);
    assert.equal(spawn.children[1].killed, "SIGTERM", "camera 2 stopped");
    assert.equal(cam1.killed, null, "camera 1 kept recording");
    assert.deepEqual(
      manager.cameraInfo("court-1").map((c) => c.camera),
      [1]
    );
    await manager.stopAll();
  });

  it("never restarts a recorder for a stream change — streams aren't in the recorder", async () => {
    const spawn = fakeSpawn();
    const manager = recorders(spawn);
    await manager.sync([court()]);
    await waitFor(() => spawn.children.length === 2);
    for (const stream of [
      { rtmpUrl: YT, layout: "STACKED" },
      { rtmpUrl: YT, layout: "CAM2" },
      { rtmpUrl: FB, layout: "CAM1" },
      null,
    ]) {
      await manager.sync([court({ stream })]);
    }
    assert.equal(spawn.children.length, 2);
    assert.ok(spawn.children.every((c) => c.killed === null));
    for (const child of spawn.children) {
      assert.ok(!child.args.some((a) => /tee|flv|rtmp/i.test(a)), "no RTMP output on a recorder");
    }
    assert.ok(!buildRecordArgs({ rtspUrl: CAM1, outDir: dir, segmentSeconds: 2 }).includes("tee"));
    await manager.stopAll();
  });

  it("keeps session footage in both folders, and lets a removed camera's folder age out", async () => {
    const spawn = fakeSpawn();
    const manager = recorders(spawn);
    manager.setSessions([{ sessionId: "s1", courtId: "court-1", startMs: T, endMs: T + 600_000 }]);
    assert.equal(manager.keepFor("court-1", T).length, 1);
    assert.equal(manager.keepFor("court-1~cam2", T).length, 1);
    assert.equal(manager.keepFor("court-2~cam2", T).length, 0);
    // A camera-2 folder nobody records any more, with only old footage
    manager.setSessions([]);
    const old = path.join(dir, "buffer", "court-1~cam2");
    await fs.mkdir(old, { recursive: true });
    const oldSec = Math.floor(Date.now() / 1000) - 3600;
    await fs.writeFile(path.join(old, `${oldSec}.ts`), "ts");
    await fs.utimes(path.join(old, `${oldSec}.ts`), oldSec + 2, oldSec + 2);
    await manager.pruneOrphans();
    await assert.rejects(fs.access(old));
  });
});

describe("layouts", () => {
  it("treats a missing or unknown layout (older API) as CAM1", () => {
    assert.equal(normalizeLayout(undefined), "CAM1");
    assert.equal(normalizeLayout("BOTH"), "CAM1");
    assert.equal(normalizeLayout("STACKED"), "STACKED");
  });

  it("needs camera 2 for CAM2 and STACKED, and stacks only when both cameras are up", () => {
    const one = [{ camera: 1, up: true }];
    const both = [
      { camera: 1, up: true },
      { camera: 2, up: true },
    ];
    assert.deepEqual(planLayout("CAM2", one), { layout: "CAM1" });
    assert.deepEqual(planLayout("STACKED", one), { layout: "CAM1" });
    assert.deepEqual(planLayout("STACKED", both), { layout: "STACKED" });
    assert.deepEqual(planLayout("CAM2", both), { layout: "CAM2" });
    assert.deepEqual(planLayout("STACKED", [both[0], { camera: 2, up: false }]), {
      layout: "CAM1",
      note: "Camera 2 has no video — showing Camera 1",
    });
    assert.deepEqual(planLayout("STACKED", [{ camera: 1, up: false }, both[1]]), {
      layout: "CAM2",
      note: "Camera 1 has no video — showing Camera 2",
    });
    // Neither up yet (just started): try stacked, its errors say why
    assert.deepEqual(
      planLayout("STACKED", [
        { camera: 1, up: false },
        { camera: 2, up: false },
      ]),
      { layout: "STACKED" }
    );
  });

  it("caps the stacked frame rate at the slower camera (≤ 30, 25 when unknown)", () => {
    assert.equal(stackFps([30, 15]), 15);
    assert.equal(stackFps([29.97, 30]), 30);
    assert.equal(stackFps([60, 60]), 30);
    assert.equal(stackFps([undefined, 20]), 20);
    assert.equal(stackFps([]), 25);
  });
});

describe("buildRestreamArgs for each layout", () => {
  const after = (args, flag) => args[args.indexOf(flag) + 1];

  it("CAM1 / CAM2: one input, video copied, audio → AAC 44.1 kHz", () => {
    const args = buildRestreamArgs({ inputs: ["http://cam2"], outputUrl: YT, layout: "CAM2" });
    assert.equal(after(args, "-i"), "http://cam2");
    assert.equal(after(args, "-c:v"), "copy");
    assert.equal(after(args, "-ar"), "44100");
    assert.equal(args.filter((a) => a === "-i").length, 1);
    assert.ok(!args.includes("-filter_complex"));
  });

  it("STACKED: both inputs → 1280×720 each → vstack → H.264 ~3 Mbit/s, keyframe every 2 s", () => {
    const args = buildRestreamArgs({
      inputs: ["http://cam1", "http://cam2"],
      outputUrl: YT,
      layout: "STACKED",
      encoder: "libx264",
      fps: 15,
    });
    const inputs = args.flatMap((a, i) => (a === "-i" ? [args[i + 1]] : []));
    assert.deepEqual(inputs, ["http://cam1", "http://cam2"]);
    const filter = after(args, "-filter_complex");
    assert.match(
      filter,
      /\[0:v:0\]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720/
    );
    assert.match(filter, /\[1:v:0\]scale=1280:720/);
    assert.match(filter, /fps=15/);
    assert.match(filter, /\[top\]\[bottom\]vstack=inputs=2,format=yuv420p\[v\]/);
    assert.equal(after(args, "-c:v"), "libx264");
    assert.equal(after(args, "-b:v"), "3000k");
    assert.equal(after(args, "-maxrate"), "3000k");
    assert.ok(!args.includes("-crf"), "a steady rate for streaming");
    assert.equal(after(args, "-g"), "30");
    assert.equal(after(args, "-force_key_frames"), "expr:gte(t,n_forced*2)");
    assert.equal(after(args, "-ar"), "44100");
    assert.deepEqual(args.slice(args.indexOf("[v]") - 1, args.indexOf("[v]") + 3), [
      "-map",
      "[v]",
      "-map",
      "0:a?",
    ]);
    assert.ok(!args.includes("copy"), "nothing copied");
    assert.equal(args.at(-1), YT);
  });

  it("STACKED uses the box's hardware encoder and Cam 2's sound when Cam 1 has none", () => {
    const vaapi = buildRestreamArgs({
      inputs: ["a", "b"],
      outputUrl: YT,
      layout: "STACKED",
      encoder: "h264_vaapi",
      vaapiDevice: "/dev/dri/renderD129",
      audioInput: 1,
    });
    assert.equal(after(vaapi, "-vaapi_device"), "/dev/dri/renderD129");
    assert.ok(vaapi.indexOf("-vaapi_device") < vaapi.indexOf("-i"));
    assert.match(after(vaapi, "-filter_complex"), /format=nv12,hwupload\[v\]$/);
    assert.equal(after(vaapi, "-c:v"), "h264_vaapi");
    assert.ok(vaapi.includes("1:a?"));
    const vt = buildRestreamArgs({
      inputs: ["a", "b"],
      outputUrl: YT,
      layout: "STACKED",
      encoder: "h264_videotoolbox",
    });
    assert.equal(after(vt, "-c:v"), "h264_videotoolbox");
    assert.equal(after(vt, "-g"), "50", "25 fps when unknown → keyframe every 50 frames");
  });
});

/** A LiveView whose server "runs" on 8090 (no socket), with real signing. */
function liveView() {
  const view = new LiveView({ settings: { livePort: 8090 }, log: silent });
  view.key = "d".repeat(64);
  view.server = { address: () => ({ port: 8090 }) };
  return view;
}

describe("Restreams: court streams, layouts and the stacked cap", () => {
  let clock;
  let spawn;
  let cams;
  let streams;
  const make = (over = {}) =>
    new Restreams({
      live: liveView(),
      cameras: (courtId) => cams[courtId] || [],
      log: silent,
      spawnImpl: spawn.impl,
      now: () => clock.now,
      encoder: "h264_videotoolbox",
      ...over,
    });
  const inputsOf = (child) => child.args.flatMap((a, i) => (a === "-i" ? [child.args[i + 1]] : []));
  beforeEach(() => {
    clock = { now: T };
    spawn = fakeSpawn();
    cams = {
      "court-1": [
        { camera: 1, up: true, fps: 30, hasAudio: true },
        { camera: 2, up: true, fps: 15, hasAudio: false },
      ],
      "court-2": [{ camera: 1, up: true }],
    };
    streams = make();
  });
  afterEach(() => streams.stopAll());

  it("runs the venue's court stream as a restream of the box's own live view", async () => {
    streams.setCourts([court({ stream: { rtmpUrl: YT, layout: "CAM2" } })]);
    await streams.tick();
    assert.equal(spawn.children.length, 1);
    const [input] = inputsOf(spawn.children[0]);
    assert.match(
      input,
      /^http:\/\/127\.0\.0\.1:8090\/live\/court-1\/cam2\/index\.m3u8\?exp=\d+&sig=[0-9a-f]{64}$/
    );
    assert.deepEqual(streams.courtStatus("court-1"), {
      streamStatus: "starting",
      streamMessage: "Connecting to YouTube",
    });
    assert.deepEqual(streams.courtStatus("court-2"), { streamStatus: "off" });
  });

  it("stacks both cameras with the box's encoder at the slower camera's rate", async () => {
    streams.setCourts([court({ stream: { rtmpUrl: YT, layout: "STACKED" } })]);
    await streams.tick();
    const args = spawn.children[0].args;
    const inputs = inputsOf(spawn.children[0]);
    assert.match(inputs[0], /\/live\/court-1\/index\.m3u8/);
    assert.match(inputs[1], /\/live\/court-1\/cam2\/index\.m3u8/);
    assert.equal(args[args.indexOf("-c:v") + 1], "h264_videotoolbox");
    assert.match(args[args.indexOf("-filter_complex") + 1], /fps=15/);
    assert.equal(args[args.indexOf("-g") + 1], "30");
  });

  it("restarts only the restream on a layout change; an old API's missing layout is CAM1", async () => {
    streams.setCourts([court({ stream: { rtmpUrl: YT } })]);
    await streams.tick();
    assert.equal(inputsOf(spawn.children[0]).length, 1);
    assert.match(inputsOf(spawn.children[0])[0], /\/live\/court-1\/index\.m3u8/);
    streams.setCourts([court({ stream: { rtmpUrl: YT, layout: "STACKED" } })]);
    await streams.tick();
    assert.equal(spawn.children[0].killed, "SIGTERM");
    assert.equal(inputsOf(spawn.children[1]).length, 2);
    streams.setCourts([court({ stream: null })]);
    await streams.tick();
    assert.equal(spawn.children[1].killed, "SIGTERM");
    assert.deepEqual(streams.courtStatus("court-1"), { streamStatus: "off" });
  });

  it("streams CAM1 for CAM2/STACKED on a court without camera 2", async () => {
    streams.setCourts([
      court({
        courtId: "court-2",
        camera2RtspUrl: null,
        stream: { rtmpUrl: YT, layout: "STACKED" },
      }),
    ]);
    await streams.tick();
    assert.equal(inputsOf(spawn.children[0]).length, 1);
    assert.match(inputsOf(spawn.children[0])[0], /\/live\/court-2\/index\.m3u8/);
    assert.equal(spawn.children[0].args[spawn.children[0].args.indexOf("-c:v") + 1], "copy");
  });

  it("falls back to the camera that is up, and stacks again once both are", async () => {
    cams["court-1"][1].up = false;
    streams.setCourts([court({ stream: { rtmpUrl: YT, layout: "STACKED" } })]);
    await streams.tick();
    assert.equal(inputsOf(spawn.children[0]).length, 1, "camera 1 alone");
    const child = spawn.children[0];
    for (let s = 0; s <= 6; s += 1) {
      clock.now = T + s * 1000;
      child.stdout.write(`out_time_us=${s * 1_000_000}\nprogress=continue\n`);
      await tick();
      await streams.tick();
    }
    assert.deepEqual(streams.courtStatus("court-1"), {
      streamStatus: "live",
      streamMessage: "Live on YouTube (Camera 2 has no video — showing Camera 1)",
    });
    cams["court-1"][1].up = true;
    clock.now = T + 10_000;
    await streams.tick();
    assert.equal(spawn.children.length, 1, "no flapping: waits 30 s after a start");
    clock.now = T + 31_000;
    await streams.tick();
    assert.equal(child.killed, "SIGTERM");
    assert.equal(inputsOf(spawn.children[1]).length, 2, "stacked again");
  });

  it("caps stacked streams across court and player streams (the rest: choose Cam 1 or Cam 2)", async () => {
    streams = make({ maxStacked: 1 });
    streams.setCourts([court({ stream: { rtmpUrl: YT, layout: "STACKED" } })]);
    streams.setSessions([
      {
        sessionId: "s1",
        courtId: "court-1",
        startMs: T - 1000,
        endMs: T + 3_600_000,
        stream: { url: FB, layout: "STACKED" },
      },
      {
        sessionId: "s2",
        courtId: "court-1",
        startMs: T - 500,
        endMs: T + 3_600_000,
        stream: { url: FB.replace("AbCd", "XyZw"), layout: "CAM2" },
      },
    ]);
    await streams.tick();
    assert.equal(spawn.children.length, 2, "the court stream (stacked) and s2 (CAM2)");
    assert.deepEqual(streams.statuses(), [
      { sessionId: "s1", status: "error", message: STACKED_CAP_MESSAGE },
      { sessionId: "s2", status: "starting", message: "Connecting to Facebook" },
    ]);
    assert.equal(
      STACKED_CAP_MESSAGE,
      "Too many stacked streams on this box — choose Cam 1 or Cam 2"
    );
    // The court stream goes back to one camera: the slot frees up
    streams.setCourts([court({ stream: { rtmpUrl: YT, layout: "CAM1" } })]);
    await streams.tick();
    assert.equal(spawn.children.length, 4);
    assert.equal(streams.statuses()[0].status, "starting");
  });

  it("puts the court stream's status on camera 1's heartbeat entry only", async () => {
    const sent = [];
    streams.setCourts([court({ stream: { rtmpUrl: YT, layout: "STACKED" } })]);
    await streams.tick();
    const sync = new DeviceSync({
      api: { heartbeat: async (p) => sent.push(p) },
      recorders: {
        statuses: () => [
          { courtId: "court-1", camera: 1, status: "ok", message: "Recording" },
          { courtId: "court-1", camera: 2, status: "ok", message: "Recording" },
          { courtId: "court-2", camera: 1, status: "ok", message: "Recording" },
        ],
      },
      settings: { dataDir: dir },
      agentVersion: "1",
      log: silent,
      streams,
    });
    await sync.heartbeat();
    assert.deepEqual(sent[0].cameras, [
      {
        courtId: "court-1",
        camera: 1,
        status: "ok",
        message: "Recording",
        streamStatus: "starting",
        streamMessage: "Connecting to YouTube",
      },
      { courtId: "court-1", camera: 2, status: "ok", message: "Recording" },
      { courtId: "court-2", camera: 1, status: "ok", message: "Recording", streamStatus: "off" },
    ]);
  });
});

/** Back-to-back 2 s segments of one camera from `fromSec` to `toSec` (seconds after T). */
const footage = (cam, fromSec, toSec) =>
  Array.from({ length: Math.floor((toSec - fromSec) / 2) }, (_v, i) => ({
    name: `${i}.ts`,
    path: `/buf/${cam}/${i}.ts`,
    startMs: T + (fromSec + 2 * i) * 1000,
    endMs: T + (fromSec + 2 * i + 2) * 1000,
  }));

describe("stacked clips and session parts", () => {
  const clipWin = { startMs: T + 30_000, endMs: T + 95_000 };

  it("stacks both cameras when both cover the window, each with its own offset", () => {
    const sel = [footage(1, 0, 120), footage(2, 1, 121)].map((t) =>
      selectSegments(t, clipWin.startMs, clipWin.endMs)
    );
    const choice = chooseSources(sel, clipWin);
    assert.deepEqual(choice.cameras, [1, 2]);
    assert.equal(choice.durationMs, 65_000);
    assert.deepEqual(
      choice.sources.map((s) => s.offsetMs),
      [0, 1000]
    );
  });

  it("cuts one camera alone when the other doesn't cover the window", () => {
    const cam2Late = [footage(1, 0, 120), footage(2, 60, 120)].map((t) =>
      selectSegments(t, clipWin.startMs, clipWin.endMs)
    );
    assert.deepEqual(chooseSources(cam2Late, clipWin).cameras, [1]);
    const cam1Down = [[], footage(2, 0, 120)].map((t) =>
      selectSegments(t, clipWin.startMs, clipWin.endMs)
    );
    assert.deepEqual(chooseSources(cam1Down, clipWin).cameras, [2]);
    const oneCamera = [selectSegments(footage(1, 0, 120), clipWin.startMs, clipWin.endMs), null];
    assert.deepEqual(chooseSources(oneCamera, clipWin).cameras, [1]);
    const none = [[], []].map((t) => selectSegments(t, clipWin.startMs, clipWin.endMs));
    assert.equal(chooseSources(none, clipWin).fail.reason, "NO_FOOTAGE");
  });

  it("stacks a session part over the stretch both cameras recorded, else one camera", () => {
    const win = { startMs: T, endMs: T + 300_000 };
    const both = [footage(1, 0, 300), footage(2, 20, 300)].map((t) =>
      selectPartSegments(t, win.startMs, win.endMs)
    );
    const choice = chooseSources(both, win, { part: true });
    assert.deepEqual(choice.cameras, [1, 2]);
    assert.equal(choice.durationMs, 280_000);
    assert.deepEqual(
      choice.sources.map((s) => s.offsetMs),
      [20_000, 0]
    );
    const short = [footage(1, 0, 300), footage(2, 0, 250)].map((t) =>
      selectPartSegments(t, win.startMs, win.endMs)
    );
    // Camera 2 has 83 % (enough on its own) but together only 250 s of 300 → still ≥ 80 %
    assert.deepEqual(chooseSources(short, win, { part: true }).cameras, [1, 2]);
    const apart = [footage(1, 0, 250), footage(2, 50, 300)].map((t) =>
      selectPartSegments(t, win.startMs, win.endMs)
    );
    assert.deepEqual(chooseSources(apart, win, { part: true }).cameras, [1], "overlap only 200 s");
  });

  it("builds one ffmpeg: trim each, 1280×720 each, vstack, watermark, H.264 1280×1440 + Cam 1's AAC", () => {
    const args = buildStackedClipArgs({
      listPaths: ["/w/list-1.ffconcat", "/w/list-2.ffconcat"],
      offsetsMs: [1500, 250],
      durationMs: 65_000,
      logoPath: "/logo.png",
      fps: 15,
      audioInput: 0,
      encoder: "libx264",
      outPath: "/w/clip.mp4",
    });
    const inputs = args.flatMap((a, i) => (a === "-i" ? [args[i + 1]] : []));
    assert.deepEqual(inputs, ["/w/list-1.ffconcat", "/w/list-2.ffconcat", "/logo.png"]);
    const filter = args[args.indexOf("-filter_complex") + 1];
    assert.match(
      filter,
      /\[0:v:0\]trim=start=1\.500:duration=65\.000,setpts=PTS-STARTPTS,scale=1280:720/
    );
    assert.match(filter, /\[1:v:0\]trim=start=0\.250:duration=65\.000/);
    assert.match(filter, /\[top\]\[bottom\]vstack=inputs=2\[stack\]/);
    const { logoWidth, margin } = logoLayout(1280);
    assert.ok(filter.includes(`[2:v]scale=${logoWidth}:-2`));
    assert.ok(filter.includes(`overlay=x=W-w-${margin}:y=H-h-${margin},format=yuv420p[v]`));
    assert.match(filter, /\[0:a:0\]atrim=start=1\.500:duration=65\.000,asetpts=PTS-STARTPTS\[a\]/);
    assert.deepEqual(args.slice(args.indexOf("[v]") - 1, args.indexOf("[v]") + 5), [
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-t",
      "65.000",
    ]);
    assert.equal(args[args.indexOf("-maxrate") + 1], QUALITY.clipStacked.maxrate);
    assert.ok(args.includes("+faststart"));
  });

  it("takes Cam 2's sound when Cam 1 has none, and makes a silent clip when neither has", () => {
    const base = {
      listPaths: ["a", "b"],
      offsetsMs: [0, 0],
      durationMs: 60_000,
      fps: 25,
      encoder: "libx264",
      outPath: "o.mp4",
    };
    const cam2 = buildStackedClipArgs({ ...base, audioInput: 1 });
    assert.match(cam2[cam2.indexOf("-filter_complex") + 1], /\[1:a:0\]atrim/);
    const silentClip = buildStackedClipArgs({ ...base, audioInput: null });
    assert.ok(!silentClip.includes("[a]"));
    assert.doesNotMatch(silentClip[silentClip.indexOf("-filter_complex") + 1], /atrim/);
  });

  it("keeps a stacked 5-min session part under the API's 100 MB upload limit", () => {
    const kbps =
      parseInt(QUALITY.sessionStacked.maxrate, 10) + parseInt(QUALITY.sessionStacked.audio, 10);
    assert.ok((kbps * 1000 * 300) / 8 / 1024 / 1024 < 90);
  });
});
