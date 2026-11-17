import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { buildRecordArgs, CourtRecorder, RecorderManager } from "../src/recorder.js";
import {
  classifyStreamLine,
  describeStreamFailure,
  escapeTeeFilename,
  escapeTeeOption,
  maskStreamKey,
  maskStreamUrl,
  parseLogLine,
  streamRestartAllowed,
  streamSecret,
  streamSlave,
} from "../src/stream.js";
import { maskCredentials } from "../src/util.js";

const YT = "rtmp://a.rtmp.youtube.com/live2/abcd-efgh-ijkl-mnop";
const FB = "rtmps://live-api-s.facebook.com:443/rtmp/FB-1234567890-0-AbCdEfGh?s_bl=1&s_sc=99";
const silent = { debug() {}, info() {}, warn() {}, error() {} };

describe("tee escaping", () => {
  it("escapes file names once and option values twice", () => {
    assert.equal(escapeTeeFilename("/data/a|b's\\x.ts"), "/data/a\\|b\\'s\\\\x.ts");
    assert.equal(escapeTeeOption("/data/x:y]z"), "/data/x\\\\:y\\\\]z");
    assert.equal(escapeTeeOption("a=1:b=2"), "a=1\\\\:b=2");
  });

  it("puts the RTMP output in a fifo that drops packets and reconnects, and never fails the recording", () => {
    const slave = streamSlave(YT);
    assert.ok(
      slave.startsWith(
        "[f=flv:onfail=ignore:use_fifo=1:fifo_options=drop_pkts_on_overflow=1\\\\:attempt_recovery=1"
      )
    );
    assert.ok(slave.includes("recovery_wait_time=10"));
    assert.ok(slave.endsWith(`:flvflags=no_duration_filesize]${YT}`));
  });
});

describe("buildRecordArgs with a stream", () => {
  const args = buildRecordArgs({
    rtspUrl: "rtsp://cam:pw@192.168.1.50:554/stream1",
    outDir: "/data/buffer/court 1",
    segmentSeconds: 2,
    streamUrl: YT,
  });
  const after = (flag) => args[args.indexOf(flag) + 1];

  it("uses ONE camera connection and a tee with the segment output plus RTMP", () => {
    assert.equal(args.filter((a) => a === "-i").length, 1);
    assert.equal(after("-c:v"), "copy");
    assert.equal(after("-c:a"), "aac");
    assert.equal(after("-ar"), "44100");
    assert.equal(after("-flags"), "+global_header");
    assert.equal(after("-f"), "tee");
    const [segment, stream] = args.at(-1).split(/(?<!\\)\|/);
    assert.equal(
      segment,
      "[f=segment:segment_time=2:segment_format=mpegts:segment_list=/data/buffer/court 1/segments.csv:" +
        "segment_list_type=csv:segment_list_size=100:reset_timestamps=1:strftime=1]/data/buffer/court 1/%s.ts"
    );
    assert.equal(stream, streamSlave(YT));
  });

  it("is the plain segment muxer without a stream", () => {
    const plain = buildRecordArgs({ rtspUrl: "rtsp://x/stream1", outDir: "/d", segmentSeconds: 2 });
    assert.equal(plain[plain.indexOf("-f") + 1], "segment");
    assert.ok(
      !plain.includes("tee") && !plain.includes("-ar") && !plain.includes("+global_header")
    );
  });
});

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

describe("reading ffmpeg's stream messages", () => {
  const read = (line) => classifyStreamLine(parseLogLine(line));

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

  it("recognises reconnects, retried failures and a closed RTMP output", () => {
    assert.deepEqual(read("[fifo @ 0x1] [info] Recovery successful"), { event: "recovered" });
    assert.deepEqual(
      read("[fifo @ 0x1] [error] Error opening rtmp://h/live/****abcd: Connection refused"),
      {
        event: "error",
        message: "Can't reach the streaming service",
      }
    );
    assert.deepEqual(read("[fifo @ 0x1] [info] Recovery failed: Connection refused"), {
      event: "error",
      message: "Can't reach the streaming service",
    });
    assert.deepEqual(
      read("[tee @ 0x1] [error] Slave muxer #1 failed: Broken pipe, continuing with 1/2 slaves."),
      {
        event: "dead",
        message: "Can't reach the streaming service",
      }
    );
    assert.equal(
      read("[rtmp @ 0x1] [error] Server error: Invalid stream key").message,
      "Stream rejected — check the stream key"
    );
    assert.equal(read("[segment @ 0x1] [info] Opening '/d/1.ts' for writing"), null);
    assert.equal(read("[fifo @ 0x1] [info] FIFO queue flushed"), null);
    assert.equal(read("[rtsp @ 0x1] [error] method DESCRIBE failed: 401 Unauthorized"), null);
  });

  it("words failures for staff", () => {
    assert.equal(
      describeStreamFailure("NetStream.Publish.BadName"),
      "Stream rejected — check the stream key"
    );
    assert.equal(describeStreamFailure("Operation timed out"), "Can't reach the streaming service");
    assert.equal(
      describeStreamFailure("Cannot open connection tcp://127.0.0.1:19350?tcp_nodelay=0"),
      "Can't reach the streaming service"
    );
    assert.match(describeStreamFailure("something odd"), /^Stream error: something odd$/);
  });
});

