import fsp from "node:fs/promises";
import path from "node:path";
import { FfmpegError, probeFile, probeVideo, runFfmpeg } from "./ffmpeg.js";
import { loadTimeline } from "./segments.js";

/**
 * Cutting a replay out of the rolling buffer. The pure functions (window
 * math, segment selection, ffmpeg arguments) are unit-tested; cutClip() and
 * makeClip() run ffmpeg.
 */

const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1080;
const LOGO_WIDTH_RATIO = 0.12;
const LOGO_MARGIN_RATIO = 0.02;

/** A session part carries its exact window; an ordinary clip has none. */
export const isSessionPart = (entry) =>
  Number.isFinite(entry?.windowStartMs) &&
  Number.isFinite(entry?.windowEndMs) &&
  entry.windowEndMs > entry.windowStartMs;

/**
 * The window to cut in epoch ms: a session part's [windowStart, windowEnd]
 * exactly, otherwise [requestedAt − pre, requestedAt + post].
 */
export function clipWindow(entry) {
  if (isSessionPart(entry)) return { startMs: entry.windowStartMs, endMs: entry.windowEndMs };
  const { requestedAtMs, preSeconds = 60, postSeconds = 5 } = entry;
  return { startMs: requestedAtMs - preSeconds * 1000, endMs: requestedAtMs + postSeconds * 1000 };
}

/**
 * True once the window's end is inside a CLOSED segment (the time line holds
 * only closed ones), i.e. the post-window plus the segment around it is on disk.
 */
export const isWindowClosed = (timeline, windowEndMs) =>
  timeline.some((s) => s.endMs >= windowEndMs);

/**
 * The segments covering [startMs, endMs], or why the buffer does not cover it.
 * A hole of up to 7 s between segments is tolerated (a late keyframe or a
 * short Wi-Fi hiccup); the -ss offset is measured from the real start of the
 * first chosen segment.
 * → { ok: true, segments, offsetMs } | { ok: false, reason, ms }
 */
export function selectSegments(
  timeline,
  startMs,
  endMs,
  { startToleranceMs = 1500, endToleranceMs = 1500, gapToleranceMs = 7000 } = {}
) {
  const chosen = timeline.filter((s) => s.startMs < endMs && s.endMs > startMs);
  if (chosen.length === 0) return { ok: false, reason: "NO_FOOTAGE", ms: endMs - startMs };
  if (chosen[0].startMs > startMs + startToleranceMs) {
    return { ok: false, reason: "STARTS_LATE", ms: chosen[0].startMs - startMs };
  }
  for (let i = 1; i < chosen.length; i += 1) {
    const gap = chosen[i].startMs - chosen[i - 1].endMs;
    if (gap > gapToleranceMs) return { ok: false, reason: "GAP", ms: gap };
  }
  const last = chosen[chosen.length - 1];
  if (last.endMs < endMs - endToleranceMs) {
    return { ok: false, reason: "ENDS_EARLY", ms: endMs - last.endMs };
  }
  return { ok: true, segments: chosen, offsetMs: Math.max(0, startMs - chosen[0].startMs) };
}

/** The reason sent to POST /clips/:id/fail (shown to staff) for a selection that failed. */
export function coverageReason(selection, { windowStartMs, nowMs, bufferMs }) {
  const overwritten = windowStartMs < nowMs - bufferMs;
  if (overwritten && ["NO_FOOTAGE", "STARTS_LATE"].includes(selection.reason)) {
    return "The request reached the recorder box too late — that video was already overwritten";
  }
  if (selection.reason === "GAP") return "Camera dropped out during that time";
  return "Camera was not recording at that time";
}

/** Share of a session part that must be on disk for the part to be made. */
export const PART_MIN_COVERAGE = 0.8;

/**
 * Segments for a session part. Unlike a 65 s clip, a 5-min part is still
 * worth having with holes in it: it is made when at least 80% of the window
 * was recorded. Holes inside become held frames (wall-clock concat), and
 * footage that starts late or stops early just makes the part shorter.
 * → { ok: true, segments, offsetMs, durationMs, coverage } | { ok: false, reason, coverage }
 */
