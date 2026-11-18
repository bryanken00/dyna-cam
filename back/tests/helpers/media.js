// Real (tiny) mp4 files for tests that join videos (CR-003). Made with ffmpeg
// once per process; tests that need them skip when ffmpeg isn't installed.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";

/** True when ffmpeg runs here. */
export const hasFfmpeg = () => spawnSync(ffmpeg, ["-version"], { stdio: "ignore" }).status === 0;

const cache = new Map();

/**
 * A playable H.264 + AAC mp4 of `seconds` (a colour test pattern), made with
 * the same settings every time, so several of them join by stream copy like
 * the recorder box's parts.
 * @returns {Buffer}
 */
export const makeMp4 = (seconds = 1, { width = 320, height = 180 } = {}) => {
  const key = `${seconds}:${width}x${height}`;
  if (cache.has(key)) return cache.get(key);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tpl-media-"));
  const out = path.join(dir, "part.mp4");
  const result = spawnSync(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `testsrc=size=${width}x${height}:rate=15:duration=${seconds}`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:duration=${seconds}`,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      "-movflags",
      "+faststart",
      out,
    ],
    { encoding: "utf8" }
  );
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr}`);
  const buffer = fs.readFileSync(out);
  fs.rmSync(dir, { recursive: true, force: true });
  cache.set(key, buffer);
  return buffer;
};

/** Duration of an mp4 file in seconds (ffprobe), or null. */
export const probeSeconds = (file) => {
  const ffprobe = process.env.FFPROBE_PATH || "ffprobe";
  const result = spawnSync(
    ffprobe,
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    { encoding: "utf8" }
  );
  return result.status === 0 ? Number(result.stdout.trim()) : null;
};
