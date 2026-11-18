import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildClipArgs,
  buildConcatList,
  buildThumbnailArgs,
  clipWindow,
  coverageReason,
  encoderSettings,
  isWindowClosed,
  logoLayout,
  outputSize,
  QUALITY,
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

  it("caps the bitrate: clips ≲ 20 MB per 65 s", () => {
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
    for (const encoder of ["h264_qsv", "h264_vaapi", "h264_videotoolbox"]) {
      assert.deepEqual(
        flags(buildClipArgs({ ...common, logoPath: null, encoder })),
        {
          "-crf": undefined,
          "-b:v": "2000k",
          "-maxrate": "2300k",
          "-bufsize": "4600k",
          "-b:a": "96k",
        },
        encoder
      );
    }
    // worst case size at the cap (video + audio)
    assert.ok(((2300 + 96) * 65) / 8 / 1000 <= 20);
    // Game videos are copied, never encoded: no session quality any more
    assert.deepEqual(Object.keys(QUALITY).sort(), ["clip", "clipStacked", "stream"]);
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
