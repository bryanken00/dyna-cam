import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { CourtRecorder, RecorderManager } from "../src/recorder.js";
import { maskStreamKey, maskStreamUrl, parseLogLine, streamSecret } from "../src/stream.js";
import { maskCredentials } from "../src/util.js";

const YT = "rtmp://a.rtmp.youtube.com/live2/abcd-efgh-ijkl-mnop";
const FB = "rtmps://live-api-s.facebook.com:443/rtmp/FB-1234567890-0-AbCdEfGh?s_bl=1&s_sc=99";
const silent = { debug() {}, info() {}, warn() {}, error() {} };

describe("stream key masking", () => {
  it("shows at most the last 4 characters of the key", () => {
    assert.equal(streamSecret(YT), "abcd-efgh-ijkl-mnop");
    assert.equal(maskStreamUrl(YT), "rtmp://a.rtmp.youtube.com/live2/****mnop");
    assert.equal(maskStreamUrl(FB), "rtmps://live-api-s.facebook.com:443/rtmp/****EfGh");
    assert.equal(maskStreamUrl("rtmp://host/onlykey1234"), "rtmp://host/****1234");
  });

  it("masks the key in ffmpeg lines, also through the generic log masking", () => {
    const line = `[fifo @ 0x1] [error] Error opening ${YT}: Connection refused`;
    const masked = maskStreamKey(line, YT);
    assert.doesNotMatch(masked, /abcd-efgh-ijkl/);
    assert.match(masked, /\*\*\*\*mnop/);
    assert.doesNotMatch(maskCredentials(line), /abcd-efgh-ijkl/);
    assert.doesNotMatch(maskCredentials(`opening ${FB} failed`), /1234567890|s_sc=99/);
    assert.equal(
      maskStreamKey("the key abcd-efgh-ijkl-mnop leaked", YT),
      "the key ****mnop leaked"
    );
  });
});

describe("reading ffmpeg's log lines", () => {
  it("parses component and level", () => {
    assert.deepEqual(parseLogLine("[fifo @ 0x74ad01a300] [info] Recovery successful"), {
      component: "fifo",
      level: "info",
      text: "Recovery successful",
    });
    assert.deepEqual(parseLogLine("[error] Error opening input files: Connection refused"), {
      component: null,
      level: "error",
      text: "Error opening input files: Connection refused",
    });
  });
});

/** A spawn() stand-in: records args, lets the test feed stderr, exits on kill. */
function fakeSpawn() {
  const children = [];
  const spawnImpl = (_bin, args) => {
    const child = new EventEmitter();
    child.args = args;
    child.pid = 0;
    child.stderr = new EventEmitter();
    child.kill = () => setImmediate(() => child.emit("close", null, "SIGTERM"));
    children.push(child);
    return child;
  };
  return { spawnImpl, children };
}

describe("cameraVersion in the heartbeat", () => {
  let dir;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-camver-"));
  });
  after(() => fs.rm(dir, { recursive: true, force: true }));

  const settings = {
    segmentSeconds: 2,
    bufferSeconds: 180,
    recordAudio: true,
    ffmpegPath: "ffmpeg",
  };
  const court = (url, cameraVersion) => ({
    courtId: "court-1",
    name: "Court 1",
    cameraRtspUrl: url,
    cameraVersion,
  });
  const waitFor = async (fn) => {
    for (let i = 0; i < 100 && !fn(); i += 1) await new Promise((r) => setTimeout(r, 10));
    assert.ok(fn());
  };

  it("reports the version the running recorder was started with, switching only when it restarts on the new address", async () => {
    const { spawnImpl, children } = fakeSpawn();
    const manager = new RecorderManager({
      dataDir: dir,
      settings: { ...settings, ffprobePath: "ffprobe" },
      ffmpegMajor: 9,
      log: silent,
      spawnImpl,
    });
    await manager.sync([court("rtsp://cam:pw@10.0.0.9/stream1", "aaaaaaaaaaaa")]);
    await waitFor(() => children.length === 1);
    assert.equal(manager.statuses()[0].cameraVersion, "aaaaaaaaaaaa");

    // The same address saved again: no restart needed, this recorder already runs with it
    await manager.sync([court("rtsp://cam:pw@10.0.0.9/stream1", "bbbbbbbbbbbb")]);
    assert.equal(children.length, 1);
    assert.equal(manager.statuses()[0].cameraVersion, "bbbbbbbbbbbb");

    // A new address: the old recorder never reports the new version; the restarted one does
    const old = manager.recorders.get("court-1");
    await manager.sync([court("rtsp://cam:pw@10.0.0.10/stream1", "cccccccccccc")]);
    assert.equal(old.status().cameraVersion, "bbbbbbbbbbbb");
    await waitFor(() => children.length === 2);
    assert.ok(children[1].args.includes("rtsp://cam:pw@10.0.0.10/stream1"));
    assert.equal(manager.statuses()[0].cameraVersion, "cccccccccccc");
    await manager.stopAll();
  });

  it("leaves out camera details read from the previous address's segments", async () => {
    const { spawnImpl } = fakeSpawn();
    const manager = new RecorderManager({
      dataDir: dir,
      settings: { ...settings, ffprobePath: "ffprobe" },
      ffmpegMajor: 9,
      log: silent,
      spawnImpl,
    });
    await manager.sync([court("rtsp://cam:pw@10.0.0.9/stream1", "dddddddddddd")]);
    const recorder = manager.recorders.get("court-1");
    const video = { codec: "h264", width: 1280, height: 720, fps: 15 };
    manager.media = {
      current: () => ({ video, audio: null, segmentAtMs: recorder.createdAt - 1000 }),
    };
    assert.equal(manager.statuses()[0].video, undefined);
    manager.media = {
      current: () => ({ video, audio: null, segmentAtMs: recorder.createdAt + 1000 }),
    };
    assert.deepEqual(manager.statuses()[0].video, video);
    await manager.stopAll();
  });

  it("omits cameraVersion when the API sends none", () => {
    const rec = new CourtRecorder({
      court: court("rtsp://x/stream1", undefined),
      dir,
      settings,
      ffmpegMajor: 9,
      log: silent,
    });
    assert.equal("cameraVersion" in rec.status(), false);
  });
});
