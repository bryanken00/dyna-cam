import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { loadConfig } from "../src/config.js";
import {
  buildPlaylist,
  checkSignature,
  createLiveServer,
  lanAddress,
  LIVE_KEY_FILE,
  LiveSequencer,
  LiveView,
  loadLiveKey,
  readCourtSegments,
  readPcrBase,
  readPts,
  routeLive,
  shiftTimestamps,
  signLive,
  TimestampShift,
  writePts,
} from "../src/live.js";
import { DeviceSync } from "../src/sync.js";

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const KEY = "a".repeat(64);
const T0 = 1_794_881_000; // epoch seconds of the first fake segment
let dir;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-live-"));
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

/**
 * A fake court folder. `rows`: [nameSeconds, contentStart, contentEnd, run];
 * runs other than the current one go to index.json (merged earlier), the
 * current one to segments.csv. `open`: a newer file still being written.
 */
async function court(courtDir, { rows, run = "run-b", open = null, payload = "ts" }) {
  await fs.mkdir(courtDir, { recursive: true });
  const index = {};
  const csv = [];
  for (const [sec, start, end, rowRun = run] of rows) {
    const name = `${sec}.ts`;
    await fs.writeFile(path.join(courtDir, name), payload);
    await fs.utimes(path.join(courtDir, name), sec + (end - start), sec + (end - start));
    if (rowRun === run) csv.push(`${name},${start.toFixed(6)},${end.toFixed(6)}`);
    else
      index[name] = {
        run: rowRun,
        cStartMs: start * 1000,
        cEndMs: end * 1000,
        closedAtMs: (sec + end - start) * 1000,
      };
  }
  if (open) await fs.writeFile(path.join(courtDir, `${open}.ts`), "partial");
  await fs.writeFile(path.join(courtDir, "segments.csv"), `${csv.join("\n")}\n`);
  await fs.writeFile(path.join(courtDir, "index.json"), JSON.stringify(index));
  await fs.writeFile(path.join(courtDir, "run.json"), JSON.stringify({ run }));
}

/** Six 2 s segments of one run, the newest still open. */
const steadyRows = (from = 0, n = 6) =>
  Array.from({ length: n }, (_v, i) => [T0 + 2 * (from + i), 2 * (from + i), 2 * (from + i + 1)]);

/** GET with the path sent exactly as written (fetch would normalise `..`). */
function rawGet(port, rawPath, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: rawPath, method }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })
      );
    });
    req.on("error", reject);
    req.end();
  });
}

describe("signatures", () => {
  const exp = String(T0 + 600);
  const sig = signLive(KEY, "court-1", exp);
  const nowMs = T0 * 1000;

  it("accepts the API's HMAC-SHA256(key, `courtId.exp`) until exp", () => {
    assert.match(sig, /^[0-9a-f]{64}$/);
    assert.equal(checkSignature({ key: KEY, courtId: "court-1", exp, sig, nowMs }), "ok");
    assert.equal(
      checkSignature({ key: KEY, courtId: "court-1", exp, sig: sig.toUpperCase(), nowMs }),
      "ok"
    );
  });

  it("refuses another court, another exp, another key, junk and a missing sig", () => {
    const check = (over) =>
      checkSignature({ key: KEY, courtId: "court-1", exp, sig, nowMs, ...over });
    assert.equal(check({ courtId: "court-2" }), "bad");
    assert.equal(check({ exp: String(T0 + 601) }), "bad");
    assert.equal(check({ key: "b".repeat(64) }), "bad");
    assert.equal(check({ sig: "zz" }), "bad");
    assert.equal(check({ sig: null }), "bad");
    assert.equal(check({ exp: "1e12" }), "bad");
    assert.equal(check({ key: null }), "bad");
  });

  it("refuses an expired link", () => {
    const check = (ms) => checkSignature({ key: KEY, courtId: "court-1", exp, sig, nowMs: ms });
    assert.equal(check((T0 + 600) * 1000), "expired");
    assert.equal(check((T0 + 599) * 1000), "ok");
  });
});

