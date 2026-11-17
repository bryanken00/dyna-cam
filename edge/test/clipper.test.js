import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildClipArgs,
  buildConcatList,
  buildThumbnailArgs,
  clipWindow,
  coverageReason,
  encoderSettings,
  isSessionPart,
  isWindowClosed,
  logoLayout,
  outputSize,
  partFailureReason,
  selectPartSegments,
  selectSegments,
} from "../src/clipper.js";

const T0 = 1_794_881_000_000;

/** Back-to-back segments with the given lengths (s), starting at T0 + startSec. */
function timeline(lengths, { startSec = 0, gapAfter = {} } = {}) {
  let t = T0 + startSec * 1000;
  return lengths.map((len, i) => {
    const seg = {
      name: `${i}.ts`,
      path: `/buf/${i}.ts`,
      startMs: t,
      endMs: t + Math.round(len * 1000),
    };
    t = seg.endMs + 30 + (gapAfter[i] || 0) * 1000; // ~1 frame between segments
    return seg;
  });
}

// Irregular keyframe-cut lengths as seen on a Tapo C200
const IRREGULAR = [2.1, 2.05, 2.1, 6.1, 2.2, 1.7, 2.1, 2.0, 2.1, 2.05];
const repeat = (n) => Array.from({ length: n }, () => IRREGULAR).flat();

describe("clipWindow", () => {
  it("is [requestedAt − pre, requestedAt + post]", () => {
    assert.deepEqual(clipWindow({ requestedAtMs: T0 + 100_000, preSeconds: 60, postSeconds: 5 }), {
      startMs: T0 + 40_000,
      endMs: T0 + 105_000,
    });
  });
});

describe("session part window", () => {
  it("cuts exactly [windowStart, windowEnd] for a part, pre/post for a clip", () => {
    const part = {
      requestedAtMs: T0 + 300_000,
      windowStartMs: T0,
      windowEndMs: T0 + 300_000,
      preSeconds: 60,
      postSeconds: 5,
    };
    assert.equal(isSessionPart(part), true);
    assert.deepEqual(clipWindow(part), { startMs: T0, endMs: T0 + 300_000 });
    const clip = {
      requestedAtMs: T0 + 300_000,
      windowStartMs: null,
      windowEndMs: null,
      preSeconds: 60,
      postSeconds: 5,
    };
    assert.equal(isSessionPart(clip), false);
    assert.deepEqual(clipWindow(clip), { startMs: T0 + 240_000, endMs: T0 + 305_000 });
  });
});

describe("selectPartSegments", () => {
  const segs = timeline(repeat(16), { startSec: -5 }); // ~340 s from T0-5s

  it("covers a full 5-min part with irregular segments, offset from the first one's real start", () => {
    const pick = selectPartSegments(segs, T0, T0 + 300_000);
    assert.equal(pick.ok, true);
    assert.equal(pick.durationMs, 300_000);
    assert.equal(pick.offsetMs, T0 - pick.segments[0].startMs);
    assert.ok(pick.coverage > 0.98);
  });

  it("still makes a part with a 40 s hole (held frame) but not one with less than 80% footage", () => {
    const holed = timeline(repeat(16), { startSec: -5, gapAfter: { 50: 40 } });
    const pick = selectPartSegments(holed, T0, T0 + 300_000);
    assert.equal(pick.ok, true);
    assert.ok(pick.coverage > 0.8 && pick.coverage < 0.9);
    const bigHole = timeline(repeat(16), { startSec: -5, gapAfter: { 50: 120 } });
    const fail = selectPartSegments(bigHole, T0, T0 + 300_000);
    assert.equal(fail.reason, "LOW_COVERAGE");
    assert.match(
      partFailureReason(fail),
      /^Camera recorded only \d+% of this part of the session$/
    );
  });

  it("shortens a part whose footage starts late", () => {
    const late = timeline(repeat(16), { startSec: 30 });
    const pick = selectPartSegments(late, T0, T0 + 300_000);
    assert.equal(pick.ok, true);
    assert.equal(pick.offsetMs, 0);
    assert.equal(pick.durationMs, 270_000);
  });

  it("fails a part with no footage", () => {
    const pick = selectPartSegments([], T0, T0 + 300_000);
    assert.equal(pick.reason, "NO_FOOTAGE");
    assert.equal(
      partFailureReason(pick),
      "Camera was not recording during this part of the session"
    );
  });
});

