import fsp from "node:fs/promises";
import path from "node:path";
import { ApiError } from "./api.js";
import { buildThumbnailArgs, isWindowClosed, jobCamera, pinSegments } from "./clipper.js";
import { FfmpegError, H264_COPY_CLEANUP, probeFile, runFfmpeg } from "./ffmpeg.js";
import { loadTimeline } from "./segments.js";

/**
 * Whole-game videos (CR-006): after End game the API sends one game job per
 * camera; the box joins that camera's recorded segments into ONE mp4 by
 * stream copy (no re-encode, no logo, no scaling) and uploads it in chunks
 * that survive a dropped connection or a restart.
 *
 * The pure functions (selection, gaps, ffmpeg arguments) are unit-tested;
 * makeGameFile() runs ffmpeg, uploadGameFile() is the upload state machine.
 */

/** A hole in the footage longer than this is a gap: skipped in the file and reported. */
export const GAME_GAP_TOLERANCE_MS = 7000;
/** The API's chunk size (8 MiB) when its answer has none; never more than 64 MiB. */
export const DEFAULT_CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_CHUNK_BYTES = 64 * 1024 * 1024;
/** Times in a row the server may move the offset before the upload is retried later. */
const MAX_RESYNCS = 5;
/** Copying even a 3 h game takes well under a minute; this only catches a stuck ffmpeg. */
const COPY_TIMEOUT_MS = 30 * 60_000;

export const GAME_FILE = "game.mp4";
export const GAME_THUMBNAIL = "thumb.jpg";

/** A game job (or its queue entry): `type: "game"` with a session video id. */
export const isGameJob = (entry) => entry?.type === "game" && Boolean(entry.sessionVideoId);

/** Camera 2's buffer for a camera-2 job, camera 1's for camera 0 (the court's only camera) and 1. */
export const gameTimeline = (camera, timelines) =>
  (camera === 2 ? timelines[1] : timelines[0]) ?? [];

/** The fail reason for a camera without footage in the game window (named for 1/2). */
export const gameFailureReason = (camera) =>
  camera === 1 || camera === 2
    ? `Camera ${camera} was not recording during this game`
    : "The camera was not recording during this game";

/**
 * The segments of one camera covering [startMs, endMs] and the holes in them.
 * Holes up to `gapToleranceMs` (a late keyframe, a short Wi-Fi hiccup) count
 * as recorded — they become a held frame, like in clips. Longer ones are gaps:
 * left out of the file and reported as `[{ startMs, endMs }]` (inside the window).
 * → { ok: true, segments, gaps, coveredMs } | { ok: false, reason: "NO_FOOTAGE" }
 */
export function selectGameSegments(
  timeline,
  startMs,
  endMs,
  { gapToleranceMs = GAME_GAP_TOLERANCE_MS } = {}
) {
  const segments = timeline.filter((s) => s.startMs < endMs && s.endMs > startMs);
  if (segments.length === 0) return { ok: false, reason: "NO_FOOTAGE" };
  const gaps = [];
  const hole = (from, to) => {
    const a = Math.max(from, startMs);
    const b = Math.min(to, endMs);
    // Whole milliseconds: segment times can carry fractions, the API wants integers
    if (b - a > gapToleranceMs) gaps.push({ startMs: Math.round(a), endMs: Math.round(b) });
  };
  hole(startMs, segments[0].startMs);
  for (let i = 1; i < segments.length; i += 1) hole(segments[i - 1].endMs, segments[i].startMs);
  hole(segments[segments.length - 1].endMs, endMs);
  const missing = gaps.reduce((sum, g) => sum + (g.endMs - g.startMs), 0);
  return { ok: true, segments, gaps, coveredMs: endMs - startMs - missing };
}

/**
 * Where wall-clock `atMs` lands in the copied file: the file starts at the
 * first segment's start and every skipped gap is left out. null when the
 * footage ends before `atMs` (nothing to trim).
 */
