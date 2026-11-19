import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DeviceSync } from "../src/sync.js";
import { clockOffset, diskSpace, queueBacklog, sampleHealth } from "../src/health.js";

const MB = 1024 * 1024;
const fakeOs = {
  freemem: () => 512 * MB,
  totalmem: () => 4096 * MB,
  loadavg: () => [1.234, 0, 0],
  cpus: () => [{}, {}, {}, {}],
  uptime: () => 3600.7,
};

describe("queueBacklog", () => {
  it("counts clips and games, skips presses, ages from the oldest", () => {
    const now = 1_000_000;
    const backlog = queueBacklog(
      [
        { clipId: "c1", state: "ready", requestedAtMs: now - 30_000 },
        { type: "game", sessionVideoId: "v1", phase: "uploading", requestedAtMs: now - 90_000 },
        { pressId: "p1", state: "press", requestedAtMs: now - 500_000 },
      ],
      now
    );
    assert.deepEqual(backlog, { pendingClips: 1, pendingGames: 1, oldestPendingSeconds: 90 });
  });

  it("is zero for an empty queue", () => {
    assert.deepEqual(queueBacklog([], 5), {
      pendingClips: 0,
      pendingGames: 0,
      oldestPendingSeconds: 0,
    });
  });
});

describe("diskSpace", () => {
  it("reports free (available to us) and total MB", async () => {
    const statfs = async () => ({ bsize: 4096, bavail: 256 * 100, blocks: 256 * 1000 });
    assert.deepEqual(await diskSpace("/x", statfs), { diskFreeMb: 100, diskTotalMb: 1000 });
  });

  it("is null when the folder can't be read", async () => {
    const statfs = async () => {
      throw new Error("ENOENT");
    };
    assert.equal(await diskSpace("/missing", statfs), null);
  });
});

describe("sampleHealth", () => {
  it("collects disk, memory, load, uptime, backlog and the clock offset", async () => {
    const health = await sampleHealth({
      dataDir: "/data",
      queueEntries: () => [{ clipId: "c", state: "waiting", requestedAtMs: 0 }],
      clockOffsetMs: -1234.4,
      now: () => 10_000,
      statfs: async () => ({ bsize: MB, bavail: 20, blocks: 200 }),
      osImpl: fakeOs,
    });
    assert.deepEqual(health, {
      diskFreeMb: 20,
      diskTotalMb: 200,
      memFreeMb: 512,
      memTotalMb: 4096,
      load1: 1.23,
      cpus: 4,
      uptimeSeconds: 3600,
      pendingClips: 1,
      pendingGames: 0,
      oldestPendingSeconds: 10,
      clockOffsetMs: -1234,
    });
  });

  it("leaves out what it can't read", async () => {
    const health = await sampleHealth({
      dataDir: "/data",
      statfs: async () => {
        throw new Error("nope");
      },
      osImpl: fakeOs,
    });
    assert.equal(health.diskFreeMb, undefined);
    assert.equal(health.clockOffsetMs, undefined);
    assert.equal(health.cpus, 4);
  });
});

describe("clockOffset", () => {
  it("is server minus the round trip's midpoint", () => {
    assert.equal(clockOffset(5000, 1000, 2000), 3500);
    assert.equal(clockOffset(undefined, 1000, 2000), null);
  });
});

describe("heartbeat system field", () => {
  const makeSync = (api, health) =>
    new DeviceSync({
      api,
      recorders: { statuses: () => [] },
      settings: { dataDir: "/tmp/none" },
      agentVersion: "1.0.0",
      log: { info() {}, warn() {}, error() {}, debug() {} },
      health,
    });

  it("sends system and keeps the offset from the reply", async () => {
    const sent = [];
    const sync = makeSync(
      {
        heartbeat: async (payload) => {
          sent.push(payload);
          return { serverTime: Date.now() + 60_000 };
        },
      },
      async (offset) => ({ diskFreeMb: 1, ...(offset === null ? {} : { clockOffsetMs: offset }) })
    );
    await sync.heartbeat();
    assert.deepEqual(sent[0].system, { diskFreeMb: 1 });
    assert.ok(sync.clockOffsetMs > 55_000 && sync.clockOffsetMs < 65_000);
    await sync.heartbeat();
    assert.ok(sent[1].system.clockOffsetMs > 55_000);
  });

  it("still sends the heartbeat when the sample fails, and omits system without a sampler", async () => {
    const sent = [];
    const api = { heartbeat: async (payload) => sent.push(payload) };
    await makeSync(api, async () => {
      throw new Error("boom");
    }).heartbeat();
    await makeSync(api, null).heartbeat();
    assert.equal(sent.length, 2);
    assert.equal("system" in sent[0], false);
    assert.equal("system" in sent[1], false);
  });
});