describe("selectSegments", () => {
  const segs = timeline(repeat(6)); // ~150 s of video
  const ws = T0 + 30_000;
  const we = T0 + 95_000;

  it("selects every segment overlapping the window, with irregular lengths", () => {
    const pick = selectSegments(segs, ws, we);
    assert.equal(pick.ok, true);
    assert.ok(pick.segments[0].startMs <= ws && pick.segments[0].endMs > ws);
    const last = pick.segments[pick.segments.length - 1];
    assert.ok(last.startMs < we && last.endMs >= we);
    // contiguous slice of the time line
    const first = segs.indexOf(pick.segments[0]);
    assert.deepEqual(pick.segments, segs.slice(first, first + pick.segments.length));
  });

  it("measures the -ss offset from the real start of the first chosen segment", () => {
    const pick = selectSegments(segs, ws, we);
    assert.equal(pick.offsetMs, ws - pick.segments[0].startMs);
    assert.ok(pick.offsetMs >= 0 && pick.offsetMs < 6100);
  });

  it("tolerates a hole of up to ~7 s but not more", () => {
    const small = timeline(repeat(6), { gapAfter: { 20: 6 } });
    assert.equal(selectSegments(small, ws, we).ok, true);
    const big = timeline(repeat(6), { gapAfter: { 20: 9 } });
    const pick = selectSegments(big, ws, we);
    assert.equal(pick.ok, false);
    assert.equal(pick.reason, "GAP");
  });

  it("reports footage that starts too late, ends too early, or is missing", () => {
    assert.equal(
      selectSegments(timeline(repeat(6), { startSec: 40 }), ws, we).reason,
      "STARTS_LATE"
    );
    assert.equal(selectSegments(timeline(repeat(3)), ws, we).reason, "ENDS_EARLY");
    assert.equal(selectSegments([], ws, we).reason, "NO_FOOTAGE");
    assert.equal(selectSegments(timeline([2, 2]), ws, we).reason, "NO_FOOTAGE");
  });

  it("accepts a window starting within 1.5 s of the oldest frame", () => {
    assert.equal(selectSegments(timeline(repeat(6), { startSec: 31 }), ws, we).ok, true);
  });
});

describe("isWindowClosed", () => {
  it("waits until a closed segment reaches the window end", () => {
    const segs = timeline([2.1, 2.05, 6.1]); // ends at ~T0+10.3s
    assert.equal(isWindowClosed(segs, T0 + 10_000), true);
    assert.equal(isWindowClosed(segs, T0 + 11_000), false);
  });
});

describe("coverageReason", () => {
  it("separates 'too late' from 'not recording'", () => {
    const now = T0 + 400_000;
    assert.match(
      coverageReason(
        { reason: "NO_FOOTAGE" },
        { windowStartMs: T0, nowMs: now, bufferMs: 180_000 }
      ),
      /too late/
    );
    assert.equal(
      coverageReason(
        { reason: "STARTS_LATE" },
        { windowStartMs: now - 70_000, nowMs: now, bufferMs: 180_000 }
      ),
      "Camera was not recording at that time"
    );
    assert.equal(
      coverageReason(
        { reason: "GAP" },
        { windowStartMs: now - 70_000, nowMs: now, bufferMs: 180_000 }
      ),
      "Camera dropped out during that time"
    );
  });
});

describe("sizes", () => {
  it("never upscales and caps at 1080p with even dimensions", () => {
    assert.deepEqual(outputSize(1280, 720), { width: 1280, height: 720 });
    assert.deepEqual(outputSize(1920, 1080), { width: 1920, height: 1080 });
    assert.deepEqual(outputSize(3840, 2160), { width: 1920, height: 1080 });
    assert.deepEqual(outputSize(2560, 1440), { width: 1920, height: 1080 });
    assert.deepEqual(outputSize(2304, 1296), { width: 1920, height: 1080 });
    assert.deepEqual(outputSize(1281, 721), { width: 1282, height: 722 });
  });

  it("sizes the logo at ~12% of the width", () => {
    assert.deepEqual(logoLayout(1280), { logoWidth: 154, margin: 26 });
    assert.deepEqual(logoLayout(1920), { logoWidth: 230, margin: 38 });
  });
});