export function fileOffsetMs(segments, atMs, { gapToleranceMs = GAME_GAP_TOLERANCE_MS } = {}) {
  const last = segments[segments.length - 1];
  if (!last || last.endMs <= atMs) return null;
  let skipped = 0;
  for (let i = 1; i < segments.length; i += 1) {
    const hole = segments[i].startMs - segments[i - 1].endMs;
    if (hole > gapToleranceMs && segments[i].startMs <= atMs) skipped += hole;
  }
  return Math.max(0, atMs - segments[0].startMs - skipped);
}

const overlaps = (timeline, window) =>
  timeline.some((s) => s.startMs < window.endMs && s.endMs > window.startMs);

/**
 * What to do with a game job, from the court's camera time lines ([cam 1, cam 2]):
 *   { status: "wait" }                   the end of the game is not in a closed segment yet
 *   { status: "fail", reason }           nothing to copy
 *   { status: "copy", segments, gaps, durationSeconds, cutMs }
 * Camera 0 and 1 use camera 1's buffer, camera 2 camera 2's — never the other
 * camera, never stacked. `courtCameras` = the cameras /config lists ([1] or [1, 2]).
 */
export function planGame(entry, timelines, { courtCameras = [], now, settings }) {
  const camera = jobCamera(entry);
  if (camera < 0)
    return { status: "fail", reason: `This court has no camera ${String(entry.camera)}` };
  const window = { startMs: entry.windowStartMs, endMs: entry.windowEndMs };
  if (
    !Number.isFinite(window.startMs) ||
    !Number.isFinite(window.endMs) ||
    window.endMs <= window.startMs
  ) {
    return { status: "fail", reason: "The game's start and end times are missing" };
  }
  const timeline = gameTimeline(camera, timelines);
  // Camera 2 taken off the court (or never there): fail at once, unless it recorded this game
  if (camera === 2 && !courtCameras.includes(2) && !overlaps(timeline, window)) {
    return { status: "fail", reason: "This court has no camera 2" };
  }
  // Like clips, but a little more patient: a long game can wait a minute
  const waitLimit = window.endMs + Math.max(60_000, (settings.segmentSeconds ?? 2) * 4000);
  if (!isWindowClosed(timeline, window.endMs) && now < waitLimit) return { status: "wait" };
  const sel = selectGameSegments(timeline, window.startMs, window.endMs);
  if (!sel.ok) return { status: "fail", reason: gameFailureReason(camera) };
  return {
    status: "copy",
    segments: sel.segments,
    gaps: sel.gaps,
    durationSeconds: Math.round(sel.coveredMs / 1000),
    cutMs: fileOffsetMs(sel.segments, window.endMs),
  };
}

/**
 * ffconcat list for a stream copy. A short hole keeps the wall-clock spacing
 * (`duration` up to the next segment's start, a held frame); after a gap, or
 * for the last file, no `duration`: the file's own length, so the gap is
 * left out of the video. Quotes in paths are escaped for the concat demuxer.
 */
export function buildGameConcatList(segments, { gapToleranceMs = GAME_GAP_TOLERANCE_MS } = {}) {
  const lines = ["ffconcat version 1.0"];
  segments.forEach((segment, i) => {
    lines.push(`file '${segment.path.replace(/'/g, "'\\''")}'`);
    const next = segments[i + 1];
    if (next && next.startMs - segment.endMs <= gapToleranceMs) {
      lines.push(`duration ${(Math.max(next.startMs - segment.startMs, 1) / 1000).toFixed(3)}`);
    }
  });
  return `${lines.join("\n")}\n`;
}

/**
 * Concatenate by stream copy into one mp4: camera video + its AAC audio (the
 * recorder already made it AAC), no re-encode, no filter, faststart. The end
 * is trimmed at `cutMs` (packet-accurate); the start is the first segment's
 * keyframe.
 */
