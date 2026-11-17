import crypto from "node:crypto";
import fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pipeline, Transform } from "node:stream";
import {
  mergeSegmentList,
  parseSegmentList,
  RUN_FILE,
  SEGMENT_INDEX,
  SEGMENT_LIST,
  segmentStartMs,
} from "./segments.js";
import { readJson, safeId, writeJsonAtomic } from "./util.js";

/**
 * LAN live view (PLAN-002 §5.4): the newest closed buffer segments of a court
 * as an HLS live playlist, for the session device on the venue Wi-Fi.
 *
 *   GET /live/:courtId/index.m3u8?exp=<unix s>&sig=<hex>   → the last 5 closed segments
 *   GET /live/:courtId/<epoch>.ts?exp=…&sig=…             → one segment of that court
 *
 * No camera connection and no encoding: the files are the recorder's own.
 * `sig` = hex HMAC-SHA256(liveKey, `${courtId}.${exp}`), made by the API with
 * the key this box sends in its heartbeat.
 *
 * The recorder writes segments with `reset_timestamps=1`, so every file's
 * timestamps start near 0. A player needs one running clock, so each segment
 * is served with its PTS/DTS/PCR moved forward by its content start time
 * (segments.csv) — a byte-for-byte copy otherwise. A recorder restart starts a
 * new clock: the playlist marks it with #EXT-X-DISCONTINUITY.
 */

export const LIVE_SEGMENTS = 5;
export const LIVE_KEY_FILE = "live-key";
/** Newest closed segment older than this → the court isn't recording: 404, not a frozen picture. */
export const STALE_MS = 30_000;
/** A content-time jump bigger than this inside one recorder run is a gap. */
const GAP_MS = 1000;
/** Several viewers of one court share one folder read per second. */
const READ_CACHE_MS = 1000;
const KEEP_NUMBERED = 60;

const COURT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SEGMENT_FILE = /^\d{9,11}\.ts$/; // the recorder's `%s.ts`
const SIG = /^[0-9a-f]{64}$/i;
const EXP = /^\d{1,12}$/;
const KEY = /^[0-9a-f]{64}$/;
const TS_PACKET = 188;
const TICKS_PER_MS = 90; // MPEG-TS 90 kHz clock
const TS_WRAP = 2 ** 33;

/** hex HMAC-SHA256(key, `${courtId}.${exp}`) — the key is used as the hex string, like the API. */
export const signLive = (key, courtId, exp) =>
  crypto.createHmac("sha256", key).update(`${courtId}.${exp}`).digest("hex");

/** → "ok" | "bad" | "expired". Constant-time; malformed values are "bad". */
export function checkSignature({ key, courtId, exp, sig, nowMs }) {
  if (!key || !EXP.test(exp ?? "") || !SIG.test(sig ?? "")) return "bad";
  const expected = crypto.createHmac("sha256", key).update(`${courtId}.${exp}`).digest();
  if (!crypto.timingSafeEqual(expected, Buffer.from(sig, "hex"))) return "bad";
  return Number(exp) * 1000 <= nowMs ? "expired" : "ok";
}

/**
 * Route a request (pure). → { kind: "playlist" | "segment", courtId, file, exp, sig }
 * or { status, error }. Only `/live/<court id>/<index.m3u8 | epoch.ts>`;
 * anything else — another path, `..`, `/` in a name — is a 404.
 */
export function routeLive(method, rawUrl) {
  if (method !== "GET" && method !== "HEAD") return { status: 405, error: "Use GET or HEAD" };
  let url;
  try {
    url = new URL(rawUrl, "http://box");
  } catch (_err) {
    return { status: 404, error: "Not found" };
  }
  const parts = url.pathname.split("/");
  if (parts.length !== 4 || parts[0] !== "" || parts[1] !== "live") {
    return { status: 404, error: "Not found" };
  }
  let courtId;
  try {
    courtId = decodeURIComponent(parts[2]);
  } catch (_err) {
    courtId = "";
  }
  const file = parts[3];
  const kind = file === "index.m3u8" ? "playlist" : SEGMENT_FILE.test(file) ? "segment" : null;
  if (!COURT_ID.test(courtId) || !kind) return { status: 404, error: "Not found" };
  return {
    kind,
    courtId,
    file,
    exp: url.searchParams.get("exp"),
    sig: url.searchParams.get("sig"),
  };
}