export function selectPartSegments(
  timeline,
  startMs,
  endMs,
  { minCoverage = PART_MIN_COVERAGE } = {}
) {
  const chosen = timeline.filter((s) => s.startMs < endMs && s.endMs > startMs);
  const covered = chosen.reduce(
    (sum, s) => sum + Math.max(0, Math.min(s.endMs, endMs) - Math.max(s.startMs, startMs)),
    0
  );
  const coverage = covered / (endMs - startMs);
  if (chosen.length === 0) return { ok: false, reason: "NO_FOOTAGE", coverage: 0 };
  if (coverage < minCoverage) return { ok: false, reason: "LOW_COVERAGE", coverage };
  const cutStart = Math.max(startMs, chosen[0].startMs);
  const cutEnd = Math.min(endMs, chosen[chosen.length - 1].endMs);
  return {
    ok: true,
    segments: chosen,
    offsetMs: cutStart - chosen[0].startMs,
    durationMs: cutEnd - cutStart,
    coverage,
  };
}

/** The fail reason for a session part the buffer does not cover. */
export const partFailureReason = (selection) =>
  selection.reason === "NO_FOOTAGE"
    ? "Camera was not recording during this part of the session"
    : `Camera recorded only ${Math.round(selection.coverage * 100)}% of this part of the session`;

const even = (value) => Math.max(2, Math.round(value / 2) * 2);

/** Output size: the camera's size, scaled down to fit 1920×1080, even numbers. */
export function outputSize(width, height) {
  const scale = Math.min(1, MAX_WIDTH / width, MAX_HEIGHT / height);
  return { width: even(width * scale), height: even(height * scale) };
}

/** Watermark: ~12% of the video width, bottom-right, small margin. */
export const logoLayout = (videoWidth) => ({
  logoWidth: even(videoWidth * LOGO_WIDTH_RATIO),
  margin: Math.max(8, Math.round(videoWidth * LOGO_MARGIN_RATIO)),
});

/**
 * Bitrate caps per kind of output. A 65 s clip stays ≲ 20 MB and a 5-min
 * session part ~40–50 MB (the C200 gave 13–24 MB per 65 s uncapped).
 */
export const QUALITY = {
  clip: { crf: "23", bitrate: "2000k", maxrate: "2300k", bufsize: "4600k", audio: "96k" },
  session: { crf: "26", bitrate: "1000k", maxrate: "1200k", bufsize: "2400k", audio: "64k" },
};

/** Per-encoder input options, last filter step and codec options. */
export function encoderSettings(
  encoder,
  { vaapiDevice = "/dev/dri/renderD128", quality = "clip" } = {}
) {
  const q = QUALITY[quality];
  if (!q) throw new Error(`Unknown quality "${quality}"`);
  const cap = ["-maxrate", q.maxrate, "-bufsize", q.bufsize];
  const rate = ["-b:v", q.bitrate, ...cap];
  switch (encoder) {
    case "h264_qsv":
      return {
        input: [],
        tail: "format=nv12",
        codec: ["-c:v", "h264_qsv", "-preset", "veryfast", ...rate, "-profile:v", "high"],
      };
    case "h264_vaapi":
      return {
        input: ["-vaapi_device", vaapiDevice],
        tail: "format=nv12,hwupload",
        codec: ["-c:v", "h264_vaapi", ...rate, "-profile:v", "high"],
      };
    case "h264_videotoolbox":
      return {
        input: [],
        tail: "format=yuv420p",
        codec: ["-c:v", "h264_videotoolbox", ...rate, "-profile:v", "high"],
      };
    case "libx264":
      return {
        input: [],
        tail: "format=yuv420p",
        codec: [
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          q.crf,
          ...cap,
          "-profile:v",
          "high",
        ],
      };
    default:
      throw new Error(`Unknown encoder "${encoder}"`);
  }
}

const seconds = (ms) => (ms / 1000).toFixed(3);

/**
 * ffconcat list. Each file gets a `duration` equal to the wall-clock distance
 * to the next segment's start, so the concatenated timeline IS the wall clock
 * (relative to the first segment): -ss/-t then cut exactly the requested
 * window, and a short camera drop-out shows as a held frame instead of
 * silently shortening the clip. Quotes in paths are escaped the way the
 * concat demuxer expects.
 */
export function buildConcatList(segments) {
  const lines = ["ffconcat version 1.0"];
  segments.forEach((segment, i) => {
    lines.push(`file '${segment.path.replace(/'/g, "'\\''")}'`);
    const next = segments[i + 1];
    if (Number.isFinite(segment.startMs)) {
      const ms = next ? next.startMs - segment.startMs : segment.endMs - segment.startMs + 100;
      lines.push(`duration ${(Math.max(ms, 1) / 1000).toFixed(3)}`);
    }
  });
  return `${lines.join("\n")}\n`;
}