export function buildGameCopyArgs({ listPath, cutMs, outPath }) {
  return [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-loglevel",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-c:v",
    "copy",
    ...H264_COPY_CLEANUP,
    "-c:a",
    "copy",
    "-bsf:a",
    "aac_adtstoasc",
    ...(Number.isFinite(cutMs) ? ["-t", (cutMs / 1000).toFixed(3)] : []),
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    outPath,
  ];
}

/**
 * One attempt at a game job:
 *   { status: "wait" } | { status: "fail", reason }
 *   { status: "done", videoPath, thumbnailPath, sizeBytes, durationSeconds, gaps }
 * `segmentsDirs` = the court's camera folders ([cam 1, cam 2]). The segments
 * are hard-linked into `workDir` while ffmpeg copies them, so pruning can't
 * pull them away. `onCopy()` runs just before ffmpeg starts (the job's phase).
 * Throws FfmpegError when ffmpeg fails. A failed thumbnail is only logged.
 */
export async function makeGameFile(entry, ctx) {
  const { workDir, settings, signal, log } = ctx;
  const timelines = await Promise.all(ctx.segmentsDirs.map((dir) => loadTimeline(dir)));
  const plan = planGame(entry, timelines, {
    courtCameras: ctx.courtCameras,
    now: ctx.now ?? Date.now(),
    settings,
  });
  if (plan.status !== "copy") return plan;
  await ctx.onCopy?.();
  await fsp.mkdir(workDir, { recursive: true });
  const videoPath = path.join(workDir, GAME_FILE);
  const listPath = path.join(workDir, "list.ffconcat");
  const partsDir = path.join(workDir, "parts");
  try {
    const pinned = await pinSegments(plan.segments, partsDir);
    await fsp.writeFile(
      listPath,
      buildGameConcatList(plan.segments.map((segment, i) => ({ ...segment, path: pinned[i] })))
    );
    await runFfmpeg(
      settings.ffmpegPath,
      buildGameCopyArgs({ listPath, cutMs: plan.cutMs, outPath: videoPath }),
      {
        timeoutMs: COPY_TIMEOUT_MS,
        signal,
      }
    );
  } finally {
    await fsp.rm(partsDir, { recursive: true, force: true });
    await fsp.rm(listPath, { force: true });
  }
  const info = await probeFile(settings.ffprobePath, videoPath);
  if (!info.streams.some((s) => s.type === "video") || !(info.duration > 0)) {
    throw new FfmpegError("the game video came out empty");
  }
  let thumbnailPath = path.join(workDir, GAME_THUMBNAIL);
  try {
    const atSeconds = Math.min(1, info.duration / 2);
    await runFfmpeg(
      settings.ffmpegPath,
      buildThumbnailArgs({ videoPath, atSeconds, outPath: thumbnailPath }),
      {
        timeoutMs: 60_000,
        signal,
      }
    );
  } catch (err) {
    log?.warn("game thumbnail failed — uploading the video without one", err);
    thumbnailPath = null;
  }
  const { size } = await fsp.stat(videoPath);
  if (plan.gaps.length) {
    log?.info(
      `${entry.sessionVideoId}: ${plan.gaps.length} gap(s) in the footage left out — ` +
        plan.gaps.map((g) => `${Math.round((g.endMs - g.startMs) / 1000)}s`).join(", ")
    );
  }
  return {
    status: "done",
    videoPath,
    thumbnailPath,
    sizeBytes: size,
    durationSeconds: plan.durationSeconds,
    gaps: plan.gaps,
    fileSeconds: info.duration,
  };
}

// ─── Resumable upload ─────────────────────────────────────────────────────────

/** 409 OFFSET_MISMATCH: the server has `data.receivedBytes` — carry on from there. */
export const isOffsetMismatch = (err) =>
  err instanceof ApiError &&
  err.status === 409 &&
  err.code === "OFFSET_MISMATCH" &&
  Number.isInteger(err.data?.receivedBytes);