/** index.json plus the rows of segments.csv not merged into it yet (read only — never moves files). */
async function readTimingIndex(dir, mtimes) {
  // The recorder's files: read, never moved aside (util.readJson would move a half-written one)
  const readObject = (name) =>
    fsp
      .readFile(path.join(dir, name), "utf8")
      .then((text) => JSON.parse(text))
      .then((value) => (value && typeof value === "object" ? value : {}))
      .catch(() => ({}));
  const index = await readObject(SEGMENT_INDEX);
  const { run = "unknown" } = await readObject(RUN_FILE);
  const listText = await fsp.readFile(path.join(dir, SEGMENT_LIST), "utf8").catch(() => "");
  mergeSegmentList(index, parseSegmentList(listText), { run, mtimes });
  return index;
}

/**
 * The newest `count` CLOSED segments of a court folder, oldest first:
 * [{ name, mtimeMs, timed, run, cStartMs, cEndMs, duration }] — null when the
 * folder doesn't exist. Only the newest files are stat'ed (a session keeps
 * thousands). A file not in segments.csv / index.json is closed only when a
 * newer file exists; its length then comes from name → mtime (`timed: false`).
 */
export async function readCourtSegments(dir, count = LIVE_SEGMENTS) {
  let names;
  try {
    names = await fsp.readdir(dir);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "ENOTDIR") return null;
    throw err;
  }
  const sorted = names
    .filter((name) => SEGMENT_FILE.test(name))
    .sort((a, b) => segmentStartMs(a) - segmentStartMs(b));
  const newest = sorted.at(-1);
  const stats = await Promise.all(
    sorted.slice(-(count + 1)).map((name) =>
      fsp
        .stat(path.join(dir, name))
        .then((stat) => ({ name, mtimeMs: stat.mtimeMs }))
        .catch(() => null)
    )
  );
  const files = stats.filter(Boolean);
  const index = await readTimingIndex(dir, new Map(files.map((f) => [f.name, f.mtimeMs])));
  const closed = [];
  for (const file of files) {
    const known = index[file.name];
    if (known && Number.isFinite(known.cStartMs) && Number.isFinite(known.cEndMs)) {
      const duration = Math.max(0.001, (known.cEndMs - known.cStartMs) / 1000);
      closed.push({ ...file, timed: true, run: known.run, ...pick(known), duration });
    } else if (file.name !== newest) {
      const seconds = (file.mtimeMs - segmentStartMs(file.name)) / 1000;
      const duration = Math.min(30, Math.max(0.1, seconds));
      closed.push({ ...file, timed: false, run: null, cStartMs: 0, cEndMs: 0, duration });
    }
  }
  return closed.slice(-count);
}

const pick = ({ cStartMs, cEndMs }) => ({ cStartMs, cEndMs });

/** The player's clock jumps between these two segments (recorder restart, gap, unknown timing). */
const breaksBetween = (prev, seg) =>
  !prev.timed ||
  !seg.timed ||
  prev.run !== seg.run ||
  Math.abs(seg.cStartMs - prev.cEndMs) > GAP_MS;

/**
 * Media sequence numbers for one court. HLS needs every segment to keep its
 * number across playlist reloads and the numbers to rise by one per segment.
 * The first segment numbered gets its own name (epoch seconds); each newer one
 * gets the previous number + 1. Names rise by ≥ 1 per segment, so a number
 * never exceeds its segment's name — after a box restart the new numbering
 * starts at or above the old one and never goes backwards. The discontinuity
 * sequence is counted the same way.
 */
export class LiveSequencer {
  constructor() {
    this.byName = new Map();
    this.last = null;
  }

  /** Number the new segments (oldest first) → the listable ones with { seq, dseq, offset }. */
  number(segments) {
    for (const seg of segments) {
      if (this.byName.has(seg.name)) continue;
      // Older than what is numbered already: it can't get a number without going back
      if (this.last && segmentStartMs(seg.name) <= segmentStartMs(this.last.name)) continue;
      const prev = this.last;
      const base = segmentStartMs(seg.name) / 1000;
      const entry = {
        ...seg,
        seq: prev ? prev.seq + 1 : base,
        dseq: prev ? prev.dseq + (breaksBetween(prev, seg) ? 1 : 0) : base,
        offset: seg.timed ? Math.round(seg.cStartMs * TICKS_PER_MS) : 0,
      };
      this.byName.set(seg.name, entry);
      this.last = entry;
    }
    for (const name of this.byName.keys()) {
      if (this.byName.size <= KEEP_NUMBERED) break;
      this.byName.delete(name); // insertion order = oldest first
    }
    return segments.map((seg) => this.byName.get(seg.name)).filter(Boolean);
  }
}