/**
 * Concatenate → trim → (watermark) → scale ≤ 1080p → H.264 + AAC MP4 with
 * faststart. The trim is frame-accurate (output-side -ss/-t).
 */
export function buildClipArgs({
  listPath,
  offsetMs,
  durationMs,
  logoPath,
  width,
  height,
  encoder,
  vaapiDevice,
  quality = "clip",
  outPath,
}) {
  const enc = encoderSettings(encoder, { vaapiDevice, quality });
  const args = ["-hide_banner", "-nostdin", "-y", "-loglevel", "error", ...enc.input];
  args.push("-f", "concat", "-safe", "0", "-i", listPath);
  let filter;
  if (logoPath) {
    const { logoWidth, margin } = logoLayout(width);
    args.push("-i", logoPath);
    filter =
      `[0:v:0]scale=${width}:${height},setsar=1[base];` +
      `[1:v]scale=${logoWidth}:-2,format=rgba[logo];` +
      `[base][logo]overlay=x=W-w-${margin}:y=H-h-${margin},${enc.tail}[v]`;
  } else {
    filter = `[0:v:0]scale=${width}:${height},setsar=1,${enc.tail}[v]`;
  }
  // Output-side -ss/-t: decoding the < 7 s before the cut is cheap and exact.
  // Input-side seeking on the concat demuxer started the video ~1.5 s after
  // the audio in testing.
  args.push("-ss", seconds(offsetMs), "-t", seconds(durationMs));
  args.push("-filter_complex", filter, "-map", "[v]", "-map", "0:a?");
  args.push(...enc.codec, "-c:a", "aac", "-b:a", QUALITY[quality].audio);
  args.push("-movflags", "+faststart", "-f", "mp4", outPath);
  return args;
}

/** One JPEG frame (640 px wide) from `atSeconds` into the finished clip. */
export const buildThumbnailArgs = ({ videoPath, atSeconds, outPath }) => [
  "-hide_banner",
  "-nostdin",
  "-y",
  "-loglevel",
  "error",
  "-ss",
  atSeconds.toFixed(3),
  "-i",
  videoPath,
  "-frames:v",
  "1",
  "-vf",
  "scale=640:-2",
  "-q:v",
  "4",
  "-update",
  "1",
  outPath,
];

/**
 * ENCODER=auto: the first hardware encoder that can really encode a test
 * clip (being listed by `ffmpeg -encoders` is not enough), else libx264.
 */
export async function detectEncoder({ ffmpegPath, preferred = "auto", vaapiDevice, log }) {
  if (preferred !== "auto") return preferred;
  let listed = "";
  try {
    ({ stdout: listed } = await runFfmpeg(ffmpegPath, ["-hide_banner", "-encoders"], {
      timeoutMs: 15_000,
    }));
  } catch (err) {
    log?.warn("could not list ffmpeg encoders", err);
  }
  for (const candidate of ["h264_qsv", "h264_vaapi", "h264_videotoolbox"]) {
    if (!listed.includes(` ${candidate} `)) continue;
    const enc = encoderSettings(candidate, { vaapiDevice });
    const args = [
      "-hide_banner",
      "-nostdin",
      "-loglevel",
      "error",
      ...enc.input,
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1280x720:rate=25",
      "-t",
      "1",
      "-vf",
      enc.tail,
      ...enc.codec,
      "-f",
      "null",
      "-",
    ];
    try {
      await runFfmpeg(ffmpegPath, args, { timeoutMs: 30_000 });
      return candidate;
    } catch (err) {
      log?.info(`${candidate} is listed but does not work here`, err);
    }
  }
  return "libx264";
}

/** Hard-link the segments into the job folder (copy when links are not possible), so pruning cannot pull them away mid-cut. */
async function pinSegments(segments, partsDir) {
  await fsp.mkdir(partsDir, { recursive: true });
  const pinned = [];
  for (const segment of segments) {
    const dest = path.join(partsDir, segment.name);
    await fsp.rm(dest, { force: true });
    try {
      await fsp.link(segment.path, dest);
    } catch (_err) {
      await fsp.copyFile(segment.path, dest);
    }
    pinned.push(dest);
  }
  return pinned;
}

/**
 * Cut, watermark and encode one clip into `workDir`. Falls back to libx264
 * once if a hardware encoder fails. → { videoPath, thumbnailPath, durationSeconds, encoder }
 */