describe("routeLive", () => {
  it("routes the playlist and segments with their query", () => {
    assert.deepEqual(routeLive("GET", "/live/court-1/index.m3u8?exp=1&sig=ab"), {
      kind: "playlist",
      courtId: "court-1",
      camera: 1,
      file: "index.m3u8",
      exp: "1",
      sig: "ab",
    });
    assert.equal(routeLive("HEAD", `/live/c_2/${T0}.ts`).kind, "segment");
  });

  it("routes camera 2 under /cam2/, same court id", () => {
    assert.deepEqual(routeLive("GET", "/live/court-1/cam2/index.m3u8?exp=1&sig=ab"), {
      kind: "playlist",
      courtId: "court-1",
      camera: 2,
      file: "index.m3u8",
      exp: "1",
      sig: "ab",
    });
    const seg = routeLive("GET", `/live/court-1/cam2/${T0}.ts`);
    assert.equal(seg.kind, "segment");
    assert.equal(seg.camera, 2);
    for (const bad of [
      "/live/court-1/cam3/index.m3u8",
      "/live/court-1/cam2/cam2/index.m3u8",
      "/live/court-1/cam2",
      "/live/court-1/cam2/../../x.ts",
      "/live/court-1~cam2/index.m3u8",
      "/live/court-1/CAM2/index.m3u8",
    ]) {
      assert.equal(routeLive("GET", bad).status, 404, bad);
    }
  });

  it("404s traversal and anything that isn't a recorder segment name", () => {
    for (const bad of [
      "/live/court-1/../../device.json",
      "/live/court-1/..%2F..%2Fdevice.json",
      "/live/court-1/%2e%2e%2fdevice.json",
      "/live/..%2F..%2Fetc/index.m3u8",
      "/live/court%2F1/index.m3u8",
      "/live/../index.m3u8",
      "/live/court-1/segments.csv",
      "/live/court-1/index.json",
      `/live/court-1/${T0}.ts/x`,
      `/live/court-1/${T0}.TS`,
      "/live/court-1/123.ts",
      "/live/court-1",
      "/live//index.m3u8",
      "/court-1/index.m3u8",
      `/live/${"x".repeat(65)}/index.m3u8`,
      "/live/%E0%A4%A/index.m3u8",
    ]) {
      assert.equal(routeLive("GET", bad).status, 404, bad);
    }
  });

  it("allows only GET and HEAD", () => {
    for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
      assert.equal(routeLive(method, "/live/court-1/index.m3u8").status, 405);
    }
  });
});

