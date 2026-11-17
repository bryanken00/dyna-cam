import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, it } from "node:test";
import { checkSignature, LiveView } from "../src/live.js";
import {
  buildRestreamArgs,
  describeRestreamFailure,
  LIVE_OFF_MESSAGE,
  maskRestreamLine,
  platformOf,
  Restreams,
  STALL_MS,
} from "../src/restream.js";
import { DeviceSync } from "../src/sync.js";

const KEY = "c".repeat(64);
const FB_KEY = "FB-123456789012345-0-AbCdEfGhIjKlMnOp";
const FB = `rtmps://live-api-s.facebook.com:443/rtmp/${FB_KEY}`;
const YT = "rtmp://a.rtmp.youtube.com/live2/abcd-efgh-ijkl-mnop";
const T = 1_794_881_000_000;
const tick = () => new Promise((resolve) => setImmediate(resolve));

/** A LiveView whose server "runs" on 8090 (no socket), with the real signing. */
function liveView(livePort = 8090) {
  const view = new LiveView({ settings: { livePort }, log: silentLog() });
  view.key = KEY;
  view.server = livePort ? { address: () => ({ port: livePort }) } : null;
  return view;
}

function silentLog() {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

/** Collects every log line, to check no stream key gets through. */
function recordingLog() {
  const lines = [];
  const at = (level) => (m, extra) => lines.push(`${level} ${m}${extra ? ` ${extra}` : ""}`);
  return { lines, debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") };
}

/** spawn() stand-in: children that only exit when told (or killed). */
function fakeSpawn() {
  const children = [];
  const impl = (bin, args) => {
    const child = new EventEmitter();
    Object.assign(child, {
      bin,
      args,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      killed: null,
      kill(signal) {
        child.killed = signal;
        setImmediate(() => child.emit("close", null, signal));
      },
      exit(code = 1) {
        child.emit("close", code, null);
      },
    });
    children.push(child);
    return child;
  };
  return { impl, children, running: () => children.filter((c) => !c.killed && !c.exited) };
}

const session = (id, over = {}) => ({
  sessionId: id,
  courtId: "court-1",
  startMs: T - 60_000,
  endMs: T + 3_600_000,
  stream: { url: FB },
  ...over,
});

/** court-1 has camera 1 (up) on this box; nothing else is recorded here. */
const oneCamera = (courtId) => (courtId === "court-1" ? [{ camera: 1, up: true }] : []);

function manager({ clock, spawn, live = liveView(), log = silentLog(), max, cameras, maxStacked }) {
  return new Restreams({
    live,
    cameras: cameras || oneCamera,
    ...(maxStacked !== undefined ? { maxStacked } : {}),
    log,
    spawnImpl: spawn.impl,
    now: () => clock.now,
    ...(max ? { max } : {}),
  });
}

/** Write `-progress` blocks to a child: each call = one block with a higher out_time. */
async function progress(child, outTimeUs) {
  child.stdout.write(`frame=${outTimeUs / 33_333}\nout_time_us=${outTimeUs}\nprogress=continue\n`);
  await tick();
}

describe("buildRestreamArgs + the box's own signed input", () => {
  it("copies the live HLS video to FLV, audio resampled to 44.1 kHz", () => {
    const args = buildRestreamArgs({ inputs: ["http://in"], outputUrl: FB });
    const after = (flag) => args[args.indexOf(flag) + 1];
    assert.equal(after("-i"), "http://in");
    assert.equal(after("-c:v"), "copy");
    assert.equal(after("-c:a"), "aac");
    assert.equal(after("-ar"), "44100");
    assert.equal(after("-f"), "flv");
    assert.equal(after("-extension_picky"), "0");
    assert.equal(after("-flvflags"), "no_duration_filesize");
    assert.equal(args.at(-1), FB);
    assert.ok(args.indexOf("-re") < args.indexOf("-i"));
    assert.ok(!args.some((a) => /libx264|h264_|-vf|-filter/.test(a)), "no video encoder or filter");
  });

  it("reads 127.0.0.1:<LIVE_PORT> with a link the live server accepts", () => {
    const url = new URL(liveView().localPlaylistUrl("court-1", 1_794_890_000));
    assert.equal(url.origin, "http://127.0.0.1:8090");
    assert.equal(url.pathname, "/live/court-1/index.m3u8");
    const exp = url.searchParams.get("exp");
    const sig = url.searchParams.get("sig");
    assert.equal(exp, "1794890000");
    assert.equal(
      checkSignature({ key: KEY, courtId: "court-1", exp, sig, nowMs: 1_794_889_000_000 }),
      "ok"
    );
    assert.equal(liveView(0).localPlaylistUrl("court-1", 1), null);
  });

  it("signs the input past the session's end", async () => {
    const clock = { now: T };
    const spawn = fakeSpawn();
    const streams = manager({ clock, spawn });
    streams.setSessions([session("s1")]);
    await streams.tick();
    const input = new URL(spawn.children[0].args[spawn.children[0].args.indexOf("-i") + 1]);
    assert.ok(Number(input.searchParams.get("exp")) * 1000 > session("s1").endMs);
  });
});

describe("masking", () => {
  it("hides the stream key, plain or in a URL, and the live-view signature", () => {
    const lines = [
      `[out#0/flv @ 0x1] [fatal] Error opening output ${FB}: Input/output error`,
      `[rtmps @ 0x2] [error] Server error: invalid key ${FB_KEY}`,
      "[hls @ 0x3] [error] Failed to open http://127.0.0.1:8090/live/c/1.ts?exp=1&sig=deadbeef01",
    ];
    for (const line of lines) {
      const masked = maskRestreamLine(line, FB);
      assert.ok(!masked.includes(FB_KEY), masked);
      assert.ok(!masked.includes("AbCdEfGh"), masked);
      assert.ok(!masked.includes("deadbeef01"), masked);
    }
    assert.match(maskRestreamLine(lines[0], FB), /facebook.com:443\/rtmp\/\*\*\*\*/);
  });

  it("keeps the key out of every log line and status message", async () => {
    const clock = { now: T };
    const spawn = fakeSpawn();
    const log = recordingLog();
    const streams = manager({ clock, spawn, log });
    streams.setSessions([session("s1")]);
    await streams.tick();
    const child = spawn.children[0];
    child.stderr.write(`[rtmps @ 0x2] [error] Server error: Publish denied ${FB_KEY}\n`);
    child.stderr.write(`[out#0/flv @ 0x1] [fatal] Error opening output ${FB}: I/O error\n`);
    await tick();
    child.exit(1);
    await tick();
    const status = streams.statuses()[0];
    assert.equal(status.status, "error");
    assert.equal(status.message, "Facebook refused the stream key");
    const everything = `${log.lines.join("\n")}\n${JSON.stringify(streams.statuses())}`;
    assert.ok(!everything.includes(FB_KEY));
    assert.ok(!everything.includes("AbCdEfGh"));
    assert.match(everything, /\*\*\*\*MnOp/);
  });
});

describe("describeRestreamFailure", () => {
  const cases = [
    // What ffmpeg 9 prints (captured), masked
    [
      [
        "[rtmps] Cannot open connection tls://live-api-s.facebook.com:443",
        "[out#0/flv] Error opening output rtmps://live-api-s.facebook.com:443/rtmp/****MnOp: Input/output error",
        "Error opening output files: Input/output error",
      ],
      FB,
      "Can't reach facebook.com",
    ],
    [
      [
        "[tcp] Connection to tcp://127.0.0.1:8090 failed: Connection refused",
        "[in#0] Error opening input: Connection refused",
        "Error opening input files: Connection refused",
      ],
      FB,
      "No video from the camera yet",
    ],
    [
      [
        "[http] HTTP error 404 Not Found",
        "[in#0] Error opening input: Server returned 404 Not Found",
      ],
      YT,
      "No video from the camera yet",
    ],
    [
      ["[http] HTTP error 403 Forbidden"],
      FB,
      "The box refused its own live-view link — restarting",
    ],
    [["[rtmp] Server error: Authentication failed"], YT, "YouTube refused the stream key"],
    [["[rtmps] NetStream.Publish.BadName"], FB, "Facebook refused the stream key"],
    [
      ["[tls] TLS handshake failed: certificate verify failed"],
      FB,
      "Secure connection to facebook.com failed",
    ],
    [["[rtmp] Connection timed out"], YT, "Can't reach youtube.com"],
    [
      ["[out#0/flv] Error muxing a packet", "[rtmp] Broken pipe"],
      YT,
      "Connection to youtube.com dropped",
    ],
    [
      ["[rtmp] Cannot open connection tcp://live.example.net:1935"],
      "rtmp://live.example.net/app/k3y",
      "Can't reach live.example.net",
    ],
    [["[flv] something odd"], YT, "Stream error: something odd"],
    [[], FB, "Stream to Facebook stopped"],
  ];
  for (const [lines, url, expected] of cases) {
    it(`"${lines.at(-1) ?? "(nothing)"}" → ${expected}`, () => {
      assert.equal(describeRestreamFailure(lines, url), expected);
    });
  }

  it("names the platform from the address", () => {
    assert.deepEqual(platformOf(FB), { name: "Facebook", site: "facebook.com" });
    assert.deepEqual(platformOf(YT), { name: "YouTube", site: "youtube.com" });
    assert.equal(platformOf("rtmp://ingest.twitch.tv/app/x").name, "ingest.twitch.tv");
  });
});

describe("Restreams (player streams): when to run", () => {
  let clock;
  let spawn;
  let streams;
  beforeEach(() => {
    clock = { now: T };
    spawn = fakeSpawn();
    streams = manager({ clock, spawn });
  });
  afterEach(() => streams.stopAll());

  it("runs only inside the session window, and only for courts this box records", async () => {
    streams.setSessions([
      session("future", { startMs: T + 60_000 }),
      session("over", { endMs: T - 1 }),
      session("other-box", { courtId: "court-9" }),
      session("no-stream", { stream: null }),
      session("now"),
    ]);
    await streams.tick();
    assert.equal(spawn.children.length, 1);
    assert.deepEqual(
      streams.statuses().map((s) => [s.sessionId, s.status]),
      [["now", "starting"]]
    );
    clock.now = T + 60_000;
    await streams.tick();
    assert.equal(spawn.children.length, 2, "the future session starts at its start");
  });

  it("stops when the stream is removed, the session leaves config, or its window ends", async () => {
    streams.setSessions([session("a"), session("b"), session("c", { endMs: T + 10_000 })]);
    await streams.tick();
    assert.equal(spawn.children.length, 3);
    streams.setSessions([session("a", { stream: null }), session("c", { endMs: T + 10_000 })]);
    await streams.tick();
    assert.equal(spawn.children[0].killed, "SIGTERM");
    assert.equal(spawn.children[1].killed, "SIGTERM");
    assert.equal(spawn.children[2].killed, null);
    clock.now = T + 10_000;
    await streams.tick();
    assert.equal(spawn.children[2].killed, "SIGTERM");
    assert.deepEqual(streams.statuses(), []);
    assert.equal(spawn.children.length, 3, "nothing restarted");
  });

  it("restarts on a new address, never on an unchanged config", async () => {
    streams.setSessions([session("a")]);
    await streams.tick();
    streams.setSessions([session("a", { endMs: T + 7_200_000 })]);
    await streams.tick();
    assert.equal(spawn.children.length, 1);
    streams.setSessions([session("a", { stream: { url: YT } })]);
    await streams.tick();
    assert.equal(spawn.children[0].killed, "SIGTERM");
    assert.equal(spawn.children.length, 2);
    assert.equal(spawn.children[1].args.at(-1), YT);
  });

  it("retries with backoff 5 s → 10 s → … capped at 60 s", async () => {
    streams.setSessions([session("a")]);
    await streams.tick();
    const waits = [];
    for (let i = 0; i < 6; i += 1) {
      spawn.children.at(-1).exit(1);
      await tick();
      const exitedAt = clock.now;
      const before = spawn.children.length;
      while (spawn.children.length === before) {
        clock.now += 1000;
        await streams.tick();
      }
      waits.push((clock.now - exitedAt) / 1000);
      assert.equal(streams.statuses()[0].status, "error");
    }
    assert.deepEqual(waits, [5, 10, 20, 40, 60, 60]);
  });

  it("re-signs before the input link expires, without counting a failure", async () => {
    streams.setSessions([session("a", { endMs: T + 60_000 })]);
    await streams.tick();
    // The session was extended past the link's expiry (end + 10 min)
    streams.setSessions([session("a", { endMs: T + 3 * 3_600_000 })]);
    clock.now = T + 60_000 + 600_000 - 59_000;
    await streams.tick();
    assert.equal(spawn.children[0].killed, "SIGTERM");
    await tick();
    await streams.tick();
    assert.equal(spawn.children.length, 2);
    const input = new URL(spawn.children[1].args[spawn.children[1].args.indexOf("-i") + 1]);
    assert.ok(Number(input.searchParams.get("exp")) * 1000 > T + 3 * 3_600_000);
    assert.notEqual(streams.statuses()[0].status, "error");
  });
});

describe("Restreams (player streams): status", () => {
  let clock;
  let spawn;
  let streams;
  beforeEach(() => {
    clock = { now: T };
    spawn = fakeSpawn();
    streams = manager({ clock, spawn });
  });
  afterEach(() => streams.stopAll());

  it("is starting until output has moved steadily for 5 s, then live", async () => {
    streams.setSessions([session("a")]);
    await streams.tick();
    const child = spawn.children[0];
    const status = () => streams.statuses()[0];
    assert.deepEqual(status(), {
      sessionId: "a",
      status: "starting",
      message: "Connecting to Facebook",
    });
    for (let s = 0; s <= 4; s += 1) {
      clock.now = T + s * 1000;
      await progress(child, s * 1_000_000);
      await streams.tick();
      assert.equal(status().status, "starting", `at ${s}s`);
    }
    // A 4 s pause starts the steady run over
    clock.now = T + 9000;
    await progress(child, 5_000_000);
    await streams.tick();
    assert.equal(status().status, "starting");
    for (let s = 10; s <= 15; s += 1) {
      clock.now = T + s * 1000;
      await progress(child, s * 1_000_000);
      await streams.tick();
    }
    assert.deepEqual(status(), { sessionId: "a", status: "live", message: "Live on Facebook" });
  });

  it("ignores progress blocks that don't move (stuck input)", async () => {
    streams.setSessions([session("a")]);
    await streams.tick();
    const child = spawn.children[0];
    for (let s = 0; s <= 8; s += 1) {
      clock.now = T + s * 1000;
      await progress(child, 1_000_000);
      await streams.tick();
    }
    assert.equal(streams.statuses()[0].status, "starting");
  });

  it("kills a run with no output for 30 s and says why", async () => {
    streams.setSessions([session("a")]);
    await streams.tick();
    clock.now = T + STALL_MS;
    await streams.tick();
    assert.equal(spawn.children[0].killed, "SIGKILL");
    await tick();
    assert.deepEqual(streams.statuses()[0], {
      sessionId: "a",
      status: "error",
      message: "No video from the camera yet",
    });
  });

  it("is error with a clear message when LIVE_PORT=0, and starts nothing", async () => {
    const off = manager({ clock, spawn, live: liveView(0) });
    off.setSessions([session("a")]);
    await off.tick();
    assert.equal(spawn.children.length, 0);
    assert.deepEqual(off.statuses(), [
      { sessionId: "a", status: "error", message: LIVE_OFF_MESSAGE },
    ]);
    assert.equal(LIVE_OFF_MESSAGE, "Live view is off on this box (LIVE_PORT=0)");
  });

  it("is error when the live server isn't running (port taken)", async () => {
    const view = liveView();
    view.server = null;
    const down = manager({ clock, spawn, live: view });
    down.setSessions([session("a")]);
    await down.tick();
    assert.equal(spawn.children.length, 0);
    assert.equal(down.statuses()[0].status, "error");
    assert.match(down.statuses()[0].message, /Live view isn't running/);
  });

  it("caps the number of streams and logs it once", async () => {
    const log = recordingLog();
    const capped = manager({ clock, spawn, log, max: 2 });
    capped.setSessions([
      session("c", { startMs: T - 1000 }),
      session("a", { startMs: T - 3000 }),
      session("b", { startMs: T - 2000 }),
    ]);
    await capped.tick();
    await capped.tick();
    assert.equal(spawn.children.length, 2);
    assert.deepEqual(
      capped.statuses().map((s) => [s.sessionId, s.status]),
      [
        ["c", "error"],
        ["a", "starting"],
        ["b", "starting"],
      ]
    );
    assert.match(capped.statuses()[0].message, /at most 2/);
    assert.equal(log.lines.filter((l) => /player stream not started.*at most 2/.test(l)).length, 1);
    await capped.stopAll();
  });

  it("refuses an address that isn't rtmp(s)://", async () => {
    streams.setSessions([session("a", { stream: { url: "http://example.com/live" } })]);
    await streams.tick();
    assert.equal(spawn.children.length, 0);
    assert.match(streams.statuses()[0].message, /rtmp:\/\/ or rtmps:\/\//);
  });
});

describe("heartbeat + config", () => {
  let dir;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-restream-"));
  });
  afterEach(() => fs.rm(dir, { recursive: true, force: true }));

  const sync = (sessionStreams, api) =>
    new DeviceSync({
      api,
      recorders: { statuses: () => [], setSessions() {}, sync: async () => {} },
      settings: { dataDir: dir },
      agentVersion: "1.0.0",
      log: silentLog(),
      streams: sessionStreams,
    });

  it("sends sessionStreams: one entry per due stream, [] when none", async () => {
    const sent = [];
    const api = { heartbeat: async (p) => sent.push(p) };
    const clock = { now: T };
    const streams = manager({ clock, spawn: fakeSpawn() });
    await sync(streams, api).heartbeat();
    streams.setSessions([session("a")]);
    await streams.tick();
    await sync(streams, api).heartbeat();
    await sync(null, api).heartbeat();
    await streams.stopAll();
    assert.deepEqual(
      sent.map((p) => p.sessionStreams),
      [[], [{ sessionId: "a", status: "starting", message: "Connecting to Facebook" }], []]
    );
  });

  it("feeds config sessions to the streams but never caches a stream key", async () => {
    const streams = manager({ clock: { now: T }, spawn: fakeSpawn() });
    const config = {
      device: {},
      venue: { name: "V" },
      courts: [],
      sessions: [session("a")],
      clip: {},
    };
    const s = sync(streams, { getConfig: async () => config });
    s.updateLogo = async () => {};
    await s.refresh();
    assert.equal(streams.sessions.length, 1);
    const cached = await fs.readFile(path.join(dir, "config.json"), "utf8");
    assert.ok(!cached.includes(FB_KEY));
    assert.equal(JSON.parse(cached).sessions[0].sessionId, "a");
    // A cached config (API down) starts no player stream
    await s.apply(JSON.parse(cached), { fromCache: true });
    assert.equal(streams.sessions.length, 0);
    assert.equal(s.interval(60), 60);
    await s.apply(config);
    assert.equal(s.interval(60), 15, "config and heartbeat every 15 s while a stream is due");
  });
});
