import fsp from "node:fs/promises";
import path from "node:path";
import { readJson, writeJsonAtomic } from "./util.js";

/**
 * Where each buffer segment really sits in wall-clock time.
 *
 * Segments are cut on keyframes, so their length is irregular (1.7–6 s on a
 * Tapo C200), and the `%s` file name is only the second the file was opened —
 * after a connect burst it runs ahead of the content. So the name is not used
 * for timing when anything better exists:
 *
 * - ffmpeg writes `segments.csv` (`name,start,end`) as each segment closes.
 *   The times are CONTENT times (the camera's own timestamps, from 0 at the
 *   start of each ffmpeg run) — smooth, so playback stays smooth.
 * - A segment is closed the moment the next keyframe arrives, so its mtime is
 *   (almost) the wall-clock arrival of content time `end`. `mtime − end` is the
 *   run's anchor plus network delay; the smallest value nearby is the best
 *   estimate of the anchor (delay ≥ 0, connect bursts only add to it).
 * - wall start/end = anchor + content start/end.
 *
 * We do NOT stamp packets with -use_wallclock_as_timestamps: that clumps
 * frames that arrive together (measured: 4 frames within 50 µs), and the
 * clip encoder then drops half of them.
 *
 * The list is truncated on every ffmpeg restart, so rows are merged into
 * `index.json` with the id of the run (`run.json`, written at spawn).
 */

export const SEGMENT_LIST = "segments.csv";
export const SEGMENT_INDEX = "index.json";
export const RUN_FILE = "run.json";
const ANCHOR_WINDOW_MS = 120_000;

/** Epoch ms a segment file was opened, from its name; null if it is not a segment. */
export const segmentStartMs = (name) => {
  const match = /^(\d{9,11})\.ts$/.exec(name);
  return match ? Number(match[1]) * 1000 : null;
};

/** Name + mtime of every segment file in a folder (missing folder → []). */
export async function readSegmentEntries(dir) {
  let names;
  try {
    names = await fsp.readdir(dir);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const entries = await Promise.all(
    names
      .filter((name) => segmentStartMs(name) !== null)
      .map(async (name) => {
        try {
          const stat = await fsp.stat(path.join(dir, name));
          return { name, path: path.join(dir, name), mtimeMs: stat.mtimeMs, size: stat.size };
        } catch (_err) {
          return null; // pruned between readdir and stat
        }
      })
  );
  return entries.filter(Boolean);
}

/** Footage around a session window is kept this much wider on each side. */
export const SESSION_MARGIN_MS = 10_000;
/** …and until this long after the session ends (the last part's job comes in by then). */
export const SESSION_KEEP_AFTER_MS = 30 * 60_000;

/**
 * Windows of a court's footage that must outlive the rolling buffer: every
 * session of `courtId` (± margin) that ended less than 30 min ago.
 * → [{ fromMs, toMs }]
 */
export const retentionWindows = (sessions, courtId, nowMs) =>
  (sessions || [])
    .filter((s) => s.courtId === courtId && Number.isFinite(s.startMs) && Number.isFinite(s.endMs))
    .filter((s) => nowMs < s.endMs + SESSION_KEEP_AFTER_MS)
    .map((s) => ({ fromMs: s.startMs - SESSION_MARGIN_MS, toMs: s.endMs + SESSION_MARGIN_MS }));

/**
 * Segments that can be deleted: last written before the rolling buffer AND
 * not overlapping any kept session window (a segment spans name → mtime).
 */
export const segmentsToPrune = (entries, nowMs, bufferMs, keep = []) =>
  entries
    .filter((e) => {
      const startMs = segmentStartMs(e.name);
      if (startMs === null || e.mtimeMs >= nowMs - bufferMs) return false;
      return !keep.some((w) => startMs < w.toMs && e.mtimeMs > w.fromMs);
    })
    .map((e) => e.name);

/** ffmpeg's CSV segment list → [{ name, startSec, endSec }]; malformed lines are skipped. */
export function parseSegmentList(text) {
  const rows = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const [name, start, end] = line.split(",").map((part) => part?.trim());
    const startSec = Number(start);
    const endSec = Number(end);
    if (segmentStartMs(name ?? "") === null || start === "" || end === "") continue;
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec < startSec) continue;
    rows.push({ name, startSec, endSec });
  }
  return rows;
}