describe("readCourtSegments + LiveSequencer + buildPlaylist", () => {
  it("lists the newest 5 closed segments, skipping the one still being written", async () => {
    const courtDir = path.join(dir, "court-1");
    await court(courtDir, { rows: steadyRows(0, 7), open: T0 + 14 });
    const segs = await readCourtSegments(courtDir);
    assert.deepEqual(
      segs.map((s) => s.name),
      [4, 6, 8, 10, 12].map((n) => `${T0 + n}.ts`)
    );
    assert.ok(segs.every((s) => s.timed && s.run === "run-b" && s.duration === 2));
    assert.equal(await readCourtSegments(path.join(dir, "nope")), null);
  });

  it("builds a live playlist: version, target duration, sequence, signed relative URIs", () => {
    const seq = new LiveSequencer();
    const segs = steadyRows(0, 5).map(([sec, start, end]) => ({
      name: `${sec}.ts`,
      timed: true,
      run: "r",
      cStartMs: start * 1000,
      cEndMs: end * 1000,
      duration: end - start,
    }));
    segs[2] = { ...segs[2], cEndMs: segs[2].cStartMs + 6100, duration: 6.1 };
    segs[3] = { ...segs[3], cStartMs: segs[2].cEndMs, cEndMs: segs[2].cEndMs + 2000 };
    segs[4] = { ...segs[4], cStartMs: segs[3].cEndMs, cEndMs: segs[3].cEndMs + 2000 };
    const text = buildPlaylist(seq.number(segs), "exp=99&sig=abc");
    const lines = text.trim().split("\n");
    assert.deepEqual(lines.slice(0, 5), [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      "#EXT-X-TARGETDURATION:7",
      `#EXT-X-MEDIA-SEQUENCE:${T0}`,
      `#EXT-X-DISCONTINUITY-SEQUENCE:${T0}`,
    ]);
    assert.equal(lines[5], "#EXTINF:2.000,");
    assert.equal(lines[6], `${T0}.ts?exp=99&sig=abc`);
    assert.ok(lines.includes("#EXTINF:6.100,"));
    assert.equal(lines.filter((l) => l.startsWith("#EXTINF")).length, 5);
    assert.ok(!text.includes("#EXT-X-ENDLIST"));
    assert.ok(!text.includes("#EXT-X-DISCONTINUITY\n"));
  });

  it("keeps the media sequence rising by one per segment across a prune", async () => {
    const courtDir = path.join(dir, "court-1");
    await court(courtDir, { rows: steadyRows(0, 5), open: T0 + 10 });
    const seq = new LiveSequencer();
    const first = seq.number(await readCourtSegments(courtDir));
    assert.equal(first.length, 5);
    // Two more segments close, the oldest two are pruned
    await court(courtDir, { rows: steadyRows(0, 7), open: T0 + 14 });
    await fs.rm(path.join(courtDir, `${T0}.ts`));
    await fs.rm(path.join(courtDir, `${T0 + 2}.ts`));
    const second = seq.number(await readCourtSegments(courtDir));
    assert.equal(second[0].name, `${T0 + 4}.ts`);
    assert.equal(second[0].seq, first[2].seq, "a segment keeps its number");
    assert.deepEqual(
      second.map((s) => s.seq - second[0].seq),
      [0, 1, 2, 3, 4]
    );
    assert.ok(second[0].seq > first[0].seq);
    // After a box restart the numbering starts at the segment's name: never lower than before
    const restarted = new LiveSequencer().number(await readCourtSegments(courtDir));
    assert.ok(restarted[0].seq >= second[0].seq);
    assert.ok(restarted[0].dseq >= second[0].dseq);
  });

  it("marks a recorder restart (new run, time gap) with a discontinuity", async () => {
    const courtDir = path.join(dir, "court-1");
    await court(courtDir, {
      rows: [
        [T0, 0, 2, "run-a"],
        [T0 + 2, 2, 4, "run-a"],
        [T0 + 4, 4, 6, "run-a"],
        // ffmpeg restarted 10 s later: a new run, content time from 0 again
        [T0 + 16, 0, 2],
        [T0 + 18, 2, 4],
      ],
      open: T0 + 20,
    });
    const listed = new LiveSequencer().number(await readCourtSegments(courtDir));
    const text = buildPlaylist(listed, "exp=1&sig=2");
    const lines = text.split("\n");
    const at = lines.indexOf("#EXT-X-DISCONTINUITY");
    assert.ok(at > 0);
    assert.equal(lines[at + 2], `${T0 + 16}.ts?exp=1&sig=2`);
    assert.equal(lines.filter((l) => l === "#EXT-X-DISCONTINUITY").length, 1);
    assert.equal(listed[3].offset, 0, "the new run's clock starts at 0");
    assert.equal(listed[2].offset, 4000 * 90);
    // Once the old run slides out, the discontinuity sequence says it happened
    const later = buildPlaylist(listed.slice(3), "q");
    assert.match(later, new RegExp(`#EXT-X-DISCONTINUITY-SEQUENCE:${T0 + 1}\\n`));
  });

  it("treats a file missing from segments.csv as a break, timed by name → mtime", async () => {
    const courtDir = path.join(dir, "court-1");
    await court(courtDir, { rows: steadyRows(0, 3), open: T0 + 8 });
    await fs.writeFile(path.join(courtDir, `${T0 + 6}.ts`), "lost row");
    await fs.utimes(path.join(courtDir, `${T0 + 6}.ts`), T0 + 8, T0 + 8);
    const listed = new LiveSequencer().number(await readCourtSegments(courtDir));
    assert.deepEqual(
      listed.map((s) => [s.timed, s.duration]),
      [
        [true, 2],
        [true, 2],
        [true, 2],
        [false, 2],
      ]
    );
    assert.equal(listed[3].dseq, listed[2].dseq + 1);
  });
});

