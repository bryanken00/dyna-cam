import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  buildProbeArgs,
  buildSnapshotArgs,
  duePreviews,
  frameRate,
  latestClosedSegment,
  MediaProbe,
  parseProbe,
  PreviewSender,
} from "../src/camera.js";
import { RecorderManager } from "../src/recorder.js";
import { DeviceSync } from "../src/sync.js";

const silent = { debug() {}, info() {}, warn() {}, error() {} };
let dir;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-camera-"));
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

/** Segment files with the given mtimes (ms); the last one is "being written". */
async function segments(list) {
  for (const [name, mtimeMs] of list) {
    await fs.writeFile(path.join(dir, name), "ts");
    await fs.utimes(path.join(dir, name), mtimeMs / 1000, mtimeMs / 1000);
  }
}

// What ffprobe says about a real C200 segment: claims 30 fps, 30 frames in 2 s
const C200 = {
  streams: [
    {
      codec_type: "video",
      codec_name: "h264",
      width: 1280,
      height: 720,
      avg_frame_rate: "30/1",
      nb_read_packets: "30",
    },
    {
      codec_type: "audio",
      codec_name: "aac",
      sample_rate: "8000",
      avg_frame_rate: "0/0",
      nb_read_packets: "16",
    },
  ],
  format: { duration: "2.000000" },
};

describe("parseProbe", () => {
  it("reports what the camera really sends — the counted 15 fps, not the claimed 30", () => {
    assert.deepEqual(parseProbe(C200), {
      video: { codec: "h264", width: 1280, height: 720, fps: 15 },
      audio: { codec: "aac", sampleRate: 8000 },
    });
  });

  it("keeps the claimed rate when it matches the count, and audio null when there is none", () => {
    const json = {
      streams: [
        {
          codec_type: "video",
          codec_name: "hevc",
          width: 1920,
          height: 1080,
          avg_frame_rate: "25/1",
          nb_read_packets: "52",
        },
      ],
      format: { duration: "2.08" },
    };
    assert.deepEqual(parseProbe(json), {
      video: { codec: "hevc", width: 1920, height: 1080, fps: 25 },
      audio: null,
    });
    assert.deepEqual(parseProbe({ streams: [], format: {} }), { video: null, audio: null });
  });

  it("falls back sensibly when one of the two rates is missing", () => {
    assert.equal(frameRate({ avgFrameRate: "0/0", packets: 45, durationSec: 3 }), 15);
    assert.equal(frameRate({ avgFrameRate: "30000/1001", packets: 0, durationSec: 0 }), 29.97);
    assert.equal(frameRate({ avgFrameRate: "0/0", packets: 1, durationSec: 0.5 }), null);
  });
});

describe("never the camera", () => {
  it("probes and snapshots a segment FILE, never an RTSP URL", () => {
    const probe = buildProbeArgs("/data/buffer/c1/1794881000.ts");
    assert.equal(probe.at(-1), "/data/buffer/c1/1794881000.ts");
    assert.ok(probe.includes("-count_packets"));
    const snap = buildSnapshotArgs({
      file: "/data/buffer/c1/1794881000.ts",
      outPath: "/data/buffer/c1/preview.jpg",
    });
    assert.equal(snap[snap.indexOf("-i") + 1], "/data/buffer/c1/1794881000.ts");
    assert.deepEqual(snap.slice(snap.indexOf("-frames:v"), snap.indexOf("-frames:v") + 2), [
      "-frames:v",
      "1",
    ]);
    assert.equal(snap[snap.indexOf("-vf") + 1], "scale=w='min(1280,iw)':h=-2");
    assert.equal(snap[snap.indexOf("-q:v") + 1], "4");
    for (const args of [probe, snap]) assert.ok(!args.join(" ").includes("rtsp"));
  });

  it("uses the newest FINISHED segment (the newest file is still being written)", () => {
    const entries = [
      { name: "1794881004.ts", mtimeMs: 3 },
      { name: "1794881000.ts", mtimeMs: 1 },
      { name: "1794881002.ts", mtimeMs: 2 },
      { name: "preview.jpg", mtimeMs: 9 },
    ];
    assert.equal(latestClosedSegment(entries).name, "1794881002.ts");
    assert.equal(latestClosedSegment([{ name: "1794881000.ts", mtimeMs: 1 }]), null);
  });
});

