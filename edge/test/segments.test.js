import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  anchors,
  buildTimeline,
  loadTimeline,
  mergeSegmentList,
  parseSegmentList,
  segmentStartMs,
  segmentsToPrune,
} from "../src/segments.js";

const T0 = 1_794_881_000_000;

describe("segment names", () => {
  it("parses <epoch>.ts and nothing else", () => {
    assert.equal(segmentStartMs("1794881180.ts"), 1794881180000);
    assert.equal(segmentStartMs("segments.csv"), null);
    assert.equal(segmentStartMs("abc.ts"), null);
    assert.equal(segmentStartMs("1794881180.ts.tmp"), null);
  });
});

describe("parseSegmentList", () => {
  it("reads ffmpeg's CSV list (content seconds) and skips half-written or bad rows", () => {
    const text = [
      "1794881000.ts,0.000000,2.100000",
      "1794881002.ts,2.100000,4.150000",
      "garbage",
      "1794881004.ts,4.15,",
      "1794881009.ts,9,8",
      "",
    ].join("\n");
    assert.deepEqual(parseSegmentList(text), [
      { name: "1794881000.ts", startSec: 0, endSec: 2.1 },
      { name: "1794881002.ts", startSec: 2.1, endSec: 4.15 },
    ]);
  });
});

describe("mergeSegmentList + anchors", () => {
  it("records each closed segment with its run and close time, once", () => {
    const index = {};
    const rows = parseSegmentList(
      "1794881000.ts,0,2.1\n1794881002.ts,2.1,4.15\n1794881099.ts,9,10\n"
    );
    const mtimes = new Map([
      ["1794881000.ts", T0 + 2180],
      ["1794881002.ts", T0 + 4200],
    ]);
    assert.equal(mergeSegmentList(index, rows, { run: "r1", mtimes }), true);
    assert.deepEqual(index["1794881000.ts"], {
      run: "r1",
      cStartMs: 0,
      cEndMs: 2100,
      closedAtMs: T0 + 2180,
    });
    assert.equal(index["1794881099.ts"], undefined, "not on disk");
    assert.equal(mergeSegmentList(index, rows, { run: "r2", mtimes }), false);
    assert.equal(index["1794881000.ts"].run, "r1");
  });

  it("anchors each run on its smallest close delay, ignoring a connect burst", () => {
    // Run starts at T0. Close delays: 900 ms (burst), then 60, 40, 55 ms.
    const index = {
      "a.ts": { run: "r1", cStartMs: 0, cEndMs: 2100, closedAtMs: T0 + 2100 + 900 },
      "b.ts": { run: "r1", cStartMs: 2100, cEndMs: 4150, closedAtMs: T0 + 4150 + 60 },
      "c.ts": { run: "r1", cStartMs: 4150, cEndMs: 10_250, closedAtMs: T0 + 10_250 + 40 },
      "d.ts": { run: "r1", cStartMs: 10_250, cEndMs: 12_450, closedAtMs: T0 + 12_450 + 55 },
      // another ffmpeg run, 30 s later, content restarting at 0
      "e.ts": { run: "r2", cStartMs: 0, cEndMs: 2000, closedAtMs: T0 + 42_000 + 70 },
    };
    const result = anchors(index);
    assert.equal(result.get("a.ts"), T0 + 40);
    assert.equal(result.get("d.ts"), T0 + 40);
    assert.equal(result.get("e.ts"), T0 + 40_070);
  });
});

describe("buildTimeline", () => {
  it("maps content time to wall clock with irregular lengths, and falls back to name → mtime", () => {
    const lengths = [2.1, 2.05, 2.1, 6.1, 2.2];
    const index = {};
    const entries = [];
    let c = 0;
    lengths.forEach((len, i) => {
      const name = `${1794881000 + i * 3}.ts`;
      const cEnd = c + len * 1000;
      index[name] = { run: "r1", cStartMs: c, cEndMs: cEnd, closedAtMs: T0 + cEnd + 50 };
      entries.push({ name, path: `/b/${name}`, mtimeMs: T0 + cEnd + 50 });
      c = cEnd;
    });
    // not in the index: an old segment and the one being written
    entries.push({ name: "1794880990.ts", path: "/b/1794880990.ts", mtimeMs: T0 - 8000 });
    entries.push({ name: "1794881020.ts", path: "/b/1794881020.ts", mtimeMs: T0 + 20_000 });

    const timeline = buildTimeline(entries, index);
    assert.deepEqual(
      timeline.map((s) => [s.name, s.startMs - T0, s.endMs - T0, s.exact]),
      [
        ["1794880990.ts", -10_000, -8000, false],
        ["1794881000.ts", 50, 2150, true],
        ["1794881003.ts", 2150, 4200, true],
        ["1794881006.ts", 4200, 6300, true],
        ["1794881009.ts", 6300, 12_400, true],
        ["1794881012.ts", 12_400, 14_600, true],
      ]
    );
  });
});

describe("segmentsToPrune", () => {
  it("deletes only segments last written before the buffer", () => {
    const now = 1_800_000_000_000;
    const entries = [
      { name: "1799999700.ts", mtimeMs: now - 200_000 },
      { name: "1799999900.ts", mtimeMs: now - 100_000 },
      { name: "index.json", mtimeMs: now - 999_000 },
    ];
    assert.deepEqual(segmentsToPrune(entries, now, 180_000), ["1799999700.ts"]);
  });
});

describe("loadTimeline", () => {
  it("merges segments.csv into index.json under the current run and forgets deleted files", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-seg-"));
    try {
      const touch = async (name, mtimeMs) => {
        await fs.writeFile(path.join(dir, name), "x");
        await fs.utimes(path.join(dir, name), mtimeMs / 1000, mtimeMs / 1000);
      };
      await touch("1794881000.ts", T0 + 2140);
      await touch("1794881002.ts", T0 + 4190);
      await touch("1794881004.ts", T0 + 5000); // being written
      await fs.writeFile(path.join(dir, "run.json"), JSON.stringify({ run: "run-1" }));
      await fs.writeFile(
        path.join(dir, "index.json"),
        JSON.stringify({ "1794880000.ts": { run: "old", cStartMs: 0, cEndMs: 1, closedAtMs: 1 } })
      );
      await fs.writeFile(
        path.join(dir, "segments.csv"),
        "1794881000.ts,0.000000,2.100000\n1794881002.ts,2.100000,4.150000\n"
      );

      const timeline = await loadTimeline(dir, { persist: true });
      assert.deepEqual(
        timeline.map((s) => [s.name, s.startMs - T0, s.endMs - T0, s.exact]),
        [
          ["1794881000.ts", 40, 2140, true],
          ["1794881002.ts", 2140, 4190, true],
        ]
      );
      const index = JSON.parse(await fs.readFile(path.join(dir, "index.json"), "utf8"));
      assert.deepEqual(Object.keys(index).sort(), ["1794881000.ts", "1794881002.ts"]);
      assert.equal(index["1794881000.ts"].run, "run-1");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