/** One MPEG-TS packet: adaptation field with a PCR, then a PES header with PTS + DTS. */
function tsPacket({ pcr, pts, dts }) {
  const p = Buffer.alloc(188, 0xff);
  p[0] = 0x47;
  p[1] = 0x40 | 0x01; // payload unit start, PID 0x100
  p[2] = 0x00;
  p[3] = 0x30; // adaptation field + payload
  p[4] = 7;
  p[5] = 0x10; // PCR flag
  p[6] = Math.floor(pcr / 2 ** 25) & 0xff;
  p[7] = Math.floor(pcr / 2 ** 17) & 0xff;
  p[8] = Math.floor(pcr / 2 ** 9) & 0xff;
  p[9] = Math.floor(pcr / 2) & 0xff;
  p[10] = ((pcr % 2) << 7) | 0x7e | 0x01;
  p[11] = 0x23; // PCR extension
  const pes = 12;
  Buffer.from([0, 0, 1, 0xe0, 0, 0, 0x80, 0xc0, 10]).copy(p, pes);
  p[pes + 9] = 0x30;
  writePts(p, pes + 9, pts);
  p[pes + 14] = 0x10;
  writePts(p, pes + 14, dts);
  return p;
}

describe("shiftTimestamps", () => {
  it("moves PCR, PTS and DTS forward, keeping prefixes, markers and the PCR extension", () => {
    const packet = tsPacket({ pcr: 126_000, pts: 135_000, dts: 129_000 });
    const before = Buffer.from(packet);
    shiftTimestamps(packet, 90 * 4321);
    assert.equal(readPcrBase(packet, 6), 126_000 + 90 * 4321);
    assert.equal(readPts(packet, 21), 135_000 + 90 * 4321);
    assert.equal(readPts(packet, 26), 129_000 + 90 * 4321);
    assert.equal(packet[21] >> 4, 3);
    assert.equal(packet[26] >> 4, 1);
    assert.equal(packet[10] & 0x7f, before[10] & 0x7f);
    assert.equal(packet[11], 0x23);
    assert.deepEqual(packet.subarray(31), before.subarray(31), "payload untouched");
  });

  it("handles 33-bit values and wraps", () => {
    const packet = tsPacket({ pcr: 2 ** 33 - 10, pts: 2 ** 32 + 5, dts: 2 ** 33 - 1 });
    shiftTimestamps(packet, 20);
    assert.equal(readPcrBase(packet, 6), 10);
    assert.equal(readPts(packet, 21), 2 ** 32 + 25);
    assert.equal(readPts(packet, 26), 19);
  });

  it("re-joins packets split across stream chunks", async () => {
    const data = Buffer.concat([
      tsPacket({ pcr: 0, pts: 1000, dts: 900 }),
      tsPacket({ pcr: 90, pts: 4000, dts: 3900 }),
    ]);
    const shift = new TimestampShift(500);
    const out = [];
    shift.on("data", (c) => out.push(c));
    const done = new Promise((resolve) => shift.on("end", resolve));
    for (const [a, b] of [
      [0, 100],
      [100, 200],
      [200, 376],
    ])
      shift.write(data.subarray(a, b));
    shift.end();
    await done;
    const result = Buffer.concat(out);
    assert.equal(result.length, 376);
    assert.equal(readPts(result, 21), 1500);
    assert.equal(readPts(result, 188 + 26), 4400);
  });
});