describe("MediaProbe", () => {
  it("probes once per new segment, at most every 30 s, and goes stale after a minute", async () => {
    let now = 1_794_881_010_000;
    const calls = [];
    const runFfmpeg = async (_bin, args) => {
      calls.push(args.at(-1));
      return { stdout: JSON.stringify(C200) };
    };
    const probe = new MediaProbe({ runFfmpeg, now: () => now });
    await segments([
      ["1794881000.ts", now - 6000],
      ["1794881002.ts", now - 4000],
      ["1794881004.ts", now],
    ]);
    const info = await probe.refresh(dir);
    assert.equal(info.video.fps, 15);
    assert.deepEqual(calls, [path.join(dir, "1794881002.ts")]);

    now += 10_000;
    await probe.refresh(dir);
    assert.equal(calls.length, 1, "within 30 s: cached");

    now += 25_000;
    await probe.refresh(dir);
    assert.equal(calls.length, 1, "same latest segment: cached");

    await segments([["1794881006.ts", now]]);
    await probe.refresh(dir);
    assert.equal(calls.length, 2);
    assert.ok(probe.current(dir));
    now += 120_000;
    assert.equal(probe.current(dir), null, "camera stopped: no stale details");
  });
});

describe("PreviewSender", () => {
  const setup = async ({ busy = false, upload } = {}) => {
    let now = 1_794_881_010_000;
    const uploads = [];
    const ffmpegInputs = [];
    const sender = new PreviewSender({
      api: {
        uploadSnapshot:
          upload ?? (async (courtId, file) => uploads.push([courtId, path.basename(file)])),
      },
      courtDir: () => dir,
      settings: { ffmpegPath: "ffmpeg" },
      isBusy: () => busy,
      log: silent,
      now: () => now,
      runFfmpeg: async (_bin, args) => {
        ffmpegInputs.push(args[args.indexOf("-i") + 1]);
        await fs.writeFile(args.at(-1), "jpeg");
        return { stdout: "" };
      },
    });
    await segments([
      ["1794881000.ts", now - 4000],
      ["1794881002.ts", now - 2000],
      ["1794881004.ts", now],
    ]);
    return { sender, uploads, ffmpegInputs, advance: (ms) => (now += ms) };
  };

  it("sends one JPEG per wanted court every 30 s, from the latest closed segment, and stops when no longer wanted", async () => {
    const { sender, uploads, ffmpegInputs, advance } = await setup();
    sender.setWanted([
      { courtId: "c1", previewWanted: true },
      { courtId: "c2", previewWanted: false },
    ]);
    assert.equal(sender.active, true);
    assert.deepEqual(await sender.tick(), ["c1"]);
    assert.deepEqual(uploads, [["c1", "preview.jpg"]]);
    assert.deepEqual(ffmpegInputs, [path.join(dir, "1794881002.ts")]);
    await assert.rejects(fs.access(path.join(dir, "preview.jpg")), "temp JPEG removed");

    advance(10_000);
    assert.deepEqual(await sender.tick(), []);
    advance(21_000);
    await segments([["1794881006.ts", 1_794_881_041_000]]);
    assert.deepEqual(await sender.tick(), ["c1"]);

    sender.setWanted([{ courtId: "c1", previewWanted: false }]);
    advance(60_000);
    assert.equal(sender.active, false);
    assert.deepEqual(await sender.tick(), []);
  });

  it("waits while clips are being made", async () => {
    const { sender, uploads } = await setup({ busy: true });
    sender.setWanted([{ courtId: "c1", previewWanted: true }]);
    assert.deepEqual(await sender.tick(), []);
    assert.equal(uploads.length, 0);
  });

  it("drops a court the API answers 404 for", async () => {
    let calls = 0;
    const { sender, advance } = await setup({
      upload: async () => {
        calls += 1;
        throw Object.assign(new Error("Court not found"), { status: 404 });
      },
    });
    sender.setWanted([{ courtId: "c1", previewWanted: true }]);
    await sender.tick();
    advance(60_000);
    await sender.tick();
    assert.equal(calls, 1);
  });

  it("sends a picture of each camera of a 2-camera court, camera 2 from its own folder", async () => {
    const now = 1_794_881_010_000;
    const uploads = [];
    const dirsAsked = [];
    const sender = new PreviewSender({
      api: { uploadSnapshot: async (courtId, _file, camera) => uploads.push([courtId, camera]) },
      courtDir: (courtId, camera) => {
        dirsAsked.push([courtId, camera]);
        return dir;
      },
      settings: { ffmpegPath: "ffmpeg" },
      log: silent,
      now: () => now,
      runFfmpeg: async (_bin, args) => {
        await fs.writeFile(args.at(-1), "jpeg");
        return { stdout: "" };
      },
    });
    await segments([
      ["1794881000.ts", now - 4000],
      ["1794881002.ts", now - 2000],
      ["1794881004.ts", now],
    ]);
    sender.setWanted([
      { courtId: "c1", previewWanted: true, camera2RtspUrl: "rtsp://u:p@10.0.0.2/stream1" },
      { courtId: "c2", previewWanted: true, camera2RtspUrl: null },
    ]);
    assert.deepEqual(await sender.tick(), ["c1", "c1#2", "c2"]);
    assert.deepEqual(uploads, [
      ["c1", 1],
      ["c1", 2],
      ["c2", 1],
    ]);
    assert.deepEqual(dirsAsked, [
      ["c1", 1],
      ["c1", 2],
      ["c2", 1],
    ]);
  });

  it("schedules by court", () => {
    const last = new Map([
      ["a", 1000],
      ["b", 25_000],
    ]);
    assert.deepEqual(duePreviews(["a", "b", "c"], last, 40_000), ["a", "c"]);
  });
});

