import fsp from "node:fs/promises";
import { ApiError } from "./api.js";

/**
 * CR-040: a whole-game video goes from this box straight to the court's Google
 * Drive. The API opens a resumable upload session with the court's sign-in and
 * gives the box its address; the box PUTs the file there in chunks, then tells
 * the API the file's ID (it checks Drive has it, whole, and shares it by link).
 * The box keeps its own copy until the venue's keep time is over (videos.js).
 */

/** Google wants every chunk but the last in multiples of 256 KiB. */
export const DRIVE_CHUNK_UNIT = 256 * 1024;
export const DEFAULT_DRIVE_CHUNK_BYTES = 8 * 1024 * 1024;
export const MAX_DRIVE_CHUNK_BYTES = 64 * 1024 * 1024;
/** Google's offset not moving this many times in a row: stop and try again later. */
const MAX_STALLS = 5;
/** Progress for the game page at most this often. */
const PROGRESS_EVERY_MS = 15_000;

/** The API's chunk size rounded down to 256 KiB, within [256 KiB, 64 MiB]. */
export function driveChunkBytes(value) {
  if (!Number.isInteger(value) || value <= 0) return DEFAULT_DRIVE_CHUNK_BYTES;
  const units = Math.floor(Math.min(value, MAX_DRIVE_CHUNK_BYTES) / DRIVE_CHUNK_UNIT);
  return Math.max(1, units) * DRIVE_CHUNK_UNIT;
}

const unusable = (what) =>
  new ApiError(`Drive upload: Google answered an unusable ${what}`, {
    status: 502,
    code: "DRIVE_BUSY",
  });

/** Google's byte count, checked against the file size. */
function receivedFrom(value, sizeBytes) {
  if (!Number.isInteger(value) || value < 0 || value > sizeBytes) throw unusable("offset");
  return value;
}

/**
 * Send a kept game file to Google Drive, resuming where Google is.
 *
 * 1. POST /drive-session → no usable Drive: `{ drive: false, reason, keepUntilMs }`
 *    is returned at once (the file stays on the box);
 * 2. an empty PUT asks Google how much it has (a session reused after a restart
 *    or a dropped connection resumes, never from zero);
 * 3. PUT each chunk from there (read from disk at the offset, one chunk in memory);
 * 4. the last chunk's answer has the file's ID → POST /drive-done.
 *
 * `driveFileId` (Google already answered with it before a restart) skips to 4.
 * Errors are thrown for the caller (jobs.js) to sort: ApiError codes
 * DRIVE_SESSION_EXPIRED / DRIVE_FILE_MISMATCH → a new session; DRIVE_BUSY and
 * network/5xx → later; DRIVE_REFUSED → Google won't take it; anything else from
 * the device API as for any game upload. A non-ApiError means the file itself
 * can't be read.
 *
 * @param {object} opts
 * @param {object} opts.api           createApi's client
 * @param {string} opts.id            sessionVideoId
 * @param {{ videoPath: string, sizeBytes: number, durationSeconds: number, gaps?: object[] }} opts.file
 * @param {boolean} [opts.newSession] ask the API for a new Drive session
 * @param {string|null} [opts.driveFileId]
 * @param {AbortSignal} [opts.signal]
 * @param {() => Promise<void>} [opts.beforeChunk] awaited before every chunk (clips go first)
 * @param {(opened: object) => Promise<void>|void} [opts.onSession] the session the API gave
 * @param {(fileId: string) => Promise<void>|void} [opts.onUploaded] Google has the whole file
 * @param {(bytes: number) => void} [opts.onProgress]
 * @param {() => number} [opts.now]
 * @returns {Promise<{ drive: true, keepUntilMs: number|null, driveFileId: string }
 *   | { drive: false, reason: string, keepUntilMs: number|null }>}
 */
export async function sendToDrive({
  api,
  id,
  file,
  newSession = false,
  driveFileId = null,
  signal,
  beforeChunk,
  onSession,
  onUploaded,
  onProgress,
  now = () => Date.now(),
}) {
  const { videoPath, sizeBytes, durationSeconds, gaps = [] } = file;
  const opened = await api.openDriveSession(
    id,
    { sizeBytes, durationSeconds, gaps, newSession },
    signal
  );
  const keepUntilMs = Number.isFinite(opened?.keepUntilMs) ? opened.keepUntilMs : null;
  if (!opened?.drive) {
    return { drive: false, reason: String(opened?.reason || "NO_DRIVE"), keepUntilMs };
  }
  if (typeof opened.uploadUrl !== "string" || !opened.uploadUrl) {
    throw new ApiError("drive-session: the API answered without an upload address", {
      status: 502,
    });
  }
  await onSession?.(opened);

  let fileId = driveFileId;
  if (!fileId) {
    fileId = await uploadChunks({
      api,
      id,
      uploadUrl: opened.uploadUrl,
      chunkBytes: driveChunkBytes(opened.chunkBytes),
      videoPath,
      sizeBytes,
      signal,
      beforeChunk,
      onProgress,
      now,
    });
    await onUploaded?.(fileId);
  }
  await api.driveDone(id, fileId, signal);
  return { drive: true, keepUntilMs, driveFileId: fileId };
}

/** Steps 2–3: the bytes Google doesn't have yet. → the Drive file ID */
async function uploadChunks({
  api,
  id,
  uploadUrl,
  chunkBytes,
  videoPath,
  sizeBytes,
  signal,
  beforeChunk,
  onProgress,
  now,
}) {
  const status = await api.driveUploadStatus(uploadUrl, sizeBytes, signal);
  if (status.done) return status.fileId;
  let offset = receivedFrom(status.receivedBytes, sizeBytes);
  let reportedAt = 0;
  const progress = async (force = false) => {
    onProgress?.(offset);
    if (!force && now() - reportedAt < PROGRESS_EVERY_MS) return;
    reportedAt = now();
    // Only for the game page: a failed report never stops the upload
    await api.reportDriveProgress(id, offset, signal).catch(() => {});
  };
  await progress(true);

  const handle = await fsp.open(videoPath, "r");
  try {
    const buffer = Buffer.allocUnsafe(Math.min(chunkBytes, Math.max(sizeBytes, 1)));
    let stalls = 0;
    for (;;) {
      await beforeChunk?.();
      if (signal?.aborted) throw new ApiError("Drive upload: aborted");
      const length = Math.min(chunkBytes, sizeBytes - offset);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      if (bytesRead !== length) throw new Error(`${videoPath} is shorter than ${sizeBytes} bytes`);
      const answer = await api.putDriveChunk(
        uploadUrl,
        offset,
        buffer.subarray(0, length),
        sizeBytes,
        signal
      );
      if (answer.done) {
        offset = sizeBytes;
        await progress(true);
        return answer.fileId;
      }
      const received = receivedFrom(answer.receivedBytes, sizeBytes);
      // Google has every byte but hasn't answered with the file: ask again
      if (received === sizeBytes) {
        const again = await api.driveUploadStatus(uploadUrl, sizeBytes, signal);
        if (again.done) return again.fileId;
        throw unusable("answer (all bytes, no file)");
      }
      stalls = received > offset ? 0 : stalls + 1;
      if (stalls > MAX_STALLS) throw unusable("offset again and again");
      offset = received;
      await progress();
    }
  } finally {
    await handle.close();
  }
}