/** The HLS live playlist (no ENDLIST). `query` = "exp=…&sig=…" for every segment URI. */
export function buildPlaylist(listed, query) {
  const target = Math.max(1, ...listed.map((s) => Math.ceil(Number(s.duration.toFixed(3)))));
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-TARGETDURATION:${target}`,
    `#EXT-X-MEDIA-SEQUENCE:${listed[0].seq}`,
    `#EXT-X-DISCONTINUITY-SEQUENCE:${listed[0].dseq}`,
  ];
  listed.forEach((seg, i) => {
    if (i > 0 && seg.dseq !== listed[i - 1].dseq) lines.push("#EXT-X-DISCONTINUITY");
    lines.push(`#EXTINF:${seg.duration.toFixed(3)},`, `${seg.name}?${query}`);
  });
  return `${lines.join("\n")}\n`;
}

/** A 33-bit PES timestamp (PTS/DTS) at `o`. */
export const readPts = (b, o) =>
  (b[o] & 0x0e) * 2 ** 29 +
  b[o + 1] * 2 ** 22 +
  (b[o + 2] >> 1) * 2 ** 15 +
  b[o + 3] * 2 ** 7 +
  (b[o + 4] >> 1);

/** Write a 33-bit PES timestamp at `o`, keeping the 4-bit prefix and the marker bits. */
export function writePts(b, o, ts) {
  b[o] = (b[o] & 0xf0) | (Math.floor(ts / 2 ** 29) & 0x0e) | 1;
  b[o + 1] = Math.floor(ts / 2 ** 22) & 0xff;
  b[o + 2] = (Math.floor(ts / 2 ** 14) & 0xfe) | 1;
  b[o + 3] = Math.floor(ts / 2 ** 7) & 0xff;
  b[o + 4] = ((ts % 128) * 2) | 1;
}

/** The 33-bit base of a PCR at `o` (the 9-bit extension is left alone). */
export const readPcrBase = (b, o) =>
  b[o] * 2 ** 25 + b[o + 1] * 2 ** 17 + b[o + 2] * 2 ** 9 + b[o + 3] * 2 + (b[o + 4] >> 7);

function writePcrBase(b, o, base) {
  b[o] = Math.floor(base / 2 ** 25) & 0xff;
  b[o + 1] = Math.floor(base / 2 ** 17) & 0xff;
  b[o + 2] = Math.floor(base / 2 ** 9) & 0xff;
  b[o + 3] = Math.floor(base / 2) & 0xff;
  b[o + 4] = (b[o + 4] & 0x7f) | ((base % 2) << 7);
}

// PES stream ids without the optional header (so without PTS/DTS)
const PES_NO_HEADER = new Set([0xbc, 0xbe, 0xbf, 0xf0, 0xf1, 0xf2, 0xf8, 0xff]);

/**
 * Move every PCR, PTS and DTS in whole 188-byte MPEG-TS packets forward by
 * `offset` 90 kHz ticks, in place. Anything that doesn't parse is left as is.
 */
export function shiftTimestamps(buf, offset) {
  const shift = (ts) => (ts + offset) % TS_WRAP;
  for (let i = 0; i + TS_PACKET <= buf.length; i += TS_PACKET) {
    if (buf[i] !== 0x47) continue;
    const end = i + TS_PACKET;
    const control = (buf[i + 3] >> 4) & 3;
    let p = i + 4;
    if (control & 2) {
      const length = buf[p];
      if (length >= 7 && buf[p + 1] & 0x10)
        writePcrBase(buf, p + 2, shift(readPcrBase(buf, p + 2)));
      p += 1 + length;
    }
    const unitStart = buf[i + 1] & 0x40;
    if (!(control & 1) || !unitStart || p + 9 > end) continue;
    if (buf[p] !== 0 || buf[p + 1] !== 0 || buf[p + 2] !== 1 || PES_NO_HEADER.has(buf[p + 3])) {
      continue;
    }
    const flags = buf[p + 7] >> 6;
    if (flags & 2 && p + 14 <= end) writePts(buf, p + 9, shift(readPts(buf, p + 9)));
    if (flags === 3 && p + 19 <= end) writePts(buf, p + 14, shift(readPts(buf, p + 14)));
  }
  return buf;
}

/** A stream of a segment file with its timestamps shifted (packets split across chunks are joined). */
export class TimestampShift extends Transform {
  constructor(offset) {
    super();
    this.offset = offset;
    this.rest = null;
  }

  _transform(chunk, _encoding, done) {
    const data = this.rest ? Buffer.concat([this.rest, chunk]) : chunk;
    const whole = data.length - (data.length % TS_PACKET);
    this.rest = whole < data.length ? Buffer.from(data.subarray(whole)) : null;
    if (whole === 0) return done();
    const packets = data.subarray(0, whole);
    if (this.offset) shiftTimestamps(packets, this.offset);
    return done(null, packets);
  }