describe("wiring", () => {
  it("adds video/audio to the heartbeat entry while they are fresh", async () => {
    const manager = new RecorderManager({
      dataDir: dir,
      settings: { ffprobePath: "ffprobe" },
      ffmpegMajor: 9,
      log: silent,
    });
    manager.recorders.set("c1", {
      dir: "/b/c1",
      status: () => ({ courtId: "c1", status: "ok", message: "Recording" }),
    });
    manager.recorders.set("c2", {
      dir: "/b/c2",
      status: () => ({ courtId: "c2", status: "error", message: "x" }),
    });
    manager.media = {
      current: (d) =>
        d === "/b/c1"
          ? { video: { codec: "h264", width: 1280, height: 720, fps: 15 }, audio: null }
          : null,
    };
    assert.deepEqual(manager.statuses(), [
      {
        courtId: "c1",
        status: "ok",
        message: "Recording",
        video: { codec: "h264", width: 1280, height: 720, fps: 15 },
        audio: null,
      },
      { courtId: "c2", status: "error", message: "x" },
    ]);
  });

  it("refreshes config and heartbeat every 15 s while a preview is wanted", () => {
    const preview = { active: false };
    const sync = new DeviceSync({
      api: {},
      recorders: {},
      settings: { dataDir: dir },
      agentVersion: "1",
      log: silent,
      preview,
    });
    assert.equal(sync.interval(60), 60);
    preview.active = true;
    assert.equal(sync.interval(60), 15);
    assert.equal(sync.interval(10), 10);
  });
});