describe("streamRestartAllowed", () => {
  const now = 1_800_000_000_000;
  it("waits 5 min between restarts for a dead output; config changes pass 0", () => {
    assert.equal(streamRestartAllowed({ nowMs: now, lastRestartMs: now - 60_000 }), false);
    assert.equal(streamRestartAllowed({ nowMs: now, lastRestartMs: now - 300_000 }), true);
    assert.equal(streamRestartAllowed({ nowMs: now, lastRestartMs: now, minIntervalMs: 0 }), true);
  });

  it("never restarts while an uncut window reaches into the last 70 s", () => {
    const base = { nowMs: now, lastRestartMs: 0 };
    assert.equal(
      streamRestartAllowed({
        ...base,
        pendingWindows: [{ startMs: now - 60_000, endMs: now + 5000 }],
      }),
      false
    );
    assert.equal(
      streamRestartAllowed({
        ...base,
        pendingWindows: [{ startMs: now - 130_000, endMs: now - 65_000 }],
      }),
      false
    );
    assert.equal(
      streamRestartAllowed({
        ...base,
        pendingWindows: [{ startMs: now - 200_000, endMs: now - 75_000 }],
      }),
      true
    );
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

describe("recorder stream status", () => {
  let dir;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-stream-"));
  });
  after(() => fs.rm(dir, { recursive: true, force: true }));

  const settings = {
    segmentSeconds: 2,
    bufferSeconds: 180,
    recordAudio: true,
    ffmpegPath: "ffmpeg",
  };
  const court = (rtmpUrl) => ({
    courtId: "court-1",
    name: "Court 1",
    cameraRtspUrl: "rtsp://cam:pw@10.0.0.9/stream1",
    stream: rtmpUrl ? { rtmpUrl } : null,
  });
  const waitFor = async (fn) => {
    for (let i = 0; i < 100 && !fn(); i += 1) await new Promise((r) => setTimeout(r, 10));
    assert.ok(fn());
  };

  it("reports starting → error (masked, readable) → live after a reconnect, without touching the recording status", async () => {
    const { spawnImpl, children } = fakeSpawn();
    const logged = [];
    const log = { ...silent, warn: (m) => logged.push(m), info: (m) => logged.push(m) };
    const rec = new CourtRecorder({
      court: court(YT),
      dir,
      settings,
      ffmpegMajor: 9,
      log,
      spawnImpl,
    });
    rec.start();
    await waitFor(() => children.length === 1);
    assert.equal(rec.status().streamStatus, "starting");
    children[0].stderr.emit(
      "data",
      `[fifo @ 0x1] [error] Error opening ${YT}: Connection refused\n`
    );
    assert.deepEqual(
      { s: rec.status().streamStatus, m: rec.status().streamMessage },
      { s: "error", m: "Can't reach the streaming service" }
    );
    assert.equal(rec.lastStderr, "", "stream errors are not recording errors");
    children[0].stderr.emit("data", "[fifo @ 0x1] [info] Recovery successful\n");
    assert.equal(rec.status().streamStatus, "live");
    assert.ok(logged.every((m) => !m.includes("abcd-efgh-ijkl")));
    await rec.stop();
  });

  it("is 'off' without a stream and flags a closed RTMP output for restart", async () => {
    const { spawnImpl, children } = fakeSpawn();
    const off = new CourtRecorder({
      court: court(null),
      dir,
      settings,
      ffmpegMajor: 9,
      log: silent,
      spawnImpl,
    });
    assert.equal(off.status().streamStatus, "off");
    const rec = new CourtRecorder({
      court: court(YT),
      dir,
      settings,
      ffmpegMajor: 9,
      log: silent,
      spawnImpl,
    });
    rec.start();
    await waitFor(() => children.length === 1);
    children[0].stderr.emit(
      "data",
      "[tee @ 0x1] [error] Slave muxer #1 failed: Broken pipe, continuing with 1/2 slaves.\n"
    );
    assert.equal(rec.streamDead, true);
    await rec.stop();
  });

  it("restarts a recorder for a stream change only when no uncut window is in the last 70 s", async () => {
    const { spawnImpl, children } = fakeSpawn();
    const manager = new RecorderManager({
      dataDir: dir,
      settings,
      ffmpegMajor: 9,
      log: silent,
      spawnImpl,
    });
    await manager.sync([court(null)]);
    await waitFor(() => children.length === 1);
    assert.ok(!children[0].args.includes("tee"));

    let pending = [{ startMs: Date.now() - 60_000, endMs: Date.now() + 5000 }];
    manager.pendingWindows = () => pending;
    await manager.sync([court(YT)]); // stream turned on
    await manager.applyStreamRestarts();
    assert.equal(children.length, 1, "a clip window is still open — no restart");

    pending = [];
    await manager.applyStreamRestarts();
    await waitFor(() => children.length === 2);
    assert.ok(children[1].args.includes("tee"));
    assert.equal(manager.statuses()[0].streamStatus, "starting");
    await manager.stopAll();
  });
});

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
    stream: null,
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