export async function cutClip({
  segments,
  offsetMs,
  durationMs,
  workDir,
  logoPath,
  encoder,
  quality = "clip",
  settings,
  signal,
  log,
}) {
  const partsDir = path.join(workDir, "parts");
  const listPath = path.join(workDir, "list.ffconcat");
  const videoPath = path.join(workDir, "clip.mp4");
  const thumbPath = path.join(workDir, "thumbnail.jpg");
  try {
    const pinned = await pinSegments(segments, partsDir);
    await fsp.writeFile(
      listPath,
      buildConcatList(segments.map((segment, i) => ({ ...segment, path: pinned[i] })))
    );
    const source = await probeVideo(settings.ffprobePath, pinned[0]);
    const { width, height } = outputSize(source.width, source.height);

    const encode = (enc) =>
      runFfmpeg(
        settings.ffmpegPath,
        buildClipArgs({
          listPath,
          offsetMs,
          durationMs,
          logoPath,
          width,
          height,
          encoder: enc,
          vaapiDevice: settings.vaapiDevice,
          quality,
          outPath: videoPath,
        }),
        { timeoutMs: 15 * 60_000, signal }
      );
    let used = encoder;
    try {
      await encode(encoder);
    } catch (err) {
      if (encoder === "libx264" || signal?.aborted) throw err;
      log?.warn(`${encoder} failed, retrying with libx264`, err);
      used = "libx264";
      await encode(used);
    }

    const result = await probeFile(settings.ffprobePath, videoPath);
    const expected = durationMs / 1000;
    if (result.duration < expected * 0.8) {
      throw new FfmpegError(
        `clip came out too short (${result.duration.toFixed(1)}s of ${expected}s)`
      );
    }

    let thumbnailPath = thumbPath;
    try {
      await runFfmpeg(
        settings.ffmpegPath,
        buildThumbnailArgs({ videoPath, atSeconds: result.duration / 2, outPath: thumbPath }),
        { timeoutMs: 60_000, signal }
      );
    } catch (err) {
      log?.warn("thumbnail failed — uploading the clip without one", err);
      thumbnailPath = null;
    }
    return { videoPath, thumbnailPath, durationSeconds: result.duration, encoder: used };
  } finally {
    await fsp.rm(partsDir, { recursive: true, force: true });
    await fsp.rm(listPath, { force: true });
  }
}

/**
 * One attempt at a queued clip:
 *   { status: "wait" }                       the post-window is not on disk yet
 *   { status: "fail", reason }               the buffer does not cover the window
 *   { status: "done", videoPath, thumbnailPath, ... }
 * Throws FfmpegError when ffmpeg fails.
 */
export async function makeClip(entry, ctx) {
  const { segmentsDir, courtKnown, workDir, logoPath, encoder, settings, signal, log } = ctx;
  const now = ctx.now ?? Date.now();
  const window = clipWindow(entry);
  const timeline = await loadTimeline(segmentsDir);
  // Keyframes can be 6 s apart and a reconnect takes ~10 s: give up waiting after 30 s
  const waitLimit = window.endMs + Math.max(30_000, settings.segmentSeconds * 4000);
  if (!isWindowClosed(timeline, window.endMs) && now < waitLimit) return { status: "wait" };

  if (!courtKnown && timeline.length === 0) {
    return { status: "fail", reason: "This court's camera is not set up on the recorder box" };
  }
  const part = isSessionPart(entry);
  if (part) {
    const selection = selectPartSegments(timeline, window.startMs, window.endMs);
    if (!selection.ok)
      return { status: "fail", reason: partFailureReason(selection), detail: selection };
    await fsp.mkdir(workDir, { recursive: true });
    const result = await cutClip({
      ...selection,
      workDir,
      logoPath,
      encoder,
      quality: "session",
      settings,
      signal,
      log,
    });
    return { status: "done", coverage: selection.coverage, ...result };
  }
  const selection = selectSegments(timeline, window.startMs, window.endMs);
  if (!selection.ok) {
    return {
      status: "fail",
      reason: coverageReason(selection, {
        windowStartMs: window.startMs,
        nowMs: now,
        bufferMs: settings.bufferSeconds * 1000,
      }),
      detail: selection,
    };
  }
  await fsp.mkdir(workDir, { recursive: true });
  const result = await cutClip({
    segments: selection.segments,
    offsetMs: selection.offsetMs,
    durationMs: window.endMs - window.startMs,
    workDir,
    logoPath,
    encoder,
    settings,
    signal,
    log,
  });
  return { status: "done", ...result };
}