describe("live server", () => {
  let server;
  let port;
  let bufferDir;
  let clock;
  const exp = String(T0 + 3600);
  const sig = signLive(KEY, "court-1", exp);
  const q = `exp=${exp}&sig=${sig}`;

  before(async () => {
    bufferDir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-live-srv-"));
    clock = (T0 + 20) * 1000;
    server = createLiveServer({ bufferDir, key: KEY, log: silent, now: () => clock });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = server.address().port;
    const packet = tsPacket({ pcr: 126_000, pts: 135_000, dts: 129_000 });
    await court(path.join(bufferDir, "court-1"), {
      rows: steadyRows(0, 7),
      open: T0 + 14,
      payload: Buffer.concat([packet, packet]),
    });
    // Camera 2 of the same court: its own folder and footage
    const pkt2 = tsPacket({ pcr: 126_000, pts: 135_000, dts: 129_000 });
    await court(path.join(bufferDir, "court-1~cam2"), {
      rows: steadyRows(1, 6),
      open: T0 + 14,
      payload: Buffer.concat([pkt2, pkt2, pkt2]),
    });
    await fs.writeFile(path.join(bufferDir, "device.json"), "{}");
  });
  after(async () => {
    server.close();
    await fs.rm(bufferDir, { recursive: true, force: true });
  });

  it("serves a signed playlist with no-store and the HLS type", async () => {
    const res = await rawGet(port, `/live/court-1/index.m3u8?${q}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-type"], "application/vnd.apple.mpegurl");
    assert.equal(res.headers["cache-control"], "no-store");
    assert.equal(res.headers["access-control-allow-origin"], "*");
    const text = res.body.toString();
    assert.match(text, /^#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n/);
    assert.match(text, new RegExp(`#EXT-X-MEDIA-SEQUENCE:${T0 + 4}\\n`));
    assert.ok(text.includes(`${T0 + 12}.ts?${q}\n`));
    const head = await rawGet(port, `/live/court-1/index.m3u8?${q}`, "HEAD");
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
  });

  it("serves camera 2 from its own folder with the same signature", async () => {
    const res = await rawGet(port, `/live/court-1/cam2/index.m3u8?${q}`);
    assert.equal(res.status, 200);
    const text = res.body.toString();
    // Relative URIs resolve under /cam2/; the newest closed segment of camera 2's folder
    assert.ok(text.includes(`${T0 + 12}.ts?${q}\n`));
    const seg = await rawGet(port, `/live/court-1/cam2/${T0 + 12}.ts?${q}`);
    assert.equal(seg.status, 200);
    assert.equal(seg.body.length, 3 * 188, "camera 2's file, not camera 1's");
    const one = await rawGet(port, `/live/court-1/${T0 + 12}.ts?${q}`);
    assert.equal(one.body.length, 2 * 188);
    const other = `exp=${exp}&sig=${signLive(KEY, "court-2", exp)}`;
    assert.equal((await rawGet(port, `/live/court-1/cam2/index.m3u8?${other}`)).status, 403);
  });

  it("streams a segment with its clock moved to its content start", async () => {
    const res = await rawGet(port, `/live/court-1/${T0 + 8}.ts?${q}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-type"], "video/mp2t");
    assert.equal(Number(res.headers["content-length"]), 376);
    assert.equal(readPts(res.body, 21), 135_000 + 8000 * 90);
    assert.equal(readPts(res.body, 188 + 26), 129_000 + 8000 * 90);
  });

  it("403s a bad signature, another court's signature and an expired link", async () => {
    const bad = await rawGet(port, `/live/court-1/index.m3u8?exp=${exp}&sig=${"0".repeat(64)}`);
    assert.equal(bad.status, 403);
    assert.equal((await rawGet(port, `/live/court-2/index.m3u8?${q}`)).status, 403);
    assert.equal((await rawGet(port, `/live/court-1/${T0 + 8}.ts`)).status, 403);
    const old = String(T0 + 10);
    const expired = `exp=${old}&sig=${signLive(KEY, "court-1", old)}`;
    assert.equal((await rawGet(port, `/live/court-1/index.m3u8?${expired}`)).status, 403);
    assert.equal((await rawGet(port, `/live/court-1/${T0 + 8}.ts?${expired}`)).status, 403);
  });

  it("404s an unknown court, a missing segment and traversal; 405s other methods", async () => {
    const other = `exp=${exp}&sig=${signLive(KEY, "court-9", exp)}`;
    assert.equal((await rawGet(port, `/live/court-9/index.m3u8?${other}`)).status, 404);
    assert.equal((await rawGet(port, `/live/court-1/${T0 + 100}.ts?${q}`)).status, 404);
    for (const p of [
      `/live/court-1/../device.json?${q}`,
      `/live/court-1/..%2Fdevice.json?${q}`,
      `/live/..%2Fcourt-1/index.m3u8?${q}`,
      `/live/court-1/index.json?${q}`,
    ]) {
      const res = await rawGet(port, p);
      assert.equal(res.status, 404, p);
      assert.ok(!res.body.toString().includes("{}"));
    }
    const post = await rawGet(port, `/live/court-1/index.m3u8?${q}`, "POST");
    assert.equal(post.status, 405);
    assert.equal(post.headers.allow, "GET, HEAD");
  });

  it("404s a court with no segments yet, and one that stopped recording", async () => {
    const empty = `exp=${exp}&sig=${signLive(KEY, "court-3", exp)}`;
    await fs.mkdir(path.join(bufferDir, "court-3"));
    assert.equal((await rawGet(port, `/live/court-3/index.m3u8?${empty}`)).status, 404);
    clock += 60_000; // newest closed segment is now a minute old
    assert.equal((await rawGet(port, `/live/court-1/index.m3u8?${q}`)).status, 404);
    clock -= 60_000;
  });
});

describe("lanAddress", () => {
  const v4 = (address, internal = false) => ({ address, family: "IPv4", internal });
  it("prefers a private address on a real interface", () => {
    assert.equal(
      lanAddress({
        lo: [v4("127.0.0.1", true)],
        docker0: [v4("172.17.0.1")],
        eth0: [{ address: "fe80::1", family: "IPv6", internal: false }, v4("203.0.113.9")],
        wlan0: [v4("192.168.254.50")],
      }),
      "192.168.254.50"
    );
    assert.equal(
      lanAddress({ eth0: [v4("10.1.2.3")], tailscale0: [v4("100.64.0.1")] }),
      "10.1.2.3"
    );
    assert.equal(
      lanAddress({ docker0: [v4("172.17.0.1")], eth0: [v4("203.0.113.9")] }),
      "172.17.0.1"
    );
  });
  it("falls back to any non-internal IPv4, else null", () => {
    assert.equal(lanAddress({ eth0: [v4("203.0.113.9")] }), "203.0.113.9");
    assert.equal(lanAddress({ lo: [v4("127.0.0.1", true)], eth0: [v4("169.254.3.4")] }), null);
    assert.equal(lanAddress({}), null);
  });
});

describe("live key", () => {
  it("is made once (64 hex, mode 0600) and reused on restart", async () => {
    const key = await loadLiveKey(dir);
    assert.match(key, /^[0-9a-f]{64}$/);
    const stat = await fs.stat(path.join(dir, LIVE_KEY_FILE));
    if (process.platform !== "win32") assert.equal(stat.mode & 0o777, 0o600);
    assert.equal(await loadLiveKey(dir), key);
    await fs.chmod(path.join(dir, LIVE_KEY_FILE), 0o644);
    assert.equal(await loadLiveKey(dir), key);
    assert.equal((await fs.stat(path.join(dir, LIVE_KEY_FILE))).mode & 0o777, 0o600);
  });
  it("replaces a damaged key file", async () => {
    await fs.writeFile(path.join(dir, LIVE_KEY_FILE), JSON.stringify({ key: "short" }));
    assert.match(await loadLiveKey(dir), /^[0-9a-f]{64}$/);
  });
});

describe("LiveView", () => {
  const interfaces = () => ({
    wlan0: [{ address: "192.168.1.50", family: "IPv4", internal: false }],
  });

  it("is off with LIVE_PORT=0: no server, no key, heartbeat live = null", async () => {
    const view = new LiveView({ settings: { livePort: 0, dataDir: dir }, log: silent, interfaces });
    assert.equal(await view.start(), false);
    assert.equal(view.info(), null);
    await assert.rejects(fs.stat(path.join(dir, LIVE_KEY_FILE)));
    view.close();
  });

  it("logs and stays off when the port is taken — never throws", async () => {
    const blocker = net.createServer();
    await new Promise((resolve) => blocker.listen(0, "0.0.0.0", resolve));
    const warnings = [];
    const view = new LiveView({
      settings: { livePort: blocker.address().port, dataDir: dir },
      log: { ...silent, warn: (m) => warnings.push(m) },
      interfaces,
    });
    try {
      assert.equal(await view.start(), false);
      assert.equal(view.info(), null);
      assert.match(warnings.join("\n"), /already in use.*recording goes on without live view/);
    } finally {
      blocker.close();
    }
  });

  it("reports { url, key } from the detected address, or LIVE_HOST", async () => {
    const probe = net.createServer();
    await new Promise((resolve) => probe.listen(0, "0.0.0.0", resolve));
    const free = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    const view = new LiveView({
      settings: { livePort: free, dataDir: dir },
      log: silent,
      interfaces,
    });
    try {
      assert.equal(await view.start(), true);
      const key = await loadLiveKey(dir);
      assert.deepEqual(view.info(), { url: `http://192.168.1.50:${free}`, key });
      view.settings = { ...view.settings, liveHost: "box.local" };
      assert.equal(view.info().url, `http://box.local:${free}`);
      view.settings = { ...view.settings, liveHost: null };
      view.interfaces = () => ({});
      assert.equal(view.info(), null, "no LAN address → null");
    } finally {
      view.close();
    }
  });
});

describe("heartbeat", () => {
  it("includes live: { url, key }, or null when the live view is off", async () => {
    const sent = [];
    const make = (live) =>
      new DeviceSync({
        api: { heartbeat: async (payload) => sent.push(payload) },
        recorders: { statuses: () => [] },
        settings: { dataDir: dir },
        agentVersion: "1.2.3",
        log: silent,
        live,
      });
    await make({ info: () => ({ url: "http://192.168.1.50:8090", key: KEY }) }).heartbeat();
    await make(null).heartbeat();
    assert.deepEqual(sent, [
      {
        agentVersion: "1.2.3",
        cameras: [],
        live: { url: "http://192.168.1.50:8090", key: KEY },
        sessionStreams: [],
      },
      { agentVersion: "1.2.3", cameras: [], live: null, sessionStreams: [] },
    ]);
  });
});

describe("config", () => {
  const base = { API_URL: "https://x.test" };
  it("has the live view on 8090 by default, off with an empty/0 LIVE_PORT", () => {
    assert.equal(loadConfig(base).livePort, 8090);
    assert.equal(loadConfig(base).liveHost, null);
    assert.equal(loadConfig({ ...base, LIVE_PORT: "" }).livePort, 0);
    assert.equal(loadConfig({ ...base, LIVE_PORT: "0" }).livePort, 0);
    assert.equal(loadConfig({ ...base, LIVE_HOST: " 192.168.1.50 " }).liveHost, "192.168.1.50");
  });
  it("rejects a bad port or host, and the button port", () => {
    assert.throws(() => loadConfig({ ...base, LIVE_PORT: "70000" }), /LIVE_PORT/);
    assert.throws(() => loadConfig({ ...base, LIVE_PORT: "8089" }), /must differ/);
    for (const bad of ["http://1.2.3.4", "1.2.3.4:8090", "a/b", "x y"]) {
      assert.throws(() => loadConfig({ ...base, LIVE_HOST: bad }), /LIVE_HOST/, bad);
    }
  });
});
