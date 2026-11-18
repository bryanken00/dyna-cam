import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { randomToken } from "./crypto/tokens.js";
import { clipUploadFolder } from "./file/clipFiles.js";
import { signedDownloadUrl, signUploadUrl } from "./file/signedUrl.js";

/**
 * Whole-game videos (CR-003). A recorded game is cut by the recorder box into
 * 5-minute parts (utils/sessions.js); once every part is in, the API joins the
 * parts of each camera into one video (jobs/sessionJoin.js) — a plain stream
 * copy, so it takes seconds and loses nothing. The player downloads one file.
 *
 * camera: 0 = the box's usual output (one camera, or both stacked), 1 = Cam 1,
 * 2 = Cam 2.
 *
 *   FFMPEG_PATH   ffmpeg to join with (default "ffmpeg" on PATH). Without it,
 *                 games stay as parts (a one-part game is copied, no ffmpeg).
 */

/** What players and staff call a camera's whole video. */
export const CAMERA_LABEL = { 0: "Whole game", 1: "Cam 1", 2: "Cam 2" };

const ffmpegPath = () => process.env.FFMPEG_PATH || "ffmpeg";

let ffmpegCheck = null; // { ok, at }
const FFMPEG_RECHECK_MS = 10 * 60 * 1000;

/** Run a program; resolves { code, stderr } (stderr's last 2 KB). */
const run = (command, args, { timeoutMs = 10 * 60 * 1000 } = {}) =>
  new Promise((resolve) => {
    let stderr = "";
    let child;
    try {
      child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    } catch (err) {
      resolve({ code: -1, stderr: err.message });
      return;
    }
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-2048);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stderr: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });

/** Is ffmpeg there? Checked at most every 10 minutes. */
export const ffmpegAvailable = async () => {
  if (ffmpegCheck && Date.now() - ffmpegCheck.at < FFMPEG_RECHECK_MS) return ffmpegCheck.ok;
  const { code } = await run(ffmpegPath(), ["-hide_banner", "-version"], { timeoutMs: 10000 });
  ffmpegCheck = { ok: code === 0, at: Date.now() };
  return ffmpegCheck.ok;
};

/** Forget the last ffmpeg check (tests switch FFMPEG_PATH). */
export const resetFfmpegCheck = () => {
  ffmpegCheck = null;
};

/** Absolute path of a stored "/public/uploads/…" file, or null when it is not one. */
export const storedToAbsolute = (stored) => {
  if (typeof stored !== "string" || !stored.startsWith("/public/uploads/")) return null;
  const root = path.resolve("public", "uploads");
  const absolute = path.resolve(stored.replace(/^[/\\]+/, ""));
  return absolute.startsWith(root + path.sep) ? absolute : null;
};

/** Merge the windows of the parts that are missing into gaps, e.g. 10:40–10:50. */
export const gapsOf = (parts) => {
  const gaps = [];
  for (const part of parts) {
    if (part.status === "Ready" && part.videoPath) continue;
    const last = gaps[gaps.length - 1];
    if (last && last.endAt >= part.windowStartAt) {
      if (part.windowEndAt > last.endAt) last.endAt = part.windowEndAt;
    } else {
      gaps.push({ startAt: part.windowStartAt, endAt: part.windowEndAt });
    }
  }
  return gaps;
};

/**
 * Join a camera's Ready parts (in order) into one mp4 in its own folder under
 * the clips uploads, plus a copy of the first part's thumbnail.
 *
 * @param {Object} video - { venueId, sessionVideoId, camera }
 * @param {Array} parts - the camera's Ready parts, ordered, with videoPath/thumbnailPath
 * @returns {Promise<{ videoPath, thumbnailPath, sizeBytes }>} stored paths
 * @throws {Error} with a staff-readable message when the join fails
 */
