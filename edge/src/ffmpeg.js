import { spawn } from "node:child_process";
import { maskCredentials } from "./util.js";

/** ffmpeg/ffprobe exited badly. `message` carries the last stderr lines (masked). */
export class FfmpegError extends Error {
  constructor(message, { code = null, stderr = "" } = {}) {
    super(message);
    this.name = "FfmpegError";
    this.code = code;
    this.stderr = stderr;
  }
}

/**
 * Run ffmpeg/ffprobe to completion. Resolves { stdout, stderr }; rejects with
 * FfmpegError on a non-zero exit, a timeout, or `signal` aborting (the child is
 * killed). Arguments are always an array — never a shell string.
 */
export function runFfmpeg(bin, args, { timeoutMs = 10 * 60_000, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new FfmpegError("aborted"));
    let child;
    try {
      child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      return reject(new FfmpegError(`cannot start ${bin}: ${err.message}`));
    }
    let stdout = "";
    let stderr = "";
    let killedFor = null;
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 1_000_000) stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-8000);
    });
    const kill = (why) => {
      killedFor = why;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(
      () => kill(`timed out after ${Math.round(timeoutMs / 1000)}s`),
      timeoutMs
    );
    const onAbort = () => kill("aborted");
    signal?.addEventListener("abort", onAbort, { once: true });

    const finish = (err) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (err) reject(err);
      else resolve({ stdout, stderr });
    };
    child.on("error", (err) =>
      finish(new FfmpegError(`cannot start ${bin}: ${err.code || err.message}`))
    );
    child.on("close", (code) => {
      if (killedFor) return finish(new FfmpegError(`${bin} ${killedFor}`, { stderr }));
      if (code === 0) return finish(null);
      const tail = maskCredentials(stderr.trim().split("\n").slice(-3).join(" | "));
      return finish(new FfmpegError(`${bin} exited with code ${code}: ${tail}`, { code, stderr }));
    });
  });
}

/** Major version from `ffmpeg -version` output ("ffmpeg version 6.1.1-3ubuntu5" → 6). Git builds → 99. */
export function parseFfmpegMajor(versionText) {
  const match = /ffmpeg version (?:n)?(\d+)\./i.exec(versionText || "");
  if (match) return Number(match[1]);
  return /ffmpeg version/i.test(versionText || "") ? 99 : null;
}

export async function ffmpegMajorVersion(ffmpegPath) {
  const { stdout } = await runFfmpeg(ffmpegPath, ["-hide_banner", "-version"], {
    timeoutMs: 15_000,
  });
  return parseFfmpegMajor(stdout);
}

/** Width/height/codec of the first video stream of a file. */
export async function probeVideo(ffprobePath, file) {
  const { stdout } = await runFfmpeg(
    ffprobePath,
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,codec_name",
      "-of",
      "json",
      file,
    ],
    { timeoutMs: 30_000 }
  );
  const stream = JSON.parse(stdout).streams?.[0];
  if (!stream?.width || !stream?.height) throw new FfmpegError(`no video stream in ${file}`);
  return { width: stream.width, height: stream.height, codec: stream.codec_name };
}

/** "30000/1001" → 29.97; "0/0" or missing → undefined. */
const frameRateOf = (text) => {
  const [num, den] = String(text || "")
    .split("/")
    .map(Number);
  return num > 0 && den > 0 ? num / den : undefined;
};

/** Duration (s) and stream types (with the video frame rate) of a file. */
export async function probeFile(ffprobePath, file) {
  const { stdout } = await runFfmpeg(
    ffprobePath,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate",
      "-of",
      "json",
      file,
    ],
    { timeoutMs: 30_000 }
  );
  const info = JSON.parse(stdout);
  return {
    duration: Number(info.format?.duration) || 0,
    streams: (info.streams || []).map((s) => ({
      type: s.codec_type,
      codec: s.codec_name,
      width: s.width,
      height: s.height,
      fps: frameRateOf(s.avg_frame_rate),
    })),
  };
}