describe("buildClipArgs", () => {
  const common = {
    listPath: "/job/list.ffconcat",
    offsetMs: 1234,
    durationMs: 65_000,
    width: 1280,
    height: 720,
    outPath: "/job/clip.mp4",
  };

  it("trims after decoding the concat input, overlays the logo bottom-right and makes a faststart mp4", () => {
    const args = buildClipArgs({ ...common, logoPath: "/logo/logo.png", encoder: "libx264" });
    const joined = args.join(" ");
    assert.match(
      joined,
      /-f concat -safe 0 -i \/job\/list\.ffconcat -i \/logo\/logo\.png -ss 1\.234 -t 65\.000 -filter_complex/
    );
    const filter = args[args.indexOf("-filter_complex") + 1];
    assert.match(filter, /\[0:v:0\]scale=1280:720,setsar=1\[base\]/);
    assert.match(filter, /\[1:v\]scale=154:-2,format=rgba\[logo\]/);
    assert.match(filter, /overlay=x=W-w-26:y=H-h-26,format=yuv420p\[v\]/);
    assert.doesNotMatch(filter, /drawtext/);
    assert.match(joined, /-map \[v\] -map 0:a\? -c:v libx264 -preset veryfast -crf 23/);
    assert.match(joined, /-c:a aac/);
    assert.match(joined, /-movflags \+faststart -f mp4 \/job\/clip\.mp4$/);
  });

  it("caps the bitrate: clips ≲ 20 MB per 65 s, session parts ~40–50 MB per 5 min", () => {
    const flags = (args) =>
      Object.fromEntries(
        ["-crf", "-b:v", "-maxrate", "-bufsize", "-b:a"].map((f) => [
          f,
          args.includes(f) ? args[args.indexOf(f) + 1] : undefined,
        ])
      );
    const clipX264 = flags(buildClipArgs({ ...common, logoPath: null, encoder: "libx264" }));
    assert.deepEqual(clipX264, {
      "-crf": "23",
      "-b:v": undefined,
      "-maxrate": "2300k",
      "-bufsize": "4600k",
      "-b:a": "96k",
    });
    const partX264 = flags(
      buildClipArgs({ ...common, logoPath: null, encoder: "libx264", quality: "session" })
    );
    assert.deepEqual(partX264, {
      "-crf": "26",
      "-b:v": undefined,
      "-maxrate": "1200k",
      "-bufsize": "2400k",
      "-b:a": "64k",
    });
    for (const encoder of ["h264_qsv", "h264_vaapi", "h264_videotoolbox"]) {
      const part = flags(buildClipArgs({ ...common, logoPath: null, encoder, quality: "session" }));
      assert.deepEqual(
        part,
        {
          "-crf": undefined,
          "-b:v": "1000k",
          "-maxrate": "1200k",
          "-bufsize": "2400k",
          "-b:a": "64k",
        },
        encoder
      );
      assert.equal(
        flags(buildClipArgs({ ...common, logoPath: null, encoder }))["-maxrate"],
        "2300k"
      );
    }
    // worst case sizes at the cap (video + audio)
    assert.ok(((2300 + 96) * 65) / 8 / 1000 <= 20);
    assert.ok(((1200 + 64) * 300) / 8 / 1000 <= 48);
  });

  it("skips the overlay when the venue has no logo", () => {
    const args = buildClipArgs({ ...common, logoPath: null, encoder: "libx264" });
    assert.equal(args.filter((a) => a === "-i").length, 1);
    assert.equal(
      args[args.indexOf("-filter_complex") + 1],
      "[0:v:0]scale=1280:720,setsar=1,format=yuv420p[v]"
    );
  });

  it("adds what each hardware encoder needs", () => {
    const vaapi = buildClipArgs({
      ...common,
      logoPath: null,
      encoder: "h264_vaapi",
      vaapiDevice: "/dev/dri/renderD129",
    });
    assert.deepEqual(vaapi.slice(5, 7), ["-vaapi_device", "/dev/dri/renderD129"]);
    assert.match(vaapi[vaapi.indexOf("-filter_complex") + 1], /format=nv12,hwupload\[v\]$/);
    assert.equal(encoderSettings("h264_qsv").tail, "format=nv12");
    assert.ok(encoderSettings("h264_videotoolbox").codec.includes("h264_videotoolbox"));
    assert.throws(() => encoderSettings("nvenc"), /Unknown encoder/);
  });
});

describe("thumbnail and concat list", () => {
  it("grabs one JPEG frame", () => {
    const args = buildThumbnailArgs({
      videoPath: "/j/clip.mp4",
      atSeconds: 32.5,
      outPath: "/j/thumbnail.jpg",
    });
    assert.deepEqual(args.slice(5, 9), ["-ss", "32.500", "-i", "/j/clip.mp4"]);
    assert.ok(args.join(" ").includes("-frames:v 1"));
    assert.equal(args.at(-1), "/j/thumbnail.jpg");
  });

  it("places each file at its wall-clock start (gaps become held frames) and escapes quotes", () => {
    const list = buildConcatList([
      { path: "/a/1.ts", startMs: T0, endMs: T0 + 2100 },
      { path: "/it's/2.ts", startMs: T0 + 2130, endMs: T0 + 8230 },
      { path: "/a/3.ts", startMs: T0 + 12_000, endMs: T0 + 14_000 },
    ]);
    assert.equal(
      list,
      "ffconcat version 1.0\nfile '/a/1.ts'\nduration 2.130\nfile '/it'\\''s/2.ts'\nduration 9.870\nfile '/a/3.ts'\nduration 2.100\n"
    );
  });
});
