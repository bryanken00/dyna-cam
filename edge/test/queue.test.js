import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { JobQueue } from "../src/queue.js";

let dir;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-queue-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const entry = (clipId, requestedAtMs, extra = {}) => ({
  clipId,
  courtId: "c1",
  requestedAtMs,
  state: "waiting",
  ...extra,
});

describe("JobQueue", () => {
  it("survives a restart: what was saved is loaded back", async () => {
    const file = path.join(dir, "queue.json");
    const queue = new JobQueue(file);
    await queue.load();
    await queue.put(entry("b", 2000));
    await queue.put(entry("a", 1000));
    await queue.update("b", { state: "ready", videoPath: "/jobs/b/clip.mp4" });
    await queue.put(entry("c", 3000));
    await queue.remove("c");

    const reloaded = await new JobQueue(file).load();
    assert.deepEqual(
      reloaded.list().map((e) => e.clipId),
      ["a", "b"]
    );
    assert.equal(reloaded.get("b").state, "ready");
    assert.equal(reloaded.get("b").videoPath, "/jobs/b/clip.mp4");
    assert.equal(reloaded.has("c"), false);
  });

  it("starts empty when the file is missing, and moves a corrupt file aside", async () => {
    const file = path.join(dir, "queue.json");
    assert.equal((await new JobQueue(file).load()).size, 0);
    await fs.writeFile(file, "{ not json");
    const queue = await new JobQueue(file).load();
    assert.equal(queue.size, 0);
    const names = await fs.readdir(dir);
    assert.ok(names.some((n) => n.startsWith("queue.json.corrupt-")));
  });

  it("writes atomically and in order under concurrent changes", async () => {
    const file = path.join(dir, "queue.json");
    const queue = await new JobQueue(file).load();
    await Promise.all(Array.from({ length: 20 }, (_, i) => queue.put(entry(`j${i}`, i))));
    const saved = JSON.parse(await fs.readFile(file, "utf8"));
    assert.equal(saved.jobs.length, 20);
    assert.deepEqual(
      (await fs.readdir(dir)).filter((n) => n.endsWith(".tmp")),
      []
    );
  });
});