export const joinParts = async (video, parts) => {
  const folder = clipUploadFolder(video.venueId, video.sessionVideoId); // uploads/admin/clips/…
  const absoluteFolder = path.resolve("public", folder);
  await fs.promises.mkdir(absoluteFolder, { recursive: true });

  const files = parts.map((part) => storedToAbsolute(part.videoPath));
  if (files.some((file) => !file)) throw new Error("A part's video path is not a stored upload");
  for (const file of files) {
    await fs.promises.access(file).catch(() => {
      throw new Error("A part's video is no longer on the server");
    });
  }

  const name = `game-cam${video.camera}-${randomToken(12)}.mp4`;
  const output = path.join(absoluteFolder, name);

  if (files.length === 1) {
    await fs.promises.copyFile(files[0], output);
  } else {
    // The concat demuxer joins parts made with the same settings by copying
    // them — no re-encoding. faststart: a phone can play it while it loads.
    const list = path.join(absoluteFolder, `parts-${randomToken(6)}.txt`);
    await fs.promises.writeFile(
      list,
      files.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n")
    );
    const { code, stderr } = await run(ffmpegPath(), [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      list,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      output,
    ]);
    await fs.promises.unlink(list).catch(() => {});
    if (code !== 0) {
      await fs.promises.unlink(output).catch(() => {});
      const detail = stderr.trim().split("\n").pop() || `exit ${code}`;
      throw new Error(`Joining the parts failed: ${detail}`.slice(0, 250));
    }
  }

  let thumbnailPath = null;
  const firstThumb = storedToAbsolute(parts.find((part) => part.thumbnailPath)?.thumbnailPath);
  if (firstThumb) {
    const thumbName = `thumb-${randomToken(12)}.jpg`;
    const copied = await fs.promises
      .copyFile(firstThumb, path.join(absoluteFolder, thumbName))
      .then(() => true)
      .catch(() => false);
    if (copied) thumbnailPath = `/public/${folder}/${thumbName}`;
  }

  const { size } = await fs.promises.stat(output);
  return { videoPath: `/public/${folder}/${name}`, thumbnailPath, sizeBytes: size };
};

const parseGaps = (gaps) => {
  if (!gaps) return [];
  try {
    return typeof gaps === "string" ? JSON.parse(gaps) : gaps;
  } catch {
    return [];
  }
};

/**
 * A whole video as the player's page shows it. Joining is internal: to the
 * player it is "Saving". Links only while Ready; the Drive copy also after
 * the server's copy expired.
 */
export const toPublicVideo = (row) => {
  const ready = row.status === "Ready";
  return {
    camera: row.camera,
    label: CAMERA_LABEL[row.camera] || `Cam ${row.camera}`,
    status: ["Pending", "Joining"].includes(row.status) ? "Saving" : row.status,
    durationSeconds: row.durationSeconds ?? null,
    sizeBytes: row.sizeBytes ?? null,
    gaps: parseGaps(row.gaps),
    partsMissing: row.partsMissing || 0,
    expiresAt: ready ? row.expiresAt : null,
    videoUrl: ready ? signUploadUrl(row.videoPath) : null,
    downloadUrl: ready ? signedDownloadUrl(row.videoPath) : null,
    thumbnailUrl: ready ? signUploadUrl(row.thumbnailPath) : null,
    driveUrl:
      row.driveStatus === "Uploaded" && ["Ready", "Expired"].includes(row.status)
        ? row.driveUrl
        : null,
  };
};

/** A whole video as Admin → Sessions shows it (adds the internal status and why it failed). */
export const toAdminVideo = (row) => ({
  ...toPublicVideo(row),
  status: row.status,
  partsJoined: row.partsJoined || 0,
  failureReason: row.failureReason || null,
  driveStatus: row.driveStatus || null,
});

export const SESSION_VIDEO_COLUMNS = `camera, status, partsJoined, partsMissing, gaps, videoPath,
  thumbnailPath, sizeBytes, durationSeconds, failureReason, expiresAt, driveStatus, driveUrl`;

/** A session's whole videos, camera order. */
export const loadSessionVideos = (db, sessionId) =>
  db.query(
    `SELECT ${SESSION_VIDEO_COLUMNS} FROM session_videos
     WHERE sessionId = ? AND status != 'Deleted'
     ORDER BY camera ASC`,
    [sessionId]
  );
