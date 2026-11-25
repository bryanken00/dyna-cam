import fsp from "node:fs/promises";
import os from "node:os";

/**
 * The box's own health for the heartbeat's `system` field (CR-008): disk,
 * memory, load, uptime, clock offset and the upload backlog. The API turns it
 * into problems ("disk almost full", "clock off", "uploads piling up") and
 * emails staff.
 */

const MB = 1024 * 1024;

/**
 * What is still waiting in the job queue: clips not yet uploaded, game videos
 * not yet sent, and the age of the oldest one. Anything else (an old button
 * press) doesn't count.
 *
 * @param {object[]} entries queue.json entries (JobQueue.list())
 * @param {number} now epoch ms
 * @returns {{ pendingClips: number, pendingGames: number, oldestPendingSeconds: number }}
 */
export function queueBacklog(entries, now) {
  let pendingClips = 0;
  let pendingGames = 0;
  let oldest = null;
  for (const entry of entries || []) {
    if (entry?.type === "game") pendingGames += 1;
    else if (entry?.clipId) pendingClips += 1;
    else continue;
    // A game can't be sent before it ends: count from its end, not its start
    const since = Number.isFinite(entry.requestedAtMs) ? entry.requestedAtMs : null;
    if (since !== null && (oldest === null || since < oldest)) oldest = since;
  }
  return {
    pendingClips,
    pendingGames,
    oldestPendingSeconds: oldest === null ? 0 : Math.max(0, Math.round((now - oldest) / 1000)),
  };
}

/**
 * Free and total space of the file system holding `dir`, in MB, or null when
 * it can't be read (the heartbeat goes out without it).
 */
export async function diskSpace(dir, statfs = fsp.statfs) {
  try {
    const stats = await statfs(dir);
    const block = Number(stats.bsize);
    return {
      diskFreeMb: Math.floor((Number(stats.bavail) * block) / MB),
      diskTotalMb: Math.floor((Number(stats.blocks) * block) / MB),
    };
  } catch {
    return null;
  }
}

/**
 * One health sample. Every field is optional on the API side, so a value that
 * can't be read is left out rather than failing the heartbeat.
 *
 * @param {object} opts
 * @param {string} opts.dataDir      DATA_DIR (the buffer lives there)
 * @param {() => object[]} [opts.queueEntries]
 * @param {() => object} [opts.videoStats] CR-040: { localVideos, localVideoMb } kept for Drive
 * @param {number|null} [opts.clockOffsetMs] server − box, from the last /config or heartbeat
 * @param {() => number} [opts.now]
 * @param {Function} [opts.statfs]
 * @param {typeof os} [opts.osImpl]
 */
export async function sampleHealth({
  dataDir,
  queueEntries = () => [],
  videoStats = null,
  clockOffsetMs = null,
  now = () => Date.now(),
  statfs = fsp.statfs,
  osImpl = os,
}) {
  const disk = await diskSpace(dataDir, statfs);
  const health = {
    ...(disk ?? {}),
    memFreeMb: Math.floor(osImpl.freemem() / MB),
    memTotalMb: Math.floor(osImpl.totalmem() / MB),
    load1: Math.round(osImpl.loadavg()[0] * 100) / 100,
    cpus: osImpl.cpus().length || 1,
    uptimeSeconds: Math.floor(osImpl.uptime()),
    ...queueBacklog(queueEntries(), now()),
    ...(videoStats ? videoStats() : {}),
  };
  if (Number.isFinite(clockOffsetMs)) health.clockOffsetMs = Math.round(clockOffsetMs);
  return health;
}

/**
 * Server clock minus box clock, from a reply's `serverTime` and the request's
 * send/receive times (half the round trip assumed each way). null without a
 * usable serverTime.
 */
export function clockOffset(serverTime, sentAt, receivedAt) {
  if (!Number.isFinite(serverTime)) return null;
  return serverTime - (sentAt + receivedAt) / 2;
}
