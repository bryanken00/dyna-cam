import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseFfmpegMajor } from "../src/ffmpeg.js";
import os from "node:os";
import path from "node:path";
import {
  buildRecordArgs,
  CourtRecorder,
  describeFailure,
  nextSegmentNumber,
} from "../src/recorder.js";

const URL = "rtsp://camuser:s3cret@192.168.1.50:554/stream1";

describe("buildRecordArgs", () => {
  const args = buildRecordArgs({ rtspUrl: URL, outDir: "/data/buffer/court-1", segmentSeconds: 2 });
  const after = (flag) => args[args.indexOf(flag) + 1];

  it("stream-copies the video and transcodes the audio to AAC (Tapo sends pcm_alaw)", () => {
    assert.equal(after("-c:v"), "copy");
    assert.equal(after("-c:a"), "aac");
    assert.equal(after("-b:a"), "64k");
    const maps = args.flatMap((a, i) => (a === "-map" ? [args[i + 1]] : []));
    assert.deepEqual(maps, ["0:v:0", "0:a?"]);
    assert.ok(!args.includes("-c"), "never a blanket -c copy");
  });

  it("pulls RTSP over TCP with a socket timeout, keeping the camera's own timestamps", () => {
    assert.equal(after("-rtsp_transport"), "tcp");
    assert.equal(after("-timeout"), "10000000");
    assert.ok(args.indexOf("-timeout") < args.indexOf("-i"));
    // wall-clock stamping clumps frames that arrive together → choppy clips
    assert.ok(!args.includes("-use_wallclock_as_timestamps"));
    assert.equal(after("-i"), URL);
  });

  it("writes epoch-named segments plus a CSV segment list", () => {
    assert.equal(after("-f"), "segment");
    assert.equal(after("-segment_time"), "2");
    assert.equal(after("-reset_timestamps"), "1");
    assert.equal(after("-strftime"), "1");
    assert.equal(after("-segment_list"), path.join("/data/buffer/court-1", "segments.csv"));
    assert.equal(after("-segment_list_type"), "csv");
    assert.equal(args.at(-1), path.join("/data/buffer/court-1", "%s.ts"));
  });

  it("names segments by counter from startNumber where strftime has no %s (BUG-004, Windows)", () => {
    const win = buildRecordArgs({
      rtspUrl: URL,
      outDir: "/data/buffer/court-1",
      segmentSeconds: 2,
      startNumber: 1795162249,
    });
    const at = (flag) => win[win.indexOf(flag) + 1];
    assert.equal(at("-segment_start_number"), "1795162249");
    assert.ok(!win.includes("-strftime"));
    assert.equal(win.at(-1), path.join("/data/buffer/court-1", "%d.ts"));
    assert.equal(at("-segment_list"), path.join("/data/buffer/court-1", "segments.csv"));
  });

  it("uses -stimeout on ffmpeg 4 (where -timeout means listen) and -an without audio", () => {
    const old = buildRecordArgs({
      rtspUrl: URL,
      outDir: "/d",
      segmentSeconds: 2,
      ffmpegMajor: 4,
      recordAudio: false,
    });
    assert.ok(old.includes("-stimeout") && !old.includes("-timeout"));
    assert.ok(old.includes("-an") && !old.includes("aac"));
  });
});

describe("nextSegmentNumber (BUG-004)", () => {
  const now = 1_795_162_249_500;
  it("starts at the current epoch second in an empty folder", () => {
    assert.equal(nextSegmentNumber([], now), 1795162249);
    assert.equal(nextSegmentNumber(["segments.csv", "run.json"], now), 1795162249);
  });

  it("starts one past the newest segment when a counter run got ahead of the clock", () => {
    const names = ["1795162250.ts", "1795162251.ts", "index.json", "1795162100.ts"];
    assert.equal(nextSegmentNumber(names, now), 1795162252);
  });

  it("never goes below the clock because of old files", () => {
    assert.equal(nextSegmentNumber(["1795160000.ts"], now), 1795162249);
  });
});

describe("CourtRecorder segment naming", () => {
  const make = (strftimeEpoch) => {
    const spawned = [];
    const rec = new CourtRecorder({
      court: { courtId: "court-1", name: "Court 1", cameraRtspUrl: URL },
      dir: path.join(os.tmpdir(), `dc-naming-${process.pid}-${strftimeEpoch}`),
      settings: { segmentSeconds: 2, recordAudio: true, ffmpegPath: "ffmpeg", bufferSeconds: 180 },
      ffmpegMajor: 9,
      log: { info() {}, warn() {}, error() {}, debug() {} },
      strftimeEpoch,
      spawnImpl: (bin, args) => {
        spawned.push(args);
        return { pid: 0, stderr: null, on() {} };
      },
    });
    rec.spawn();
    rec.stopping = true;
    return spawned[0];
  };

  it("uses strftime %s where the C runtime has it", () => {
    const args = make(true);
    assert.ok(args.includes("-strftime") && args.at(-1).endsWith("%s.ts"));
  });

  it("uses the counter on Windows", () => {
    const args = make(false);
    const start = Number(args[args.indexOf("-segment_start_number") + 1]);
    assert.ok(Math.abs(start - Date.now() / 1000) < 5);
    assert.ok(args.at(-1).endsWith("%d.ts") && !args.includes("-strftime"));
  });
});

describe("describeFailure", () => {
  it("turns ffmpeg errors into something staff can act on, without the password", () => {
    const timedOut = describeFailure(
      `Error opening input file ${URL}. Error opening input files: Operation timed out`
    );
    assert.match(timedOut, /^Camera not reachable — check Wi-Fi\/power/);
    assert.doesNotMatch(timedOut, /s3cret/);
    assert.match(describeFailure("Error opening input files: Connection refused"), /not reachable/);
    assert.match(describeFailure("method DESCRIBE failed: 401 Unauthorized"), /username\/password/);
    assert.match(describeFailure("method DESCRIBE failed: 404 Not Found"), /stream not found/);
    assert.match(describeFailure(""), /stopped unexpectedly/);
    assert.ok(describeFailure("x".repeat(400)).length <= 255);
  });
});

describe("parseFfmpegMajor", () => {
  it("reads release, distro and git builds", () => {
    assert.equal(parseFfmpegMajor("ffmpeg version 9.0.1 Copyright"), 9);
    assert.equal(parseFfmpegMajor("ffmpeg version 6.1.1-3ubuntu5 Copyright"), 6);
    assert.equal(parseFfmpegMajor("ffmpeg version 4.4.2-0ubuntu0.22.04.1"), 4);
    assert.equal(parseFfmpegMajor("ffmpeg version N-112233-gabcdef"), 99);
    assert.equal(parseFfmpegMajor("nope"), null);
  });
});
