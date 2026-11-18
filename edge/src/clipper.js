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

/** The window to cut in epoch ms: [requestedAt − pre, requestedAt + post]. */
export function clipWindow(entry) {
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

/**
 * Which camera a game job asks for (CR-006): 0 = the court's only camera
 * (camera 1's buffer), 1 or 2 = that camera only. Absent/null is 0. Anything
 * else is -1 (the job is failed). 60-second clips always use every camera
 * the court has (stacked on a two-camera court).
 */
export function jobCamera(entry) {
  const value = entry?.camera;
  if (value === undefined || value === null) return 0;
  return [0, 1, 2].includes(value) ? value : -1;
}

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
 * Bitrate caps per kind of output. A 65 s clip stays ≲ 20 MB (the C200 gave
 * 13–24 MB per 65 s uncapped). Whole-game videos are never encoded (game.js).
 */
export const QUALITY = {
  clip: { crf: "23", bitrate: "2000k", maxrate: "2300k", bufsize: "4600k", audio: "96k" },
  // Two cameras stacked (1280×1440): about twice the pixels
  clipStacked: { crf: "23", bitrate: "3800k", maxrate: "4200k", bufsize: "8400k", audio: "96k" },
  // A stacked live stream: constant ~3 Mbit/s (no crf — streaming services want a steady rate)
  stream: { crf: null, bitrate: "3000k", maxrate: "3000k", bufsize: "6000k", audio: "96k" },
};

/** Size of each camera in a stacked picture, and the whole picture. */
export const STACK_TILE = { width: 1280, height: 720 };
export const STACKED_SIZE = { width: 1280, height: 1440 };

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
          ...(q.crf ? ["-crf", q.crf] : ["-b:v", q.bitrate]),
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

/**
 * Two cameras of one court in one clip: each concat list trimmed to the same
 * wall-clock window (its own offset), scaled into 1280×720 (aspect kept,
 * padded), Cam 1 over Cam 2 → 1280×1440, watermark bottom-right (laid out for
 * 1280 wide), H.264 + AAC from `audioInput` (Cam 1's unless it has none).
 * The trim happens in the filter because each input has its own offset.
 */
export function buildStackedClipArgs({
  listPaths,
  offsetsMs,
  durationMs,
  logoPath,
  fps,
  audioInput = 0,
  encoder,
  vaapiDevice,
  quality = "clipStacked",
  outPath,
}) {
  const enc = encoderSettings(encoder, { vaapiDevice, quality });
  const { width, height } = STACK_TILE;
  const d = seconds(durationMs);
  const args = ["-hide_banner", "-nostdin", "-y", "-loglevel", "error", ...enc.input];
  for (const listPath of listPaths) args.push("-f", "concat", "-safe", "0", "-i", listPath);
  const tile = (i, label) =>
    `[${i}:v:0]trim=start=${seconds(offsetsMs[i])}:duration=${d},setpts=PTS-STARTPTS,` +
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}[${label}]`;
  const parts = [tile(0, "top"), tile(1, "bottom")];
  const audio = `[${audioInput}:a:0]atrim=start=${seconds(offsetsMs[audioInput])}:duration=${d},asetpts=PTS-STARTPTS[a]`;
  if (logoPath) {
    const { logoWidth, margin } = logoLayout(STACKED_SIZE.width);
    args.push("-i", logoPath);
    parts.push(
      "[top][bottom]vstack=inputs=2[stack]",
      `[2:v]scale=${logoWidth}:-2,format=rgba[logo]`,
      `[stack][logo]overlay=x=W-w-${margin}:y=H-h-${margin},${enc.tail}[v]`
    );
  } else {
    parts.push(`[top][bottom]vstack=inputs=2,${enc.tail}[v]`);
  }
  args.push("-filter_complex", [...parts, ...(audioInput === null ? [] : [audio])].join(";"));
  args.push("-map", "[v]", ...(audioInput === null ? [] : ["-map", "[a]"]), "-t", d);
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
export async function pinSegments(segments, partsDir) {
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

/** Pin each camera's segments and write its concat list. → [{ listPath, first }] */
async function prepareSources(sources, workDir) {
  const prepared = [];
  for (const [i, source] of sources.entries()) {
    const pinned = await pinSegments(source.segments, path.join(workDir, "parts", `cam${i + 1}`));
    const listPath = path.join(workDir, `list-${i + 1}.ffconcat`);
    await fsp.writeFile(
      listPath,
      buildConcatList(source.segments.map((segment, j) => ({ ...segment, path: pinned[j] })))
    );
    prepared.push({ listPath, first: pinned[0], offsetMs: source.offsetMs });
  }
  return prepared;
}

/** The ffmpeg arguments for one or two cameras (stacked), per encoder. */
async function clipArgsFor(prepared, { durationMs, logoPath, settings, videoPath }) {
  if (prepared.length === 1) {
    const source = await probeVideo(settings.ffprobePath, prepared[0].first);
    const { width, height } = outputSize(source.width, source.height);
    return (encoder) =>
      buildClipArgs({
        listPath: prepared[0].listPath,
        offsetMs: prepared[0].offsetMs,
        durationMs,
        logoPath,
        width,
        height,
        encoder,
        vaapiDevice: settings.vaapiDevice,
        outPath: videoPath,
      });
  }
  const probes = await Promise.all(prepared.map((p) => probeFile(settings.ffprobePath, p.first)));
  const video = probes.map((p) => p.streams.find((st) => st.type === "video"));
  const hasAudio = probes.map((p) => p.streams.some((st) => st.type === "audio"));
  const known = video.map((v) => v?.fps).filter((f) => Number.isFinite(f) && f > 0);
  const fps = known.length ? Math.min(30, Math.round(Math.min(...known))) : 25;
  // Sound from Cam 1, Cam 2's if Cam 1 has none
  const audioInput = hasAudio[0] ? 0 : hasAudio[1] ? 1 : null;
  return (encoder) =>
    buildStackedClipArgs({
      listPaths: prepared.map((p) => p.listPath),
      offsetsMs: prepared.map((p) => p.offsetMs),
      durationMs,
      logoPath,
      fps,
      audioInput,
      encoder,
      vaapiDevice: settings.vaapiDevice,
      outPath: videoPath,
    });
}

/**
 * Cut, watermark and encode one clip into `workDir`, from one camera
 * (`segments` + `offsetMs`, or `sources` with one entry) or two stacked
 * (`sources` = [cam 1, cam 2], each { segments, offsetMs }). Falls back to
 * libx264 once if a hardware encoder fails.
 * → { videoPath, thumbnailPath, durationSeconds, encoder, cameras }
 */
export async function cutClip({
  segments,
  offsetMs,
  sources = [{ segments, offsetMs }],
  durationMs,
  workDir,
  logoPath,
  encoder,
  settings,
  signal,
  log,
}) {
  const videoPath = path.join(workDir, "clip.mp4");
  const thumbPath = path.join(workDir, "thumbnail.jpg");
  try {
    const prepared = await prepareSources(sources, workDir);
    const argsFor = await clipArgsFor(prepared, {
      durationMs,
      logoPath,
      settings,
      videoPath,
    });
    const encode = (enc) =>
      runFfmpeg(settings.ffmpegPath, argsFor(enc), { timeoutMs: 15 * 60_000, signal });
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
    return {
      videoPath,
      thumbnailPath,
      durationSeconds: result.duration,
      encoder: used,
      cameras: sources.length,
    };
  } finally {
    await fsp.rm(path.join(workDir, "parts"), { recursive: true, force: true });
    for (let i = 1; i <= sources.length; i += 1) {
      await fsp.rm(path.join(workDir, `list-${i}.ffconcat`), { force: true });
    }
  }
}

/**
 * Which cameras to cut and how: both stacked when both cover the window, else
 * the one that does. `selections` = one per camera (selectSegments), `null`
 * for a camera without a buffer.
 * → { sources: [{ segments, offsetMs }], durationMs, cameras: [1] | [2] | [1, 2] }
 *   or { fail: selection } (camera 1's reason, else camera 2's)
 */
export function chooseSources(selections, window) {
  const ok = selections.map((sel, i) => (sel?.ok ? i : -1)).filter((i) => i >= 0);
  if (!ok.length) return { fail: selections[0] ?? selections.find(Boolean) };
  return {
    sources: ok.map((i) => ({
      segments: selections[i].segments,
      offsetMs: selections[i].offsetMs,
    })),
    durationMs: window.endMs - window.startMs,
    cameras: ok.map((i) => i + 1),
  };
}

/**
 * What to do with a queued clip, from the court's camera time lines
 * ([cam 1, cam 2]; an empty one is a camera without footage):
 *   { status: "wait" }                       the post-window is not on disk yet
 *   { status: "fail", reason, detail? }      the buffer does not cover the window
 *   { status: "cut", sources, durationMs, cameras, fallback }
 * Both cameras stacked when both cover the window, else the one that does.
 */
export function planClip(entry, timelines, { courtKnown, now, settings }) {
  const window = clipWindow(entry);
  // Keyframes can be 6 s apart and a reconnect takes ~10 s: give up waiting after 30 s
  const waitLimit = window.endMs + Math.max(30_000, settings.segmentSeconds * 4000);
  // Wait for every camera that is recording around the window
  const active = timelines.filter((t) => t.some((s) => s.endMs > window.startMs));
  const ready = active.length > 0 && active.every((t) => isWindowClosed(t, window.endMs));
  if (!ready && now < waitLimit) return { status: "wait" };

  if (!courtKnown && timelines.every((t) => t.length === 0)) {
    return { status: "fail", reason: "This court's camera is not set up on the recorder box" };
  }
  // no second camera → null
  const selections = timelines.map((t, i) =>
    i > 0 && t.length === 0 ? null : selectSegments(t, window.startMs, window.endMs)
  );
  const choice = chooseSources(selections, window);
  if (choice.fail) {
    const reason = coverageReason(choice.fail, {
      windowStartMs: window.startMs,
      nowMs: now,
      bufferMs: settings.bufferSeconds * 1000,
    });
    return { status: "fail", reason, detail: choice.fail };
  }
  return {
    status: "cut",
    ...choice,
    fallback: selections.filter(Boolean).length > 1 && choice.cameras.length === 1,
  };
}

/**
 * One attempt at a queued clip:
 *   { status: "wait" }                       the post-window is not on disk yet
 *   { status: "fail", reason }               the buffer does not cover the window
 *   { status: "done", videoPath, thumbnailPath, ... }
 * `segmentsDirs` = the court's camera folders ([cam 1, cam 2]; a missing
 * folder is a camera without footage). See planClip for which camera(s).
 * Throws FfmpegError when ffmpeg fails.
 */
export async function makeClip(entry, ctx) {
  const { workDir, logoPath, encoder, settings, signal, log } = ctx;
  const dirs = ctx.segmentsDirs ?? [ctx.segmentsDir];
  const now = ctx.now ?? Date.now();
  const timelines = await Promise.all(dirs.map((dir) => loadTimeline(dir)));
  const plan = planClip(entry, timelines, { courtKnown: ctx.courtKnown, now, settings });
  if (plan.status !== "cut") return plan;
  if (plan.fallback) {
    const other = plan.cameras[0] === 1 ? 2 : 1;
    log?.info(
      `${entry.clipId}: camera ${other} has no footage for that window — camera ${plan.cameras[0]} only`
    );
  }
  await fsp.mkdir(workDir, { recursive: true });
  const result = await cutClip({
    sources: plan.sources,
    durationMs: plan.durationMs,
    workDir,
    logoPath,
    encoder,
    settings,
    signal,
    log,
  });
  return { status: "done", ...result };
}