/**
 * Add list rows to the index as { run, cStartMs, cEndMs, closedAtMs }.
 * `closedAt` is the file's mtime. Returns true if the index changed.
 */
export function mergeSegmentList(index, rows, { run, mtimes }) {
  let changed = false;
  for (const row of rows) {
    if (index[row.name] || !mtimes.has(row.name)) continue;
    index[row.name] = {
      run,
      cStartMs: Math.round(row.startSec * 1000),
      cEndMs: Math.round(row.endSec * 1000),
      closedAtMs: Math.round(mtimes.get(row.name)),
    };
    changed = true;
  }
  return changed;
}

/** Wall-clock anchor for each indexed segment: the smallest `closedAt − cEnd` of its run nearby. */
export function anchors(index) {
  const byRun = new Map();
  for (const [name, item] of Object.entries(index)) {
    if (!byRun.has(item.run)) byRun.set(item.run, []);
    byRun.get(item.run).push({ name, ...item, offset: item.closedAtMs - item.cEndMs });
  }
  const result = new Map();
  for (const items of byRun.values()) {
    for (const item of items) {
      let best = Infinity;
      for (const other of items) {
        if (Math.abs(other.cStartMs - item.cStartMs) <= ANCHOR_WINDOW_MS)
          best = Math.min(best, other.offset);
      }
      result.set(item.name, best);
    }
  }
  return result;
}

/**
 * Time line of the CLOSED segments on disk, oldest first:
 * [{ name, path, startMs, endMs, exact }]. Segments missing from the index
 * (their list row was lost to a hard kill) fall back to name → mtime, except
 * the newest file, which is still being written.
 */
export function buildTimeline(entries, index) {
  const anchorOf = anchors(index);
  const newest = entries.reduce(
    (a, b) => (segmentStartMs(b.name) > segmentStartMs(a?.name ?? "0.ts") ? b : a),
    null
  )?.name;
  const timeline = [];
  for (const entry of entries) {
    const known = index[entry.name];
    if (known) {
      const anchor = anchorOf.get(entry.name);
      timeline.push({
        name: entry.name,
        path: entry.path,
        startMs: anchor + known.cStartMs,
        endMs: anchor + known.cEndMs,
        exact: true,
      });
    } else if (entry.name !== newest) {
      const startMs = segmentStartMs(entry.name);
      timeline.push({
        name: entry.name,
        path: entry.path,
        startMs,
        endMs: Math.max(startMs, entry.mtimeMs),
        exact: false,
      });
    }
  }
  return timeline.sort((a, b) => a.startMs - b.startMs);
}

/**
 * Read a court folder's segments, list and index → time line. With `persist`
 * (the recorder's tick) the merged index is written back, minus files that
 * no longer exist.
 */
export async function loadTimeline(dir, { persist = false } = {}) {
  const indexFile = path.join(dir, SEGMENT_INDEX);
  const index = (await readJson(indexFile, {})) || {};
  const { run = "unknown" } = (await readJson(path.join(dir, RUN_FILE), {})) || {};
  const listText = await fsp.readFile(path.join(dir, SEGMENT_LIST), "utf8").catch(() => "");
  const entries = await readSegmentEntries(dir);
  const mtimes = new Map(entries.map((e) => [e.name, e.mtimeMs]));
  let changed = mergeSegmentList(index, parseSegmentList(listText), { run, mtimes });
  for (const name of Object.keys(index)) {
    if (!mtimes.has(name)) {
      delete index[name];
      changed = true;
    }
  }
  if (persist && changed) await writeJsonAtomic(indexFile, index, 0o644);
  return buildTimeline(entries, index);
}
