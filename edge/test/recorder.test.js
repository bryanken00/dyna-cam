import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseFfmpegMajor } from "../src/ffmpeg.js";
import { buildRecordArgs, describeFailure } from "../src/recorder.js";

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
    assert.equal(after("-segment_list"), "/data/buffer/court-1/segments.csv");
    assert.equal(after("-segment_list_type"), "csv");
    assert.equal(args.at(-1), "/data/buffer/court-1/%s.ts");
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