  _flush(done) {
    done(null, this.rest ?? undefined);
  }
}

const PRIVATE_IPV4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
const VIRTUAL_IF = /^(docker|br-|veth|virbr|vmnet|vboxnet|tun|tap|utun|wg|zt|tailscale)/i;

/**
 * The box's LAN IPv4 from os.networkInterfaces(): the first non-internal one,
 * preferring private ranges and real (not Docker/VPN) interfaces. null = none.
 */
export function lanAddress(interfaces = os.networkInterfaces()) {
  const found = [];
  for (const [name, addresses] of Object.entries(interfaces || {})) {
    for (const a of addresses || []) {
      const v4 = a.family === "IPv4" || a.family === 4;
      if (v4 && !a.internal && !a.address.startsWith("169.254.")) {
        found.push({ name, address: a.address });
      }
    }
  }
  const rank = (a) => (PRIVATE_IPV4.test(a.address) ? 0 : 2) + (VIRTUAL_IF.test(a.name) ? 1 : 0);
  found.sort((a, b) => rank(a) - rank(b));
  return found[0]?.address ?? null;
}

/** The live-view signing key: 32 random bytes as hex, made once, kept in DATA_DIR/live-key (0600). */
export async function loadLiveKey(dataDir) {
  const file = path.join(dataDir, LIVE_KEY_FILE);
  const saved = await readJson(file, null);
  if (typeof saved?.key === "string" && KEY.test(saved.key)) {
    await fsp.chmod(file, 0o600).catch(() => {});
    return saved.key;
  }
  const key = crypto.randomBytes(32).toString("hex");
  await writeJsonAtomic(file, { key, createdAt: new Date().toISOString() }, 0o600);
  return key;
}

const BASE_HEADERS = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };

function sendText(req, res, status, text, extra = {}) {
  const body = `${text}\n`;
  res.writeHead(status, {
    ...BASE_HEADERS,
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...extra,
  });
  res.end(req.method === "HEAD" ? undefined : body);
}

/**
 * The HTTP server. `bufferDir` = DATA_DIR/buffer; a court's folder is
 * `safeId(courtId)` inside it. The URL (it holds the signature) is never logged.
 */