/** 409 on finish with fewer bytes than the file: chunks are missing — resume from there. */
export const isMissingBytes = (err, sizeBytes) =>
  err instanceof ApiError &&
  err.status === 409 &&
  Number.isInteger(err.data?.receivedBytes) &&
  err.data.receivedBytes < sizeBytes;

/** The game is gone or already Ready/Failed/Expired: 404, or a 409 that isn't a resume. */
export const isGameGone = (err, sizeBytes) =>
  err instanceof ApiError &&
  (err.status === 404 ||
    (err.status === 409 && !isOffsetMismatch(err) && !isMissingBytes(err, sizeBytes)));

const badAnswer = (what) =>
  new ApiError(`game upload: the server answered an unusable ${what}`, { status: 502 });

/** A byte offset from the server, checked against the file size. */
function offsetFrom(value, sizeBytes) {
  if (!Number.isInteger(value) || value < 0 || value > sizeBytes) throw badAnswer("receivedBytes");
  return value;
}

/**
 * Upload a finished game file: POST /start (the server says how much it
 * already has) → PUT each chunk from that offset (read from disk at the
 * offset, one chunk in memory) → POST /finish with the thumbnail.
 * A 409 OFFSET_MISMATCH moves to the server's offset; a 409 on finish with
 * missing bytes goes back to sending chunks. Any other error is thrown (an
 * ApiError) for the caller to retry or drop — the next attempt resumes via
 * /start, never from zero.
 *
 * `beforeChunk()` is awaited before every chunk (clips go first),
 * `onPhase("uploading" | "finishing")` when the phase changes, `onProgress(bytes)`.
 * → the /finish answer ({ status: "Ready" })
 */
export async function uploadGameFile({ api, id, file, signal, beforeChunk, onPhase, onProgress }) {
  const { videoPath, thumbnailPath, sizeBytes, durationSeconds, gaps = [] } = file;
  const started = await api.startGameUpload(id, { sizeBytes, durationSeconds, gaps }, signal);
  const chunkBytes =
    Number.isInteger(started.chunkBytes) && started.chunkBytes > 0
      ? Math.min(started.chunkBytes, MAX_CHUNK_BYTES)
      : DEFAULT_CHUNK_BYTES;
  let offset = offsetFrom(started.receivedBytes ?? 0, sizeBytes);
  onProgress?.(offset);
  const handle = await fsp.open(videoPath, "r");
  try {
    const buffer = Buffer.allocUnsafe(Math.min(chunkBytes, Math.max(sizeBytes, 1)));
    let resyncs = 0;
    for (;;) {
      while (offset < sizeBytes) {
        await beforeChunk?.();
        if (signal?.aborted) throw new ApiError("game upload: aborted");
        const length = Math.min(chunkBytes, sizeBytes - offset);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        if (bytesRead !== length)
          throw new Error(`${videoPath} is shorter than ${sizeBytes} bytes`);
        try {
          const data = await api.putGameChunk(id, offset, buffer.subarray(0, length), signal);
          offset =
            data?.receivedBytes === undefined
              ? offset + length
              : offsetFrom(data.receivedBytes, sizeBytes);
          resyncs = 0;
        } catch (err) {
          if (!isOffsetMismatch(err)) throw err;
          resyncs += 1;
          if (resyncs > MAX_RESYNCS) throw badAnswer("offset again and again");
          offset = offsetFrom(err.data.receivedBytes, sizeBytes);
        }
        onProgress?.(offset);
      }
      await onPhase?.("finishing");
      try {
        return await api.finishGameUpload(id, thumbnailPath, signal);
      } catch (err) {
        if (!isMissingBytes(err, sizeBytes)) throw err;
        resyncs += 1;
        if (resyncs > MAX_RESYNCS) throw badAnswer("missing-bytes answer again and again");
        offset = err.data.receivedBytes;
        await onPhase?.("uploading");
      }
    }
  } finally {
    await handle.close();
  }
}