export function createLiveServer({ bufferDir, key, log, now = () => Date.now() }) {
  const courts = new Map(); // courtId → { sequencer, read: { at, promise } }
  const court = (courtId) => {
    if (!courts.has(courtId)) courts.set(courtId, { sequencer: new LiveSequencer(), read: null });
    return courts.get(courtId);
  };
  const readCached = (courtId, dir) => {
    const state = court(courtId);
    const at = now();
    if (!state.read || at - state.read.at >= READ_CACHE_MS) {
      state.read = { at, promise: readCourtSegments(dir) };
      state.read.promise.catch(() => {
        state.read = null;
      });
    }
    return state.read.promise;
  };

  async function servePlaylist(req, res, route, dir) {
    const segments = await readCached(route.courtId, dir);
    const listed = segments ? court(route.courtId).sequencer.number(segments) : [];
    if (!listed.length || now() - listed.at(-1).mtimeMs > STALE_MS) {
      return sendText(req, res, 404, "No live video for this court right now");
    }
    const body = buildPlaylist(listed, `exp=${route.exp}&sig=${route.sig}`);
    res.writeHead(200, {
      ...BASE_HEADERS,
      "Content-Type": "application/vnd.apple.mpegurl",
      "Content-Length": Buffer.byteLength(body),
    });
    return res.end(req.method === "HEAD" ? undefined : body);
  }

  /** The clock offset of a segment: as numbered for the playlist, else from the timing files. */
  async function offsetOf(courtId, dir, name) {
    const numbered = court(courtId).sequencer.byName.get(name);
    if (numbered) return numbered.offset;
    const index = await readTimingIndex(dir, new Map([[name, 0]]));
    const known = index[name];
    return Number.isFinite(known?.cStartMs) ? Math.round(known.cStartMs * TICKS_PER_MS) : 0;
  }

  async function serveSegment(req, res, route, dir) {
    let handle;
    try {
      // Opened first: a segment pruned while it streams stays readable to the end
      handle = await fsp.open(path.join(dir, route.file), "r");
    } catch (_err) {
      return sendText(req, res, 404, "No such segment");
    }
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw Object.assign(new Error("not a file"), { notFound: true });
      const offset = await offsetOf(route.courtId, dir, route.file);
      res.writeHead(200, {
        ...BASE_HEADERS,
        "Content-Type": "video/mp2t",
        "Content-Length": stat.size,
      });
      if (req.method === "HEAD") {
        await handle.close();
        return res.end();
      }
      const source = handle.createReadStream();
      return pipeline(source, new TimestampShift(offset), res, (err) => {
        if (err && err.code !== "ERR_STREAM_PREMATURE_CLOSE") {
          log.debug(`live segment for ${route.courtId} ended early`, err);
        }
      });
    } catch (err) {
      await handle.close().catch(() => {});
      if (res.headersSent) return res.destroy();
      if (err.notFound) return sendText(req, res, 404, "No such segment");
      throw err;
    }
  }

  const server = http.createServer((req, res) => {
    req.resume();
    const route = routeLive(req.method, req.url);
    if (route.status) {
      const extra = route.status === 405 ? { Allow: "GET, HEAD" } : {};
      return sendText(req, res, route.status, route.error, extra);
    }
    const check = checkSignature({ key, ...route, nowMs: now() });
    if (check !== "ok") {
      log.debug(`live ${route.kind} for ${route.courtId} refused: ${check} link`);
      return sendText(req, res, 403, check === "expired" ? "Link expired" : "Bad signature");
    }
    const dir = path.join(bufferDir, safeId(route.courtId));
    const serve = route.kind === "playlist" ? servePlaylist : serveSegment;
    return serve(req, res, route, dir).catch((err) => {
      log.warn(`live ${route.kind} for ${route.courtId} failed`, err);
      if (!res.headersSent) sendText(req, res, 500, "Live view error");
      else res.destroy();
    });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  return server;
}

/**
 * The live view of this box: key, server and the heartbeat's `live` field.
 * Never throws — a taken port or an unwritable key file leaves the box
 * recording without live view.
 */
export class LiveView {
  constructor({
    settings,
    log,
    now = () => Date.now(),
    interfaces = () => os.networkInterfaces(),
  }) {
    this.settings = settings;
    this.log = log;
    this.now = now;
    this.interfaces = interfaces;
    this.server = null;
    this.key = null;
    this.warnedNoHost = false;
  }

  async start() {
    const { livePort: port, dataDir } = this.settings;
    if (!port) {
      this.log.info("live view off (LIVE_PORT=0)");
      return false;
    }
    try {
      this.key = await loadLiveKey(dataDir);
    } catch (err) {
      this.log.warn("live view off — could not create the live-view key in DATA_DIR", err);
      return false;
    }
    const server = createLiveServer({
      bufferDir: path.join(dataDir, "buffer"),
      key: this.key,
      log: this.log,
      now: this.now,
    });
    this.server = await new Promise((resolve) => {
      server.once("error", (err) => {
        const why =
          err.code === "EADDRINUSE" ? "the port is already in use" : err.code || err.message;
        this.log.warn(
          `live view could not start on port ${port} (${why}) — recording goes on without live view; free the port or change LIVE_PORT`
        );
        resolve(null);
      });
      server.listen(port, "0.0.0.0", () => resolve(server));
    });
    if (!this.server) return false;
    const url = this.url();
    this.log.info(
      url
        ? `live view on ${url}/live/<courtId>/index.m3u8 (signed links only)`
        : `live view listening on port ${port}, but no LAN address was found — set LIVE_HOST`
    );
    return true;
  }

  url() {
    if (!this.server) return null;
    const host = this.settings.liveHost || lanAddress(this.interfaces());
    return host ? `http://${host}:${this.server.address().port}` : null;
  }

  /**
   * The box's own signed playlist link for a court on 127.0.0.1 (player
   * streams read it, restream.js); null while the server isn't running.
   */
  localPlaylistUrl(courtId, exp) {
    if (!this.server) return null;
    const port = this.server.address().port;
    const sig = signLive(this.key, courtId, exp);
    return `http://127.0.0.1:${port}/live/${encodeURIComponent(courtId)}/index.m3u8?exp=${exp}&sig=${sig}`;
  }

  /** The heartbeat's `live` field: { url, key }, or null when off or no LAN address is known. */
  info() {
    if (!this.server) return null;
    const url = this.url();
    if (!url) {
      if (!this.warnedNoHost) this.log.warn("live view has no LAN address — set LIVE_HOST in .env");
      this.warnedNoHost = true;
      return null;
    }
    this.warnedNoHost = false;
    return { url, key: this.key };
  }

  close() {
    if (!this.server) return;
    this.server.close();
    this.server.closeAllConnections?.();
    this.server = null;
  }
}
